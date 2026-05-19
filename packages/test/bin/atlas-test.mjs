#!/usr/bin/env node
/**
 * `atlas-test` — node-runtime entry-point for `@atlas/test`.
 *
 * Requires Node 22.6+ (we target 24): TypeScript syntax is handled by
 * Node's built-in type-stripping plus `--experimental-transform-types`.
 * No tsx, no esbuild — `node --test` is the whole runtime path.
 *
 * Discovery rules (matching the legacy vitest.config.ts include set):
 *   - From cwd: `**\/*.test.ts` excluding node_modules, dist, .claude.
 *   - Honors positional CLI args as explicit file/dir paths.
 *
 * Setup files (`test-setup/linkedom-shims.ts`, `test-setup/identity-crypto.ts`)
 * are loaded via the `.mjs` bootstrap if found at the repo root and the
 * env opts in (`ATLAS_TEST_SETUP=auto`, default for repo-root invocations).
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const SHIM_PKG_ROOT = resolve(BIN_DIR, '..');
const REPO_ROOT = resolve(SHIM_PKG_ROOT, '..', '..');

/**
 * Frontend apps host Playwright specs (`test.describe` from
 * `@playwright/test`) which Node's test runner must not collect — they
 * crash on import. Apps that ARE node-only (`projection-worker`,
 * `atlasctl`, `server`) opt in by virtue of NOT being in this list. The
 * `tests/integration` + `tests/blackbox` dirs are also Playwright.
 *
 * Path-suffix match against forward-slashed cwd-relative path.
 */
const EXCLUDED_PATH_SUFFIXES = [
  '/apps/admin',
  '/apps/authoring',
  '/apps/sandbox',
  '/apps/sim',
  '/apps/control-plane',
  '/tests/integration',
  '/tests/blackbox',
];

function isExcludedPath(full) {
  const norm = full.replace(/\\/g, '/');
  return EXCLUDED_PATH_SUFFIXES.some((s) => norm.endsWith(s) || norm.includes(s + '/'));
}

/** Recursively collect *.test.ts files under `dir`, skipping excluded subtrees. */
function collectTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === '.claude' ||
        entry.name === 'test-results' ||
        entry.name === 'coverage' ||
        entry.name === 'playwright-report'
      ) continue;
      if (isExcludedPath(full)) continue;
      collectTests(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const positional = [];
const passthrough = [];
for (const a of args) {
  if (a.startsWith('-')) passthrough.push(a);
  else positional.push(a);
}

const cwd = process.cwd();
let files = [];

if (positional.length > 0) {
  for (const p of positional) {
    const abs = resolve(cwd, p);
    try {
      const st = statSync(abs);
      if (st.isDirectory()) {
        collectTests(abs, files);
      } else {
        files.push(abs);
      }
    } catch {
      console.error(`atlas-test: cannot stat ${abs}`);
      process.exit(2);
    }
  }
} else {
  collectTests(cwd, files);
}

if (files.length === 0) {
  console.error(`atlas-test: no *.test.ts found under ${cwd}`);
  process.exit(0);
}

// Setup-file injection. The legacy vitest run injected two setup files
// globally:
//   - `test-setup/linkedom-shims.ts` — DOM globals for any test that
//     imports an AtlasElement transitively.
//   - `test-setup/identity-crypto.ts` — wires the identity module's
//     Crypto resolver to node:crypto.
// We only auto-load them when running from the repo root, because
// the identity-crypto file imports `@atlas/identity` which isn't a
// devDependency of every workspace package. Per-package invocations
// should opt in via env or rely on the test file importing what it
// needs directly.
//
// Override behavior:
//   ATLAS_TEST_SETUP=auto   (default at repo root) — load both
//   ATLAS_TEST_SETUP=dom    — load only linkedom-shims
//   ATLAS_TEST_SETUP=none   — load nothing
const setupArgs = [];
const atRepoRoot = resolve(cwd) === REPO_ROOT;
// Default behaviour:
//   - At repo root: load `linkedom-shims` + `identity-crypto` (matches the
//     pre-vitest-removal `setupFiles` list).
//   - In a single workspace: load `linkedom-shims` if the package declares
//     `linkedom` as a (dev)dependency (UI tests need DOM globals).
//     Skip `identity-crypto` — only the identity module needs it.
// Override with `ATLAS_TEST_SETUP=none|dom|auto`.
const setupMode = process.env.ATLAS_TEST_SETUP ?? (atRepoRoot ? 'auto' : 'pkg');
const setupCandidates = [];
if (setupMode === 'auto') {
  setupCandidates.push('linkedom-shims.ts', 'identity-crypto.ts');
} else if (setupMode === 'dom') {
  setupCandidates.push('linkedom-shims.ts');
} else if (setupMode === 'pkg') {
  // Auto-detect per package:
  //   - DOM shims when `linkedom` is a (dev)dependency.
  //   - identity-crypto when the package IS `@atlas/identity` or
  //     declares it as a dep (the wire is global and lazy in identity).
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const { readFileSync } = await import('node:fs');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('linkedom' in deps) setupCandidates.push('linkedom-shims.ts');
      if (pkg.name === '@atlas/identity' || '@atlas/identity' in deps) {
        setupCandidates.push('identity-crypto.ts');
      }
    }
  } catch {
    // ignore — proceed without setup
  }
}
const setupUrls = [];
for (const name of setupCandidates) {
  const p = join(REPO_ROOT, 'test-setup', name);
  if (existsSync(p)) setupUrls.push(pathToFileURL(p).href);
}

// Bootstrap chain-loads setup files; type-stripping is native to Node
// 22.6+ (default in 24). `--experimental-transform-types` is needed to
// handle parameter-property constructors that the default
// `--experimental-strip-types` doesn't rewrite. Both flags emit an
// experimental-feature warning we suppress via `--no-warnings`.
const BOOTSTRAP = pathToFileURL(join(BIN_DIR, 'node-bootstrap.mjs')).href;
const nodeArgs = [
  '--no-warnings',
  '--experimental-transform-types',
  '--import', BOOTSTRAP,
  '--test',
  ...passthrough,
  ...files,
];

// Pass the setup files via env so the bootstrap can load them in BOTH
// the main process and any worker threads (which inherit the parent's
// `--import` flag and therefore replay node-bootstrap.mjs).
const env = {
  ...process.env,
  ATLAS_TEST_SETUP_FILES: setupUrls.join(';'),
};

const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
