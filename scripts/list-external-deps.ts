#!/usr/bin/env tsx
// list-external-deps.ts — enumerate every dependency declared across the
// pnpm workspace that isn't an internal `@atlas/*` package. Useful as an
// audit list: what third-party surface area does Atlas actually take on?
//
// Reads pnpm-workspace.yaml's `packages:` globs, expands them, parses every
// package.json (including the repo root), and aggregates:
//   - dependencies, devDependencies, optionalDependencies, peerDependencies
//
// Filters out anything resolved via `workspace:*` and anything under the
// `@atlas/` scope — those are first-party.
//
// Flags:
//   --json       machine-readable output
//   --by-workspace  group by workspace instead of by package name
//   --kind dep|dev|opt|peer  restrict to one dep kind
//
// Exit code is always 0 — this is an inventory tool, not a gate.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();

type DepKind = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
const KIND_LABEL: Record<DepKind, string> = {
  dependencies: "dep",
  devDependencies: "dev",
  optionalDependencies: "opt",
  peerDependencies: "peer",
};

type Args = { json: boolean; byWorkspace: boolean; kindFilter: DepKind | null };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const set = new Set(argv);
  let kindFilter: DepKind | null = null;
  const kindIdx = argv.indexOf("--kind");
  if (kindIdx >= 0) {
    const v = argv[kindIdx + 1];
    const map: Record<string, DepKind> = {
      dep: "dependencies",
      dev: "devDependencies",
      opt: "optionalDependencies",
      peer: "peerDependencies",
    };
    if (v && map[v]) kindFilter = map[v]!;
    else {
      process.stderr.write(`unknown --kind value: ${String(v)} (expected dep|dev|opt|peer)\n`);
      process.exit(2);
    }
  }
  return { json: set.has("--json"), byWorkspace: set.has("--by-workspace"), kindFilter };
}

// Minimal pnpm-workspace.yaml reader — we only need the `packages:` list of
// glob strings. Avoids pulling in a YAML dep.
function readWorkspaceGlobs(): string[] {
  const path = join(ROOT, "pnpm-workspace.yaml");
  if (!existsSync(path)) return [];
  const src = readFileSync(path, "utf8");
  const globs: string[] = [];
  let inPackages = false;
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s+(['"]?)(.+?)\1\s*$/.exec(line);
      if (m) globs.push(m[2]!);
      else if (/^\S/.test(line)) inPackages = false; // next top-level key
    }
  }
  return globs;
}

// Expand a glob of the form `dir`, `dir/sub`, or `dir/*` to filesystem dirs.
// Workspace globs in this repo are simple (no `**`, no brace expansion); a
// minimal expander is enough.
function expandGlob(glob: string): string[] {
  const parts = glob.split("/");
  let candidates: string[] = [ROOT];
  for (const part of parts) {
    const next: string[] = [];
    for (const base of candidates) {
      if (part === "*") {
        if (!existsSync(base)) continue;
        for (const entry of readdirSync(base)) {
          const p = join(base, entry);
          if (statSync(p).isDirectory()) next.push(p);
        }
      } else {
        const p = join(base, part);
        if (existsSync(p) && statSync(p).isDirectory()) next.push(p);
      }
    }
    candidates = next;
  }
  return candidates;
}

type Workspace = { name: string; dir: string };

function discoverWorkspaces(): Workspace[] {
  const globs = readWorkspaceGlobs();
  const seen = new Map<string, Workspace>();
  // include the repo root as a workspace — its devDeps are real
  const rootPkg = readPkg(ROOT);
  if (rootPkg) seen.set(ROOT, { name: rootPkg.name ?? "<root>", dir: ROOT });
  for (const g of globs) {
    for (const dir of expandGlob(g)) {
      if (seen.has(dir)) continue;
      const pkg = readPkg(dir);
      if (!pkg) continue;
      seen.set(dir, { name: pkg.name ?? relative(ROOT, dir), dir });
    }
  }
  return [...seen.values()].sort(function (a, b) { return a.name.localeCompare(b.name); });
}

type PkgJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readPkg(dir: string): PkgJson | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PkgJson;
  } catch (err) {
    process.stderr.write(`warn: cannot parse ${path}: ${(err as Error).message}\n`);
    return null;
  }
}

type DepRow = {
  name: string;
  spec: string;
  kind: DepKind;
  workspace: string;
};

function collectExternals(workspaces: Workspace[], kindFilter: DepKind | null): DepRow[] {
  const out: DepRow[] = [];
  const kinds: DepKind[] = kindFilter
    ? [kindFilter]
    : ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const ws of workspaces) {
    const pkg = readPkg(ws.dir);
    if (!pkg) continue;
    for (const kind of kinds) {
      const deps = pkg[kind];
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (name.startsWith("@atlas/")) continue;
        if (typeof spec === "string" && spec.startsWith("workspace:")) continue;
        out.push({ name, spec, kind, workspace: ws.name });
      }
    }
  }
  return out;
}

function renderByName(rows: DepRow[]): string {
  // group by name, then list versions + the workspaces that hold each version
  const byName = new Map<string, DepRow[]>();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r);
  }
  const names = [...byName.keys()].sort(function (a, b) { return a.localeCompare(b); });
  const lines: string[] = [];
  lines.push("");
  lines.push(`─── external deps across ${countWorkspaces(rows)} workspaces ─────────────`);
  lines.push(`  ${names.length} unique package names, ${rows.length} total declarations`);
  lines.push("───────────────────────────────────────────────────────────────");
  for (const name of names) {
    const group = byName.get(name)!;
    const byVersion = new Map<string, DepRow[]>();
    for (const r of group) {
      if (!byVersion.has(r.spec)) byVersion.set(r.spec, []);
      byVersion.get(r.spec)!.push(r);
    }
    const versions = [...byVersion.keys()].sort();
    const drift = versions.length > 1 ? " ⚠ version-drift" : "";
    lines.push(`  ${name}${drift}`);
    for (const v of versions) {
      const holders = byVersion.get(v)!;
      const tags = holders.map(function (h) { return `${h.workspace}[${KIND_LABEL[h.kind]}]`; }).join(", ");
      lines.push(`      ${v}  ←  ${tags}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderByWorkspace(rows: DepRow[]): string {
  const byWs = new Map<string, DepRow[]>();
  for (const r of rows) {
    if (!byWs.has(r.workspace)) byWs.set(r.workspace, []);
    byWs.get(r.workspace)!.push(r);
  }
  const names = [...byWs.keys()].sort(function (a, b) { return a.localeCompare(b); });
  const lines: string[] = [];
  lines.push("");
  lines.push(`─── external deps by workspace ────────────────────────────────`);
  lines.push(`  ${names.length} workspaces, ${rows.length} total declarations`);
  lines.push("───────────────────────────────────────────────────────────────");
  for (const ws of names) {
    const group = byWs.get(ws)!.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    lines.push(`  ${ws}  (${group.length})`);
    for (const r of group) {
      lines.push(`      [${KIND_LABEL[r.kind]}] ${r.name}  ${r.spec}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function countWorkspaces(rows: DepRow[]): number {
  return new Set(rows.map(function (r) { return r.workspace; })).size;
}

function main(): never {
  const args = parseArgs();
  const workspaces = discoverWorkspaces();
  const rows = collectExternals(workspaces, args.kindFilter);

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          root: resolve(ROOT),
          workspaceCount: workspaces.length,
          declarationCount: rows.length,
          uniqueNameCount: new Set(rows.map(function (r) { return r.name; })).size,
          rows,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const text = args.byWorkspace ? renderByWorkspace(rows) : renderByName(rows);
  process.stdout.write(text);
  process.exit(0);
}

main();
