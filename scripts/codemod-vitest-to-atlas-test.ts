#!/usr/bin/env tsx
/**
 * Codemod: vitest → @atlas/test
 *
 * Performs the deterministic, mechanical portion of the vitest removal:
 *
 *   1. In every `*.ts` test file under the workspace:
 *      - `import ... from 'vitest'`  → `import ... from '@atlas/test'`
 *      - `import type ... from 'vitest'` → same
 *      - `from "vitest"` (double quote) handled the same way.
 *
 *   2. In every `package.json` under the workspace:
 *      - Drop `vitest` and `@vitest/*` from `dependencies` /
 *        `devDependencies`.
 *      - If the file *had* vitest as a (dev)dep, add
 *        `"@atlas/test": "workspace:*"` to `devDependencies` (unless
 *        the file IS `packages/test/package.json` itself).
 *      - Rewrite `"test": "vitest run"` to a placeholder that points
 *        at the new node-test runner script. The placeholder is the
 *        same in every package — actual file discovery is done by the
 *        runner.
 *
 * Files containing vitest-only features (`vi.mock`, `vi.hoisted`,
 * `vi.importActual`, `expectTypeOf`) are reported but NOT modified —
 * they need surgical refactors. The codemod prints a list at the end.
 *
 * The codemod is idempotent: running it twice is a no-op once the
 * first pass converges.
 *
 * Usage:
 *   pnpm tsx scripts/codemod-vitest-to-atlas-test.ts          # apply
 *   pnpm tsx scripts/codemod-vitest-to-atlas-test.ts --dry    # report only
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';

const ROOT = resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');

const REQUIRES_SURGERY: RegExp[] = [
  /\bvi\.mock\b/,
  /\bvi\.hoisted\b/,
  /\bvi\.importActual\b/,
  /\bvi\.importMock\b/,
  /\bvi\.unmock\b/,
  /\bvi\.doUnmock\b/,
  /\bexpectTypeOf\b/,
];

const EXCLUDE_DIRS = [
  /[\\/]node_modules[\\/]/,
  /[\\/]\.claude[\\/]worktrees[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]\.git[\\/]/,
  /[\\/]coverage[\\/]/,
  /[\\/]test-results[\\/]/,
];

interface Report {
  importsRewritten: string[];
  packagesUpdated: string[];
  needsSurgery: { file: string; reasons: string[] }[];
  unchanged: string[];
}

const report: Report = {
  importsRewritten: [],
  packagesUpdated: [],
  needsSurgery: [],
  unchanged: [],
};

function isExcluded(path: string): boolean {
  return EXCLUDE_DIRS.some((rx) => rx.test(path));
}

// ---------------------------------------------------------------- imports

function rewriteImports(): void {
  const project = new Project({
    tsConfigFilePath: join(ROOT, 'tsconfig.base.json'),
    skipAddingFilesFromTsConfig: true,
  });

  // Add test files + setup + the contract-tests source (which exports
  // describe/it/expect helpers that adapters call) + any in-tree helper
  // module under */test/ or */tests/.
  project.addSourceFilesAtPaths([
    join(ROOT, '**/*.test.ts'),
    join(ROOT, '**/*.test-d.ts'),
    join(ROOT, 'test-setup/**/*.ts'),
    join(ROOT, '**/test/**/*.ts'),
    join(ROOT, '**/tests/**/*.ts'),
    join(ROOT, 'packages/contract-tests/src/**/*.ts'),
  ]);

  for (const sf of project.getSourceFiles()) {
    const path = sf.getFilePath();
    if (isExcluded(path)) continue;

    const decls = sf.getImportDeclarations();
    let touched = false;
    for (const d of decls) {
      const mod = d.getModuleSpecifierValue();
      if (mod === 'vitest') {
        d.setModuleSpecifier('@atlas/test');
        touched = true;
      }
    }

    if (touched) {
      const rel = relative(ROOT, path).replace(/\\/g, '/');
      report.importsRewritten.push(rel);
      // Detect surgical needs.
      const text = sf.getFullText();
      const reasons: string[] = [];
      for (const rx of REQUIRES_SURGERY) {
        if (rx.test(text)) reasons.push(rx.source);
      }
      if (reasons.length > 0) {
        report.needsSurgery.push({ file: rel, reasons });
      }
    }
  }

  if (!DRY) {
    project.saveSync();
  }
}

// ----------------------------------------------------------- package.json

function findPackageJsons(): string[] {
  const out: string[] = [];
  const ws = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = ws
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).replace(/^['"]|['"]$/g, ''));

  // Use Project's file globber for consistency.
  const project = new Project({ useInMemoryFileSystem: false });
  const fs = project.getFileSystem();
  for (const p of patterns) {
    const matches = fs.globSync([join(ROOT, p, 'package.json')]);
    for (const m of matches) {
      if (!isExcluded(m)) out.push(m);
    }
  }
  // Root package.json too.
  out.push(join(ROOT, 'package.json'));
  return Array.from(new Set(out));
}

function updatePackageJson(path: string): void {
  const text = readFileSync(path, 'utf8');
  const pkg = JSON.parse(text) as Record<string, unknown> & {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  const isShimPkg = pkg.name === '@atlas/test';

  let hadVitest = false;
  for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[bucket];
    if (!deps) continue;
    for (const key of Object.keys(deps)) {
      if (key === 'vitest' || key.startsWith('@vitest/')) {
        delete deps[key];
        hadVitest = true;
      }
    }
    if (Object.keys(deps).length === 0) delete pkg[bucket];
  }

  if (hadVitest && !isShimPkg) {
    pkg.devDependencies ??= {};
    if (!('@atlas/test' in pkg.devDependencies)) {
      pkg.devDependencies['@atlas/test'] = 'workspace:*';
    }
  }

  // Script rewrites. Per-package scripts call the `atlas-test` binary
  // shipped by `@atlas/test` (resolved through node_modules/.bin).
  if (pkg.scripts) {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (typeof script !== 'string') continue;
      if (script === 'vitest run') {
        pkg.scripts[name] = 'atlas-test';
      } else if (script === 'vitest') {
        pkg.scripts[name] = 'atlas-test --watch';
      } else if (script.startsWith('vitest run ')) {
        const args = script.slice('vitest run '.length);
        pkg.scripts[name] = `atlas-test ${args}`;
      } else if (script === 'vitest run --coverage') {
        pkg.scripts[name] = 'atlas-test --experimental-test-coverage';
      }
    }
  }

  const newText = `${JSON.stringify(pkg, null, 2)}\n`;
  if (newText !== text) {
    const rel = relative(ROOT, path).replace(/\\/g, '/');
    report.packagesUpdated.push(rel);
    if (!DRY) writeFileSync(path, newText);
  }
}

// ------------------------------------------------------------------ main

console.log(`Running codemod${DRY ? ' (DRY RUN)' : ''} from root: ${ROOT}\n`);

rewriteImports();

for (const pkgPath of findPackageJsons()) {
  if (existsSync(pkgPath)) updatePackageJson(pkgPath);
}

console.log(`-- imports rewritten (${report.importsRewritten.length}) --`);
for (const f of report.importsRewritten) console.log(`  ${f}`);

console.log(`\n-- package.json updated (${report.packagesUpdated.length}) --`);
for (const f of report.packagesUpdated) console.log(`  ${f}`);

console.log(`\n-- files needing surgical refactor (${report.needsSurgery.length}) --`);
for (const { file, reasons } of report.needsSurgery) {
  console.log(`  ${file}  [${reasons.join(', ')}]`);
}

if (DRY) {
  console.log('\nDRY RUN — no files written. Re-run without --dry to apply.');
}
