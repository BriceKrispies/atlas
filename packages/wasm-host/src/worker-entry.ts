/**
 * Worker-thread bootstrap for the Node WASM host.
 *
 * Spawned fresh per invocation by `WorkerWasmHost.invoke`. Receives a
 * single `WorkerInvocationMessage` with the plugin bytes, input, and
 * resource caps via `parentPort.once('message', ...)`, runs the same
 * `compileAndValidate` + `runModule` pipeline the in-process host used
 * to run, and posts back `WorkerResultMessage` then exits.
 *
 * Why a worker instead of running on the main loop:
 *   - `worker.terminate()` is the only way to *preempt* a CPU-bound
 *     plugin (e.g. `(loop br 0)`); on the main loop a busy plugin
 *     blocks every other request until it returns.
 *   - `resourceLimits.maxOldGenerationSizeMb` on the Worker constructor
 *     is the real OS-level cap; the previous post-hoc check ran AFTER
 *     the plugin had already grown memory.
 *
 * No host imports of any kind are exposed to the plugin — `runModule`
 * instantiates with `{}` and rejects modules that declare imports
 * (zero-authority parity with `crates/wasm_runtime`).
 *
 * Bootstrap runs synchronously to keep boot latency low; on this
 * machine spawn-to-message-received is consistently ~5–20 ms.
 */

import { parentPort } from 'node:worker_threads';
import { compileAndValidate, runModule } from './execute.ts';
import { WasmHostError } from './errors.ts';
import type { WasmHostErrorKind } from './errors.ts';

/** Sent from host → worker exactly once. */
export interface WorkerInvocationMessage {
  readonly pluginRef: string;
  readonly pluginBytes: Uint8Array;
  readonly input: unknown;
  readonly memoryLimitMb: number;
}

/** Sent from worker → host exactly once. */
export type WorkerResultMessage =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly errorKind: WasmHostErrorKind; readonly errorDetail: string };

if (!parentPort) {
  // Defensive: this file is only loadable from a Worker context.
  // Running it as a standalone script is a programming error.
  throw new Error('worker-entry.ts must be loaded inside a worker_threads Worker');
}

const port = parentPort;

port.once('message', (msg: WorkerInvocationMessage) => {
  void runOnce(msg).then(
    (result) => {
      port.postMessage(result);
      // After the host receives the message, close the port so the
      // worker drains naturally. Without this the parentPort listener
      // keeps the event loop alive — the host's `terminate()` in its
      // `finally` would still reap the worker, but the cleaner exit
      // makes leak-detection in tests less ambiguous.
      port.close();
    },
    (e: unknown) => {
      // Should be unreachable — runOnce catches everything — but if a
      // bug escapes, surface it as ExecutionFailed rather than a silent
      // worker crash.
      const detail = e instanceof Error ? e.message : String(e);
      port.postMessage({
        ok: false,
        errorKind: 'ExecutionFailed' satisfies WasmHostErrorKind,
        errorDetail: `worker bootstrap failure: ${detail}`,
      } satisfies WorkerResultMessage);
      port.close();
    },
  );
});

async function runOnce(msg: WorkerInvocationMessage): Promise<WorkerResultMessage> {
  try {
    const module = await compileAndValidate(msg.pluginBytes);
    const output = await runModule(module, msg.input, {
      memoryLimitMb: msg.memoryLimitMb,
    });
    return { ok: true, output };
  } catch (e) {
    if (e instanceof WasmHostError) {
      return { ok: false, errorKind: e.kind, errorDetail: e.detail };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorKind: 'ExecutionFailed',
      errorDetail: detail,
    };
  }
}
