/**
 * Bootstrap loaded via `--import` from the `atlas-test` runner. Registers
 * tsx, then awaits any setup files the caller asked for. Plain `.mjs` so it
 * loads in fresh Worker threads (which inherit parent execArgv) without
 * needing tsx already registered.
 *
 * Setup file paths are passed via `ATLAS_TEST_SETUP_FILES` (file URLs,
 * `;`-delimited). Empty/unset = no setup. The runner builds the env var
 * before spawning node.
 */

import { register } from 'tsx/esm/api';
import { isMainThread } from 'node:worker_threads';

// tsx's programmatic `register()` installs the ESM loader for the current
// thread. Loader hooks aren't inherited by Workers automatically, but
// because this bootstrap is `.mjs` it CAN be re-loaded inside Workers
// via the parent's --import propagation — and re-running `register()` in
// the Worker gives it the same `.ts` resolution as the main thread.
register();

// Setup files (linkedom-shims, identity-crypto) run ONLY in the main test
// process — not in Worker threads spawned by code-under-test (e.g.
// @atlas/wasm-host). Workers have tight resourceLimits and don't need
// DOM globals; loading the setup there just bloats memory and trips
// `maxOldGenerationSizeMb`.
if (isMainThread) {
  const raw = process.env.ATLAS_TEST_SETUP_FILES ?? '';
  if (raw) {
    for (const url of raw.split(';').filter(Boolean)) {
      await import(url);
    }
  }
}
