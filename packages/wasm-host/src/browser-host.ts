/**
 * Browser-side WasmHost adapter (sim mode).
 *
 * Native `WebAssembly` API. No fuel — the spec doesn't expose one.
 * Memory cap is enforced via the same post-hoc check as the Node
 * adapter (`runModule` checks the `WebAssembly.Memory` buffer length
 * against the cap). Timeout via `Promise.race`.
 *
 * Same shape as `NodeWasmHost`; the only meaningful difference is
 * neither host can preempt a CPU-bound module without worker isolation.
 * Sim mode runs in an iframe / test runner where that risk is bounded.
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

export interface BrowserWasmHostOptions {
  loader: WasmPluginLoader;
}

export class BrowserWasmHost implements WasmHost {
  readonly #loader: WasmPluginLoader;

  constructor(options: BrowserWasmHostOptions) {
    this.#loader = options.loader;
  }

  async invoke(invocation: WasmInvocation): Promise<unknown> {
    const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitMb = invocation.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;

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
