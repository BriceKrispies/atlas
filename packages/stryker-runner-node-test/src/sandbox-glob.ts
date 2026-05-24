/**
 * Discover `*.test.ts` files under a directory using Atlas's
 * exclusion rules. Mirror of `packages/test/bin/atlas-test.mjs`'s
 * walker — kept in sync deliberately so the Stryker plugin sees the
 * same test surface as `pnpm test`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Mirror of atlas-test.mjs lines 36-44 — see that file's header for
// rationale (Playwright apps + integration-shaped trees must be
// skipped from node:test discovery).
const EXCLUDED_PATH_SUFFIXES = [
  '/apps/admin',
  '/apps/authoring',
  '/apps/sandbox',
  '/apps/sim',
  '/apps/control-plane',
  '/tests/integration',
  '/tests/blackbox',
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.claude',
  'test-results',
  'coverage',
  'playwright-report',
  '.stryker-tmp',
  'reports',
]);

function isExcludedPath(absPath: string): boolean {
  const posix = absPath.split(sep).join('/');
  for (const suffix of EXCLUDED_PATH_SUFFIXES) {
    if (posix.endsWith(suffix)) return true;
    if (posix.includes(suffix + '/')) return true;
  }
  return false;
}

function walk(dir: string, out: string[]): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (isExcludedPath(abs)) continue;
      walk(abs, out);
      continue;
    }
    if (stats.isFile() && name.endsWith('.test.ts')) {
      out.push(abs);
    }
  }
}

/**
 * Recursively walk `cwd` and return POSIX-style relative paths to
 * every `*.test.ts` file, applying the same exclusion list as
 * atlas-test.
 */
export function discoverTestFiles(cwd: string): readonly string[] {
  const found: string[] = [];
  walk(cwd, found);
  return found.map(function (abs) {
    return relative(cwd, abs).split(sep).join('/');
  });
}
