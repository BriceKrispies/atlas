/**
 * @atlas/wasm-host — TypeScript WASM plugin host.
 *
 * Mirrors `crates/wasm_runtime` numerically: 16 MB memory cap,
 * 1 M fuel hint (Node-only, advisory), 5 s timeout, fresh execution
 * context per `invoke`, zero imports allowed.
 *
 * Two adapters share one execution core:
 *   - `NodeWasmHost`:    server-side, `FilesystemPluginLoader` typical.
 *   - `BrowserWasmHost`: sim mode, `InMemoryPluginLoader` typical.
 *
 * Both expose the same `WasmHost` port; tests in `@atlas/contract-tests`
 * exercise both adapters from one fixture.
 */

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
