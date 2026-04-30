/**
 * WasmHost — zero-authority WASM plugin sandbox.
 *
 * Mirrors `crates/wasm_runtime/src/lib.rs` numerically:
 *   - Default memory limit: 16 MB.
 *   - Default fuel limit: 1,000,000 instructions (Node only — browser
 *     `WebAssembly` API has no fuel concept).
 *   - Default wall-clock timeout: 5 seconds.
 *   - Fresh execution context per `invoke` (no shared state).
 *   - Zero host imports allowed — modules with imports are rejected.
 *
 * The port is implemented twice: a Node adapter (full Node `WebAssembly`
 * + Worker-thread isolation for timeout enforcement) and a browser
 * adapter (sim mode — Promise.race timeout, no worker isolation).
 */
export interface WasmInvocation {
  /** Resolves to .wasm bytes via the configured loader. */
  pluginRef: string;
  /** Serialised to JSON, written into WASM memory at `alloc()`. */
  input: unknown;
  /** Default 16. */
  memoryLimitMb?: number;
  /** Default 1_000_000. Node-only (browser WebAssembly has no fuel). */
  fuelLimit?: number;
  /** Default 5000 ms. */
  timeoutMs?: number;
}

export interface WasmHost {
  /**
   * Execute a plugin. Returns the parsed JSON output of the plugin's
   * `render(ptr, len) -> i64` export. Throws `WasmHostError` on any
   * sandbox violation, timeout, or invalid output.
   */
  invoke(invocation: WasmInvocation): Promise<unknown>;
}

/**
 * Plugin-loader port — resolves a `pluginRef` to the plugin's `.wasm`
 * bytes. Mirrors the Rust `WASM_PLUGIN_DIR` lookup.
 */
export interface WasmPluginLoader {
  load(pluginRef: string): Promise<Uint8Array>;
}
