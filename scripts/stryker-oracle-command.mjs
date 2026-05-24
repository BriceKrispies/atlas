#!/usr/bin/env node
/**
 * Stryker `commandRunner` wrapper for the oracle config.
 *
 * Bypasses `atlas-test` entirely and invokes `node --test` directly
 * against the parity test subset. atlas-test's setup-file resolution
 * goes through the symlinked `@atlas/identity` package, which under
 * ESM differs from the sandbox-relative `'../src/index.ts'` path the
 * test uses — same code, different module instance, `setIdentityCrypto`
 * lands on the wrong instance.
 *
 * `--import scripts/stryker-oracle-setup.mjs` resolves identity via the
 * sandbox cwd, matching the test's URL. One module instance, crypto
 * wired, tests pass.
 *
 * Spec: `C:\Users\Brice\.claude\plans\twinkly-popping-deer.md`
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SETUP = pathToFileURL(resolve(process.cwd(), 'scripts/stryker-oracle-setup.mjs')).href;
const TARGET = 'modules/identity/test/handlers.test.ts';

const result = spawnSync(
  process.execPath,
  [
    '--no-warnings',
    '--experimental-transform-types',
    '--import', SETUP,
    '--test',
    TARGET,
  ],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
