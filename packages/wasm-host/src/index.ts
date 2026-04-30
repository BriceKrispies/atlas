/**
 * @atlas/wasm-host — TypeScript WASM plugin host.
 *
 * Mirrors `crates/wasm_runtime` numerically: 16 MB memory cap,
 * 1 M fuel hint (Node-only, advisory), 5 s timeout, fresh execution
 * context per `invoke`, zero imports allowed.
 *
 * Two adapters share one execution core:
 *   - `WorkerWasmHost`:  server-side, `FilesystemPluginLoader` typical.
 *                        Each `invoke` runs in a fresh `worker_threads`
 *                        Worker so a CPU-bound plugin can be hard-
 *                        preempted via `worker.terminate()` and the
 *                        memory cap is enforced at the V8 isolate
 *                        boundary (real OS-level cap, not post-hoc).
 *   - `BrowserWasmHost`: sim mode, `InMemoryPluginLoader` typical.
 *                        Native `WebAssembly` API; no preemption (Web
 *                        Workers are a separate, later concern).
 *
 * `NodeWasmHost` is retained as a deprecated alias for `WorkerWasmHost`
 * so pre-Chunk-12 call sites work unchanged.
 *
 * Both adapters expose the same `WasmHost` port; tests in
 * `@atlas/contract-tests` exercise both adapters from one fixture.
 */

export { WorkerWasmHost } from './worker-host.ts';
export type { WorkerWasmHostOptions } from './worker-host.ts';
export { NodeWasmHost } from './node-host.ts';
export type { NodeWasmHostOptions } from './node-host.ts';
export { BrowserWasmHost } from './browser-host.ts';
export type { BrowserWasmHostOptions } from './browser-host.ts';
export {
  FilesystemPluginLoader,
  InMemoryPluginLoader,
} from './plugin-loader.ts';
export type { FilesystemPluginLoaderOptions } from './plugin-loader.ts';
export { WasmHostError } from './errors.ts';
export type { WasmHostErrorKind } from './errors.ts';
export {
  DEFAULT_MEMORY_LIMIT_MB,
  DEFAULT_FUEL_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MAX_SERIALIZED_OUTPUT,
} from './errors.ts';
