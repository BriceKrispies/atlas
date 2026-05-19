/**
 * Tiny ESM bootstrap loaded by `new Worker(WORKER_BOOTSTRAP_URL)`.
 *
 * Node 22.6+ ships built-in TypeScript stripping, and Worker threads
 * inherit the parent's `execArgv` — so when the host process is started
 * with `--experimental-transform-types` (every Atlas entry point is),
 * the worker can `import './worker-entry.ts'` directly. No tsx, no
 * `register()`, no namespaced loader.
 *
 * This file stays `.mjs` (no TypeScript) precisely so it can be loaded
 * by the Worker without a loader being active yet. When the package is
 * later compiled to JS, the worker host's URL-resolution logic will
 * swap this file out for `worker-entry.js` directly and skip the
 * bootstrap.
 */

import './worker-entry.ts';
