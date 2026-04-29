/**
 * Plugin execution errors. Mirrors the Rust `PluginError` taxonomy
 * (`crates/wasm_runtime/src/lib.rs`).
 */
export type WasmHostErrorKind =
  | 'HasImports'
  | 'MissingExport'
  | 'ExecutionFailed'
  | 'Timeout'
  | 'InvalidOutput'
  | 'LoadFailed';

export class WasmHostError extends Error {
  readonly kind: WasmHostErrorKind;
  readonly detail: string;
  constructor(kind: WasmHostErrorKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.detail = detail;
  }
}

export const DEFAULT_MEMORY_LIMIT_MB = 16;
export const DEFAULT_FUEL_LIMIT = 1_000_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
/** ≤ 1 MB serialized output. Matches Rust `render_tree::MAX_SERIALIZED_SIZE`. */
export const MAX_SERIALIZED_OUTPUT = 1 << 20;
/** WASM page size (64 KB). */
export const WASM_PAGE_SIZE = 64 * 1024;
