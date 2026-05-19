/**
 * Bootstrap loaded via `--import` from the `atlas-test` runner.
 *
 * Node 22+ (we require 24) strips TypeScript syntax natively, so this
 * bootstrap only needs to chain-load the global setup files — no tsx
 * loader required. `transform-types` is enabled via the runner's CLI
 * flag because the codebase still uses parameter-property constructors,
 * which `--experimental-strip-types` (the default) leaves intact.
 *
 * Setup file paths arrive in `ATLAS_TEST_SETUP_FILES` (file URLs,
 * `;`-delimited). Empty/unset = no setup. Setup imports are skipped in
 * Worker threads because code-under-test workers (e.g. @atlas/wasm-host)
 * have tight memory caps and don't need DOM globals.
 */

import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
  const raw = process.env.ATLAS_TEST_SETUP_FILES ?? '';
  if (raw) {
    for (const url of raw.split(';').filter(Boolean)) {
      await import(url);
    }
  }
}
