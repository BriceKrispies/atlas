/**
 * Node-side WasmHost adapter.
 *
 * Pre-Chunk 12 this class ran the plugin on the main event loop with a
 * `Promise.race` timeout; that couldn't preempt CPU-bound modules and
 * the memory cap was a post-hoc check. Chunk 12 closed the architectural
 * audit's last production-cutover BLOCKER by moving execution into a
 * `worker_threads` Worker — see `worker-host.ts` for the real
 * implementation.
 *
 * `NodeWasmHost` is retained as a thin alias over `WorkerWasmHost` so
 * existing call sites (e.g. `apps/server/src/bootstrap.ts`) work
 * unchanged. Prefer `WorkerWasmHost` for new code.
 *
 * @deprecated Use `WorkerWasmHost`. The two are construction-equivalent;
 * `NodeWasmHost` is kept for compatibility with pre-Chunk-12 callers.
 */

import type { WasmHost, WasmInvocation } from '@atlas/ports';
import { WorkerWasmHost, type WorkerWasmHostOptions } from './worker-host.ts';

export type NodeWasmHostOptions = WorkerWasmHostOptions;

/**
 * @deprecated Alias for `WorkerWasmHost`. Construction signature is
 * identical; `invoke` semantics are identical. New code should import
 * `WorkerWasmHost` directly.
 */
export class NodeWasmHost implements WasmHost {
  readonly #inner: WorkerWasmHost;

  constructor(options: NodeWasmHostOptions) {
    this.#inner = new WorkerWasmHost(options);
  }

  invoke(invocation: WasmInvocation): Promise<unknown> {
    return this.#inner.invoke(invocation);
  }
}
