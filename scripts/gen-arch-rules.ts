#!/usr/bin/env node --experimental-transform-types
/**
 * Atlas architecture ring gate — single source of truth is
 * architecture/rings.json (per ADR 0016).
 *
 * Modes:
 *   pnpm arch:check            validate the workspace against the manifest
 *   pnpm arch:check:verbose    + per-edge evidence
 *   pnpm arch:emit             (re)generate dep-cruiser + oxlint layer rules
 *
 * The validator (check mode) is the AUTHORITATIVE matrix gate: it reads every
 * workspace package.json and checks each production dependency edge against
 * the ring DAG (R1 inward-only via per-ring `mayImport`), the cross-stack
 * rule, sharedLeaves, the tooling rule, completeness, and the waiver ratchet.
 * It depends on no external tool, so it is deterministic across machines.
 *
 * Emit mode generates belt-and-suspenders artifacts:
 *   - architecture/generated/dep-cruiser-rules.cjs  (graph gate: cycles + edges)
 *   - architecture/generated/oxlint-layers.json     (editor-speed direct-import bans)
 * Both are derived from the manifest and must never be hand-edited.
 *
 * Reference: specs/decisions/0016-hard-layered-ring-architecture.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const VERBOSE = process.argv.includes('--verbose');
const EMIT = process.argv.includes('--emit') || process.argv.includes('emit');

// --- manifest types ---------------------------------------------------------

interface RingDef {
  stack: string;
  mayImport: string[];
}

interface Waiver {
  from: string;
  to: string;
  reason: string;
  removeBy?: string;
  ticket?: string;
}

interface Manifest {
  rings: Record<string, RingDef>;
  sharedLeaves: string[];
  assignments: Record<string, string>;
  tooling: string[];
  waivers: Waiver[];
}

interface PkgInfo {
  name: string;
  dir: string; // repo-relative, forward-slash
  prodDeps: string[]; // dependencies + peerDependencies keys, @atlas/* only
}

// --- workspace discovery ----------------------------------------------------

// Mirrors pnpm-workspace.yaml: ports, packages/*, modules/*, adapters/*,
// apps/*, bundles/*. (packages/seeder, adapters/seed-memory are covered by
// the wildcard parents.)
const WORKSPACE_PARENTS = ['packages', 'modules', 'adapters', 'apps', 'bundles'];

function relForward(abs: string): string {
  return relative(REPO_ROOT, abs).split(sep).join('/');
}

function readPkg(pkgJsonPath: string): PkgInfo | null {
  let raw: string;
  try {
    raw = readFileSync(pkgJsonPath, 'utf8');
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!name) return null;
  const prodDeps = new Set<string>();
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = obj[field];
    if (typeof deps === 'object' && deps !== null) {
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith('@atlas/')) prodDeps.add(dep);
      }
    }
  }
  return {
    name,
    dir: relForward(dirname(pkgJsonPath)),
    prodDeps: [...prodDeps].sort(),
  };
}

function discoverWorkspace(): PkgInfo[] {
  const found: PkgInfo[] = [];
  const portsPkg = readPkg(join(REPO_ROOT, 'ports', 'package.json'));
  if (portsPkg) found.push(portsPkg);
  for (const parent of WORKSPACE_PARENTS) {
    const parentDir = join(REPO_ROOT, parent);
    let entries;
    try {
      entries = readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJson = join(parentDir, entry.name, 'package.json');
      if (!existsSync(pkgJson)) continue;
      const info = readPkg(pkgJson);
      if (info) found.push(info);
    }
  }
  return found.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
}

// --- edge classification (the DAG rule) -------------------------------------

type EdgeVerdict = { ok: true } | { ok: false; kind: string };

function classifyEdge(from: string, to: string, manifest: Manifest): EdgeVerdict {
  const sharedLeaves = new Set(manifest.sharedLeaves);
  const tooling = new Set(manifest.tooling);

  if (sharedLeaves.has(to)) return { ok: true };
  if (tooling.has(from)) return { ok: true }; // tooling may import anything
  if (tooling.has(to)) {
    return { ok: false, kind: 'production code depends on a tooling package' };
  }

  const fromRing = manifest.assignments[from];
  const toRing = manifest.assignments[to];
  if (fromRing === undefined || toRing === undefined) {
    // Completeness handles unassigned packages; don't double-report here.
    return { ok: true };
  }
  const fromDef = manifest.rings[fromRing];
  const toDef = manifest.rings[toRing];
  if (!fromDef || !toDef) return { ok: true };

  if (fromDef.stack !== toDef.stack) {
    return { ok: false, kind: `cross-stack import (${fromDef.stack} -> ${toDef.stack})` };
  }
  if (!fromDef.mayImport.includes(toRing)) {
    return { ok: false, kind: `ring '${fromRing}' may not import ring '${toRing}'` };
  }
  return { ok: true };
}

// --- checks -----------------------------------------------------------------

interface Violation {
  from: string;
  to: string;
  kind: string;
}

interface CheckReport {
  unassigned: string[];
  unknownNames: string[];
  unwaived: Violation[];
  waived: Violation[];
  staleWaivers: Waiver[];
}

function runChecks(manifest: Manifest, packages: PkgInfo[]): CheckReport {
  const byName = new Map(
    packages.map(function (p) {
      return [p.name, p];
    }),
  );
  const known = new Set([...Object.keys(manifest.assignments), ...manifest.tooling]);

  const unassigned = packages
    .map(function (p) {
      return p.name;
    })
    .filter(function (n) {
      return !known.has(n);
    })
    .sort();

  const referenced = new Set<string>([
    ...Object.keys(manifest.assignments),
    ...manifest.tooling,
    ...manifest.sharedLeaves,
    ...manifest.waivers.flatMap(function (w) {
      return [w.from, w.to];
    }),
  ]);
  const unknownNames = [...referenced]
    .filter(function (n) {
      return !byName.has(n);
    })
    .sort();

  const waiverKeys = new Set(
    manifest.waivers.map(function (w) {
      return `${w.from} -> ${w.to}`;
    }),
  );
  const matchedWaivers = new Set<string>();
  const unwaived: Violation[] = [];
  const waived: Violation[] = [];

  for (const pkg of packages) {
    for (const dep of pkg.prodDeps) {
      if (!byName.has(dep)) continue; // external @atlas alias / phantom
      const verdict = classifyEdge(pkg.name, dep, manifest);
      if (verdict.ok) continue;
      const key = `${pkg.name} -> ${dep}`;
      const v: Violation = { from: pkg.name, to: dep, kind: verdict.kind };
      if (waiverKeys.has(key)) {
        matchedWaivers.add(key);
        waived.push(v);
      } else {
        unwaived.push(v);
      }
    }
  }

  const staleWaivers = manifest.waivers.filter(function (w) {
    return !matchedWaivers.has(`${w.from} -> ${w.to}`);
  });

  return { unassigned, unknownNames, unwaived, waived, staleWaivers };
}

// --- emit: dep-cruiser ------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dirsForRing(ring: string, manifest: Manifest, byName: Map<string, PkgInfo>): string[] {
  return Object.entries(manifest.assignments)
    .filter(function ([, r]) {
      return r === ring;
    })
    .map(function ([name]) {
      return byName.get(name)?.dir;
    })
    .filter(function (d): d is string {
      return typeof d === 'string';
    })
    .sort();
}

function pathUnion(dirs: string[]): string {
  return `^(${dirs.map(escapeRe).join('|')})/`;
}

function emitDepCruiserRules(manifest: Manifest, packages: PkgInfo[]): string {
  const byName = new Map(
    packages.map(function (p) {
      return [p.name, p];
    }),
  );
  const allRings = Object.keys(manifest.rings);
  const sharedLeafDirs = manifest.sharedLeaves
    .map(function (n) {
      return byName.get(n)?.dir;
    })
    .filter(function (d): d is string {
      return typeof d === 'string';
    });
  const rules: string[] = [];

  for (const ring of allRings) {
    const fromDirs = dirsForRing(ring, manifest, byName);
    if (fromDirs.length === 0) continue;
    const def = manifest.rings[ring]!;
    // Forbid every ring NOT permitted by mayImport, EXCEPT the ring itself
    // (same-ring policing — module<->module, adapter<->adapter — is left to
    // the specialized no-cross-module-internals rule + the package.json
    // validator, so the modules/<x>/src/public/ escape hatch keeps working).
    const forbiddenDirs: string[] = [];
    for (const other of allRings) {
      if (other === ring) continue;
      if (def.mayImport.includes(other)) continue;
      forbiddenDirs.push(...dirsForRing(other, manifest, byName));
    }
    if (forbiddenDirs.length === 0) continue;
    const waivedToDirs = manifest.waivers
      .filter(function (w) {
        return manifest.assignments[w.from] === ring;
      })
      .map(function (w) {
        return byName.get(w.to)?.dir;
      })
      .filter(function (d): d is string {
        return typeof d === 'string';
      });
    const pathNot = [...sharedLeafDirs, ...waivedToDirs].map(function (d) {
      return `^${escapeRe(d)}/`;
    });
    rules.push(
      JSON.stringify(
        {
          name: `ring-${ring}-no-outward`,
          severity: 'error',
          comment: `Ring '${ring}' (${def.stack}) may import only [${def.mayImport.join(', ') || 'nothing'}] + sharedLeaves. See ADR 0016 / architecture/rings.json.`,
          from: { path: pathUnion(fromDirs) },
          to: pathNot.length
            ? { path: pathUnion(forbiddenDirs), pathNot }
            : { path: pathUnion(forbiddenDirs) },
        },
        null,
        2,
      ),
    );
  }

  return (
    '/**\n' +
    ' * GENERATED by scripts/gen-arch-rules.ts from architecture/rings.json.\n' +
    ' * Do NOT edit by hand. Run `pnpm arch:emit` to regenerate.\n' +
    ' * Spread into .dependency-cruiser.cjs > forbidden. ADR 0016.\n' +
    ' */\n' +
    'module.exports = [\n' +
    rules.join(',\n') +
    '\n];\n'
  );
}

// --- emit: oxlint -----------------------------------------------------------

function emitOxlintLayers(manifest: Manifest, packages: PkgInfo[]): string {
  const waiverKeys = new Set(
    manifest.waivers.map(function (w) {
      return `${w.from} -> ${w.to}`;
    }),
  );
  const overrides: unknown[] = [];

  for (const pkg of packages) {
    if (manifest.tooling.includes(pkg.name)) continue; // tooling imports anything
    if (manifest.assignments[pkg.name] === undefined) continue;
    const banned: string[] = [];
    for (const other of packages) {
      if (other.name === pkg.name) continue;
      const verdict = classifyEdge(pkg.name, other.name, manifest);
      if (verdict.ok) continue;
      if (waiverKeys.has(`${pkg.name} -> ${other.name}`)) continue;
      banned.push(other.name);
    }
    if (banned.length === 0) continue;
    overrides.push({
      files: [`${pkg.dir}/**/*.ts`, `${pkg.dir}/**/*.tsx`],
      // Test files legitimately import tooling + sibling packages for doubles;
      // dep-cruiser excludes them too. Ring bans apply to source only.
      excludeFiles: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/test/**', '**/tests/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: banned.sort(),
                message: `Ring violation (ADR 0016): ${pkg.name} may not import these packages — they are in an outer ring, a sibling ring, or a different stack. See architecture/rings.json.`,
              },
            ],
          },
        ],
      },
    });
  }

  // NOTE: oxlint rejects unknown top-level config keys, so no provenance field
  // here. This file is GENERATED by scripts/gen-arch-rules.ts (`pnpm arch:emit`)
  // from architecture/rings.json — do not edit by hand.
  return JSON.stringify({ overrides }, null, 2) + '\n';
}

// --- main -------------------------------------------------------------------

function loadManifest(): Manifest {
  const raw = readFileSync(join(REPO_ROOT, 'architecture', 'rings.json'), 'utf8');
  return JSON.parse(raw) as Manifest;
}

function main(): number {
  const manifest = loadManifest();
  const packages = discoverWorkspace();

  if (EMIT) {
    const genDir = join(REPO_ROOT, 'architecture', 'generated');
    mkdirSync(genDir, { recursive: true });
    writeFileSync(join(genDir, 'dep-cruiser-rules.cjs'), emitDepCruiserRules(manifest, packages));
    writeFileSync(join(genDir, 'oxlint-layers.json'), emitOxlintLayers(manifest, packages));
    process.stdout.write(
      'arch:emit — wrote architecture/generated/{dep-cruiser-rules.cjs,oxlint-layers.json}\n',
    );
  }

  const report = runChecks(manifest, packages);
  const fail =
    report.unassigned.length > 0 ||
    report.unknownNames.length > 0 ||
    report.unwaived.length > 0 ||
    report.staleWaivers.length > 0;

  process.stdout.write(`arch:check — ${packages.length} workspace packages\n`);
  process.stdout.write('─'.repeat(64) + '\n');

  if (report.unassigned.length) {
    process.stdout.write(
      `FAIL  ${report.unassigned.length} package(s) not assigned a ring or tooling tier:\n`,
    );
    for (const n of report.unassigned) process.stdout.write(`        ${n}\n`);
  }
  if (report.unknownNames.length) {
    process.stdout.write(
      `FAIL  ${report.unknownNames.length} manifest name(s) match no workspace package (typo/stale):\n`,
    );
    for (const n of report.unknownNames) process.stdout.write(`        ${n}\n`);
  }
  if (report.unwaived.length) {
    process.stdout.write(`FAIL  ${report.unwaived.length} un-waived ring violation(s):\n`);
    for (const v of report.unwaived)
      process.stdout.write(`        ${v.from} -> ${v.to}  (${v.kind})\n`);
  }
  if (report.staleWaivers.length) {
    process.stdout.write(
      `FAIL  ${report.staleWaivers.length} stale waiver(s) — the edge is gone, remove the waiver (ratchet):\n`,
    );
    for (const w of report.staleWaivers) process.stdout.write(`        ${w.from} -> ${w.to}\n`);
  }

  process.stdout.write(
    `\nwaivers: ${report.waived.length} active (matched), ${manifest.waivers.length} declared\n`,
  );
  if (VERBOSE) {
    for (const v of report.waived)
      process.stdout.write(`  waived: ${v.from} -> ${v.to}  (${v.kind})\n`);
  }

  process.stdout.write('─'.repeat(64) + '\n');
  if (fail) {
    process.stdout.write('Result: FAIL\n');
    return 1;
  }
  process.stdout.write(
    `Result: PASS — matrix clean, ${report.waived.length} edge(s) under active waiver.\n`,
  );
  return 0;
}

process.exit(main());
