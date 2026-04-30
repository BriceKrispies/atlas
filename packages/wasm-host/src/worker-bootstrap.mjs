/**
 * Tiny ESM bootstrap that loads the real `worker-entry.ts` inside the
 * Worker thread via tsx's `tsImport` API. Required because Node's
 * `register()`-installed loaders are scoped to the thread that called
 * `register()` — they DO NOT propagate to Workers even when the parent
 * passes `execArgv: ['--import', 'tsx/esm']`. Older `--experimental-
 * loader` flags are deprecated.
 *
 * `tsImport` from `tsx/esm/api` registers a private namespaced loader
 * scoped to this caller, then resolves the requested specifier through
 * it. That keeps the shim free of side effects on the rest of the
 * isolate.
 *
 * This file stays `.mjs` (no TypeScript) precisely so it can be loaded
 * by the Worker without a loader being active yet. When the package is
 * later compiled to JS, the worker host's URL-resolution logic will
 * swap this file out for `worker-entry.js` directly and skip the
 * bootstrap.
 */

import { tsImport } from 'tsx/esm/api';

await tsImport('./worker-entry.ts', import.meta.url);
