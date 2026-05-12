/**
 * Pure-JavaScript WASM plugin executor — runs on top of the native
 * `WebAssembly` API. Used by both the Node and browser adapters; the
 * adapters layer on top to add timeout enforcement and (Node) optional
 * worker-thread isolation.
 *
 * Mirrors `execute_plugin_sync` in `crates/wasm_runtime/src/lib.rs` step
 * for step:
 *   1. Compile the module bytes.
 *   2. Reject any module that has imports (zero-authority).
 *   3. Instantiate with empty imports, fresh memory.
 *   4. Resolve required exports: `memory`, `alloc`, `render`.
 *   5. Allocate input bytes inside WASM memory, write JSON.
 *   6. Call `render(ptr, len) -> i64`. Lower 32 bits = output ptr,
 *      upper 32 bits = output length.
 *   7. Read the output, validate ≤ 1 MB, parse as JSON, must be an
 *      object.
 *
 * Note on fuel: the native WebAssembly API offers no instruction
 * limit, so this executor cannot enforce one. Wall-clock timeout is
 * the caller's responsibility (Node uses a Worker; browser uses
 * Promise.race). Memory cap is enforced by `WebAssembly.Memory`'s
 * `maximum` parameter when the module declares its own memory; for
 * modules that import memory we'd inject a pre-built one, but
 * zero-authority rules out that path entirely.
 */

import {
  WasmHostError,
  MAX_SERIALIZED_OUTPUT,
  WASM_PAGE_SIZE,
  DEFAULT_MEMORY_LIMIT_MB,
} from './errors.ts';

interface PluginExports {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  render: (ptr: number, len: number) => bigint;
}

/**
 * Extract a string message from an unknown caught throwable without an
 * unsafe `as Error` assertion. Falls back to `String(err)` for non-Error
 * values (rejected primitives, etc.).
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Coerce a render-export return value to bigint. Engines that store the
 * value in a JS number when it fits are permitted to return number; we
 * normalise both via `BigInt(...)`. Any other shape is a host/engine
 * contract violation and surfaces as `ExecutionFailed`.
 */
function coerceToBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' || typeof value === 'boolean') return BigInt(value);
  throw new TypeError(
    `render export returned non-numeric value of type ${typeof value}`,
  );
}

export interface ExecuteOptions {
  memoryLimitMb?: number;
}

/**
 * Compile + zero-authority check. Throws `WasmHostError` with kind
 * `LoadFailed` or `HasImports` on failure.
 */
export async function compileAndValidate(
  bytes: Uint8Array,
): Promise<WebAssembly.Module> {
  let module: WebAssembly.Module;
  try {
    // `compile` accepts BufferSource. The Uint8Array's underlying buffer
    // may be `ArrayBufferLike` (could be SharedArrayBuffer in theory);
    // we copy into a fresh ArrayBuffer to satisfy the strict overload
    // and to avoid any chance that the caller's buffer mutates mid-compile.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    module = await WebAssembly.compile(ab);
  } catch (e) {
    throw new WasmHostError(
      'LoadFailed',
      `compilation failed: ${errorMessage(e)}`,
    );
  }
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    throw new WasmHostError(
      'HasImports',
      `module has ${imports.length} import(s), expected zero`,
    );
  }
  return module;
}

/**
 * Run the plugin against a pre-validated module. Caller is responsible
 * for compiling + zero-authority check + timeout enforcement.
 */
export async function runModule(
  module: WebAssembly.Module,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<unknown> {
  const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
  const memoryLimitPages = Math.ceil((memoryLimitMb * 1024 * 1024) / WASM_PAGE_SIZE);

  // Encode input.
  let inputBytes: Uint8Array;
  try {
    inputBytes = new TextEncoder().encode(JSON.stringify(input));
  } catch (e) {
    throw new WasmHostError(
      'ExecutionFailed',
      `failed to serialize input: ${errorMessage(e)}`,
    );
  }

  // Instantiate with empty imports. Zero-authority is already verified.
  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(module, {});
  } catch (e) {
    throw new WasmHostError(
      'ExecutionFailed',
      `instantiation failed: ${errorMessage(e)}`,
    );
  }

  // Resolve required exports.
  const exportsRaw = instance.exports as Record<string, unknown>;
  const memory = exportsRaw['memory'];
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new WasmHostError('MissingExport', 'memory');
  }
  const alloc = exportsRaw['alloc'];
  if (typeof alloc !== 'function') {
    throw new WasmHostError('MissingExport', 'alloc');
  }
  const render = exportsRaw['render'];
  if (typeof render !== 'function') {
    throw new WasmHostError('MissingExport', 'render');
  }

  // `memory`, `alloc`, `render` have all been narrowed above via runtime
  // guards (`instanceof WebAssembly.Memory` / `typeof === 'function'`).
  // The function-shape narrowing TypeScript can express is just
  // `Function`, so we re-express the signatures at this single boundary
  // point — the WASM ABI is the source of truth for these types.
  const exports: PluginExports = {
    memory,
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: wasm-export-signature
    alloc: alloc as unknown as (len: number) => number,
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: wasm-export-signature
    render: render as unknown as (ptr: number, len: number) => bigint,
  };

  // Memory cap. A module declares its own memory's `maximum` (or doesn't);
  // we enforce it after instantiation by checking the current page count
  // against our limit and inspecting any growth attempts. The native API
  // doesn't let us *inject* a maximum, so the cap below is best-effort:
  // we abort if the plugin has already grown past the limit by the time
  // it returns. The Rust StoreLimitsBuilder does the same on a per-grow
  // basis; without a host hook we settle for post-hoc enforcement.
  if (exports.memory.buffer.byteLength > memoryLimitPages * WASM_PAGE_SIZE) {
    throw new WasmHostError(
      'ExecutionFailed',
      `memory exceeds ${memoryLimitMb} MB limit`,
    );
  }

  // Allocate + write input.
  const inputLen = inputBytes.length;
  let inputPtr: number;
  try {
    inputPtr = exports.alloc(inputLen);
  } catch (e) {
    throw new WasmHostError(
      'ExecutionFailed',
      `alloc call failed: ${errorMessage(e)}`,
    );
  }
  if (!Number.isFinite(inputPtr) || inputPtr <= 0) {
    throw new WasmHostError('ExecutionFailed', `alloc returned invalid pointer: ${inputPtr}`);
  }
  try {
    new Uint8Array(exports.memory.buffer).set(inputBytes, inputPtr);
  } catch (e) {
    throw new WasmHostError(
      'ExecutionFailed',
      `failed to write input to WASM memory: ${errorMessage(e)}`,
    );
  }

  // Invoke render.
  let packed: bigint;
  try {
    const r: unknown = exports.render(inputPtr, inputLen);
    // Some engines may return a Number when the value fits — coerce both shapes.
    packed = coerceToBigInt(r);
  } catch (e) {
    throw new WasmHostError(
      'ExecutionFailed',
      `render call failed: ${errorMessage(e)}`,
    );
  }

  // Final memory cap check (catch growth during render).
  if (exports.memory.buffer.byteLength > memoryLimitPages * WASM_PAGE_SIZE) {
    throw new WasmHostError(
      'ExecutionFailed',
      `memory exceeds ${memoryLimitMb} MB limit`,
    );
  }

  // Unpack: lower 32 bits = ptr, upper 32 bits = len.
  const lowMask = 0xffff_ffffn;
  const outPtr = Number(packed & lowMask);
  const outLen = Number((packed >> 32n) & lowMask);

  if (outLen <= 0 || outPtr < 0) {
    throw new WasmHostError(
      'InvalidOutput',
      `invalid result pointer/length: ptr=${outPtr}, len=${outLen}`,
    );
  }
  if (outLen > MAX_SERIALIZED_OUTPUT) {
    throw new WasmHostError(
      'InvalidOutput',
      `serialized output exceeds 1 MB limit (${outLen} bytes)`,
    );
  }
  if (outPtr + outLen > exports.memory.buffer.byteLength) {
    throw new WasmHostError(
      'InvalidOutput',
      `output bounds exceed WASM memory: ptr=${outPtr}, len=${outLen}`,
    );
  }

  // Read + parse.
  const outputBuf = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();
  let output: unknown;
  try {
    output = JSON.parse(new TextDecoder().decode(outputBuf));
  } catch (e) {
    const preview = new TextDecoder().decode(
      outputBuf.subarray(0, Math.min(200, outputBuf.length)),
    );
    throw new WasmHostError(
      'InvalidOutput',
      `not valid JSON: ${errorMessage(e)} (output: ${preview})`,
    );
  }
  if (
    output === null ||
    typeof output !== 'object' ||
    Array.isArray(output)
  ) {
    throw new WasmHostError('InvalidOutput', 'output must be a JSON object');
  }

  return output;
}
