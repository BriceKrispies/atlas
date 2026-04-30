/**
 * Node-side WasmHost adapter backed by `worker_threads` for hard
 * preemption. Restores zero-authority parity with the Rust Wasmtime
 * runtime by closing the last gap from the 8/9/10 architectural audit:
 * a CPU-bound or buggy plugin can no longer wedge the main event loop
 * because every invocation runs in a fresh Worker thread that we can
 * `terminate()` when the timeout fires.
 *
 * Option A — one worker per invocation. Production fresh-Worker tax
 * is ~5–20 ms on Node 22 (single-digit ms on warm machines), tiny
 * next to the plugin's own work for the render hot path. In dev/test
 * the cost rises to ~150–250 ms because the worker entry is loaded
 * via tsx's `tsImport` (compile-on-the-fly TypeScript inside the
 * Worker isolate); when the package is compiled to JS the bootstrap
 * shim is bypassed and the cost drops back to the production figure.
 * A pool would shave that latency at the cost of a recycle protocol
 * on timeout (terminated worker must be replaced); not worth the
 * extra surface for the current use cases. The trade-off is
 * documented in the commit message; revisit if a future profile
 * shows the spawn cost dominates.
 *
 * Resource caps:
 *   - `resourceLimits.maxOldGenerationSizeMb` on the Worker constructor
 *     is the REAL OS-level memory cap — the plugin can't allocate past
 *     it, the V8 isolate aborts the worker first. Pre-Chunk 12 we did a
 *     post-hoc check that ran AFTER memory had already grown.
 *   - Wall-clock timeout: `setTimeout` outside the worker fires
 *     `worker.terminate()`, which interrupts any CPU-bound code mid-
 *     instruction. Pre-Chunk 12 we did `Promise.race` against work
 *     that ran on the main loop — useless against `(loop br 0)`.
 *   - Fuel: still no native instruction-counter hook in the
 *     `WebAssembly` API, so `fuelLimit` remains accepted-but-unused.
 *     The wall-clock cap covers the real concern.
 *
 * The browser host is unmodified — Web Workers are a separate, later
 * concern (different lifecycle, different transferable rules).
 */

import { Worker } from 'node:worker_threads';
import type {
  WasmHost,
  WasmInvocation,
  WasmPluginLoader,
} from '@atlas/ports';
import {
  WasmHostError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MEMORY_LIMIT_MB,
} from './errors.ts';
import type { WasmHostErrorKind } from './errors.ts';
import type {
  WorkerInvocationMessage,
  WorkerResultMessage,
} from './worker-entry.ts';

export interface WorkerWasmHostOptions {
  loader: WasmPluginLoader;
}

/**
 * URL passed to `new Worker(...)`. In dev/test we load a tiny `.mjs`
 * shim that pulls in `worker-entry.ts` via tsx's `tsImport` — Node
 * loaders registered in the parent (`--import tsx/esm`) DO NOT
 * propagate into Worker threads, so the shim is the simplest way to
 * make a `.ts` entry loadable inside a worker without polluting the
 * host's isolate. When the package is compiled to JS the host can
 * point straight at `./worker-entry.js`; the bootstrap shim is dev-
 * only ergonomics.
 */
const WORKER_BOOTSTRAP_URL = new URL('./worker-bootstrap.mjs', import.meta.url);

export class WorkerWasmHost implements WasmHost {
  readonly #loader: WasmPluginLoader;

  constructor(options: WorkerWasmHostOptions) {
    this.#loader = options.loader;
  }

  async invoke(invocation: WasmInvocation): Promise<unknown> {
    const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitMb = invocation.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;

    // Sub-zero / zero timeouts: bail before touching the loader, same
    // semantics as the Rust host's `tokio::time::timeout(Duration::ZERO, _)`.
    if (timeoutMs <= 0) {
      throw new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`);
    }

    const deadline = Date.now() + timeoutMs;
    const bytes = await this.#loader.load(invocation.pluginRef);
    if (Date.now() >= deadline) {
      throw new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`);
    }

    const remaining = Math.max(0, deadline - Date.now());
    return await runInWorker({
      pluginRef: invocation.pluginRef,
      bytes,
      input: invocation.input,
      memoryLimitMb,
      timeoutMs: remaining,
    });
  }
}

interface RunInWorkerArgs {
  readonly pluginRef: string;
  readonly bytes: Uint8Array;
  readonly input: unknown;
  readonly memoryLimitMb: number;
  readonly timeoutMs: number;
}

async function runInWorker(args: RunInWorkerArgs): Promise<unknown> {
  // `eval: false` is the default but state it for clarity — we never
  // pass arbitrary source. The entry is a fixed file URL.
  const worker = new Worker(WORKER_BOOTSTRAP_URL, {
    eval: false,
    resourceLimits: {
      // V8 hard cap. When the plugin's allocations push the old-gen
      // past this, the isolate aborts and we surface the resulting
      // 'exit' (non-zero code) as ExecutionFailed — same shape as the
      // Rust StoreLimitsBuilder rejection.
      maxOldGenerationSizeMb: args.memoryLimitMb,
    },
    // We INHERIT `process.env` rather than blanking it: the dev
    // bootstrap shim uses tsx, which writes its compile cache to
    // `os.tmpdir()` and resolves it via TEMP / TMPDIR. The
    // zero-authority guarantee is enforced at the WASM boundary
    // (`compileAndValidate` rejects modules with imports), so the
    // host-process env never leaks into the plugin sandbox.
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const settle = (
        fn: typeof resolve | typeof reject,
        value: unknown,
      ): void => {
        if (settled) return;
        settled = true;
        (fn as (v: unknown) => void)(value);
      };

      // 1. Timeout: the only path that can preempt a CPU-bound plugin.
      //    `terminate()` is async; we don't await it here — the OS will
      //    reap the worker, the host's promise resolves immediately.
      timer = setTimeout(() => {
        void worker.terminate().catch(() => undefined);
        settle(
          reject,
          new WasmHostError(
            'Timeout',
            `execution timed out (${args.timeoutMs}ms limit)`,
          ),
        );
      }, args.timeoutMs);

      // 2. Result message from the worker — happy path.
      worker.once('message', (msg: WorkerResultMessage) => {
        if (msg.ok) {
          settle(resolve, msg.output);
        } else {
          settle(
            reject,
            new WasmHostError(
              msg.errorKind satisfies WasmHostErrorKind,
              msg.errorDetail,
            ),
          );
        }
      });

      // 3. Worker died without posting a result — usually a crash
      //    (e.g. V8 OOM cap fired). If we already settled this is a
      //    no-op via `settle`.
      worker.once('error', (err: Error) => {
        settle(
          reject,
          new WasmHostError(
            'ExecutionFailed',
            `worker error: ${err.message}`,
          ),
        );
      });
      worker.once('exit', (code: number) => {
        if (code === 0) {
          // Clean exit — if we hadn't already settled via `'message'`,
          // the worker exited without posting a result.
          settle(
            reject,
            new WasmHostError(
              'ExecutionFailed',
              'worker exited without posting a result',
            ),
          );
        } else {
          // Non-zero is normally `terminate()` we issued ourselves
          // (after the timeout) or a V8 OOM kill. The timeout path
          // already settled with Timeout; the OOM path surfaces here.
          settle(
            reject,
            new WasmHostError(
              'ExecutionFailed',
              `worker exited with code ${code} (likely memory cap of ${args.memoryLimitMb} MB hit)`,
            ),
          );
        }
      });

      // 4. Kick off the work. The worker entry attaches its
      //    `'message'` listener synchronously at module top-level, but
      //    the bootstrap shim awaits a dynamic import first; messages
      //    posted before the listener attaches are buffered by Node,
      //    so the order is safe.
      const message: WorkerInvocationMessage = {
        pluginRef: args.pluginRef,
        pluginBytes: args.bytes,
        input: args.input,
        memoryLimitMb: args.memoryLimitMb,
      };
      worker.postMessage(message);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Belt-and-braces: ensure the worker is gone on every path so a
    // leaked worker can't accumulate. `terminate()` on an already-
    // exited worker is a no-op.
    void worker.terminate().catch(() => undefined);
  }
}
