/**
 * Node-side WasmHost adapter.
 *
 * Implementation choice: native `WebAssembly` API (Node 18+ ships it
 * stable). Looked at `@bytecodealliance/wasmtime` and `wasmtime` on npm;
 * neither has the maturity / cross-platform binary support to bet on
 * for the parity loop today (no Windows binaries on `wasmtime`,
 * `@bytecodealliance/wasmtime` last published 2022). Trade-off: no
 * fuel limit. We keep the `fuelLimit` field on `WasmInvocation` so the
 * port matches the Rust contract numerically — it's accepted but not
 * enforced here. Memory cap is enforced post-hoc against the
 * `WebAssembly.Memory` buffer length after `render` returns. Wall-clock
 * timeout is enforced via `Promise.race` — for CPU-bound modules that
 * wedge the event loop the only true preemption is a Worker thread,
 * which is a follow-up; the demo plugin and any well-behaved plugin
 * returns inside microseconds.
 *
 * Same `WasmHost` contract as the browser adapter; tests in
 * `@atlas/contract-tests` cover both adapters with one fixture.
 */

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
import { compileAndValidate, runModule } from './execute.ts';

export interface NodeWasmHostOptions {
  loader: WasmPluginLoader;
}

export class NodeWasmHost implements WasmHost {
  readonly #loader: WasmPluginLoader;

  constructor(options: NodeWasmHostOptions) {
    this.#loader = options.loader;
  }

  async invoke(invocation: WasmInvocation): Promise<unknown> {
    const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitMb = invocation.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;

    // Sub-zero / zero timeouts are an explicit "no time at all" signal —
    // mirrors what a `tokio::time::timeout(Duration::ZERO, ...)` does in
    // the Rust host (it never polls the future). Bail before even
    // touching the loader so callers that pass `timeoutMs: 0` as a
    // "disable" sentinel get a clean rejection instead of a partial run.
    if (timeoutMs <= 0) {
      throw new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`);
    }

    const deadline = Date.now() + timeoutMs;
    const bytes = await this.#loader.load(invocation.pluginRef);
    if (Date.now() >= deadline) {
      throw new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`);
    }
    const module = await compileAndValidate(bytes);
    if (Date.now() >= deadline) {
      throw new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`);
    }

    const work = runModule(module, invocation.input, { memoryLimitMb });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      const remaining = Math.max(0, deadline - Date.now());
      timer = setTimeout(() => {
        reject(new WasmHostError('Timeout', `execution timed out (${timeoutMs}ms limit)`));
      }, remaining);
    });

    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
