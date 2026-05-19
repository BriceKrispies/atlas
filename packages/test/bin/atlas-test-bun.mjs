#!/usr/bin/env node
/**
 * `atlas-test-bun` — delegates to `bun test` with our discovery rules.
 *
 * Why a wrapper instead of `bun test` directly: bun's default file
 * discovery globs from cwd which is close to what we want, but we also
 * need to preload setup files (linkedom-shims, identity-crypto) — we
 * pass them through `--preload`.
 *
 * Per-package scripts can call `atlas-test-bun [paths...]` exactly like
 * `atlas-test`. Any flag starting with `-` is passed through to `bun test`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const SHIM_PKG_ROOT = resolve(BIN_DIR, '..');
const REPO_ROOT = resolve(SHIM_PKG_ROOT, '..', '..');

const args = process.argv.slice(2);
const positional = [];
const passthrough = [];
for (const a of args) {
  if (a.startsWith('-')) passthrough.push(a);
  else positional.push(a);
}

// Same exclusion set as atlas-test.mjs (frontend apps host Playwright
// specs; bun would fail loading them just like node does).
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

// File discovery: positional args are explicit paths (file or dir). If none
// supplied, walk cwd. Either way bun receives a flat list of paths.
const cwd = process.cwd();
let files = [];
if (positional.length > 0) {
  for (const p of positional) {
    const abs = resolve(cwd, p);
    try {
      const st = statSync(abs);
      if (st.isDirectory()) collectTests(abs, files);
      else files.push(abs);
    } catch {
      console.error(`atlas-test-bun: cannot stat ${abs}`);
      process.exit(2);
    }
  }
} else {
  collectTests(cwd, files);
}

if (files.length === 0) {
  console.error(`atlas-test-bun: no *.test.ts found under ${cwd}`);
  process.exit(0);
}

// Bun preload for global setup files (if present at repo root).
const preloads = [];
for (const f of ['linkedom-shims.ts', 'identity-crypto.ts']) {
  const p = join(REPO_ROOT, 'test-setup', f);
  if (existsSync(p)) preloads.push('--preload', p);
}

const bunArgs = [
  'test',
  ...preloads,
  ...passthrough,
  ...files,
];

const child = spawn('bun', bunArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
