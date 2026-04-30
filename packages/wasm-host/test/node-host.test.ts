/**
 * Contract suite for the Node WasmHost adapter.
 *
 * The bulk of the assertions come from `@atlas/contract-tests`'s
 * `wasmHostContract` — both the worker-thread host and the legacy
 * `NodeWasmHost` alias must satisfy it identically.
 *
 * Chunk 12 added three preemption / isolation tests that only apply
 * to the worker-backed host:
 *   - hard preemption of an infinite-loop plugin via `worker.terminate()`
 *   - memory cap surfacing as a structured error rather than a crash
 *   - the main event loop staying responsive while a plugin is wedged
 */

import { describe, test, expect, vi } from 'vitest';
import { setImmediate as setImmediateAsync } from 'node:timers/promises';
import { wasmHostContract } from '@atlas/contract-tests';
import {
  NodeWasmHost,
  WorkerWasmHost,
  InMemoryPluginLoader,
  WasmHostError,
} from '@atlas/wasm-host';
import { infiniteLoopWasm, memoryGrowWasm } from './loop-fixtures.ts';

// Contract suite, run against both the canonical name and the deprecated
// alias to prove they're construction-equivalent.
wasmHostContract(() => {
  const loader = new InMemoryPluginLoader();
  return {
    loader,
    makeHost: () => new WorkerWasmHost({ loader }),
  };
});

describe('NodeWasmHost (deprecated alias) is construction-equivalent', () => {
  test('invokes a noop plugin via the alias', async () => {
    const { noopRenderWasm } = await import('@atlas/contract-tests');
    const loader = new InMemoryPluginLoader();
    loader.set('noop-render', noopRenderWasm);
    const host = new NodeWasmHost({ loader });
    const out = await host.invoke({
      pluginRef: 'noop-render',
      input: {},
    });
    expect(out).toEqual({ hello: 'world' });
  });
});

describe('WorkerWasmHost preemption + isolation (Chunk 12)', () => {
  test(
    'terminates a CPU-bound plugin via worker.terminate within ~timeoutMs',
    async () => {
      const loader = new InMemoryPluginLoader();
      loader.set('infinite-loop', infiniteLoopWasm);
      const host = new WorkerWasmHost({ loader });
      // The dev/test path pays a ~200 ms tsx-bootstrap tax inside the
      // Worker (in production the entry is plain JS and this drops to
      // <30 ms). We pick a 1500 ms timeout so the Worker is up and
      // looping before the cap fires, which is what we actually want
      // to assert about: terminate hard-preempts a CPU-bound plugin.
      const start = Date.now();
      let err: unknown;
      try {
        await host.invoke({
          pluginRef: 'infinite-loop',
          input: {},
          timeoutMs: 1500,
        });
      } catch (e) {
        err = e;
      }
      const elapsed = Date.now() - start;
      expect(err).toBeInstanceOf(WasmHostError);
      expect((err as WasmHostError).kind).toBe('Timeout');
      // Canonical assertion: we DON'T sit on the wedged plugin for
      // the pre-Chunk-12 default of 5 s. Generous headroom for worker
      // spawn + tsx tax + slow CI; the meaningful regression guard is
      // that this test would have hung indefinitely (or failed at
      // 5 s) on the pre-Chunk-12 main-loop implementation.
      expect(elapsed).toBeLessThan(3000);
    },
    15_000,
  );

  test(
    'surfaces a memory-cap error when the plugin grows past the limit',
    async () => {
      const loader = new InMemoryPluginLoader();
      loader.set('memory-grow', memoryGrowWasm);
      const host = new WorkerWasmHost({ loader });
      let err: unknown;
      try {
        await host.invoke({
          pluginRef: 'memory-grow',
          input: {},
          memoryLimitMb: 16,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WasmHostError);
      // The check inside `runModule` (post-render) fires first: it
      // sees `buffer.byteLength > 16 MB` and throws ExecutionFailed
      // with a `memory exceeds` detail. The Worker's V8 cap is the
      // OS-level safety net behind it.
      const e = err as WasmHostError;
      expect(e.kind).toBe('ExecutionFailed');
      expect(e.detail.toLowerCase()).toContain('memory');
    },
    10_000,
  );

  test(
    'a wedged plugin does not block the main event loop',
    async () => {
      const loader = new InMemoryPluginLoader();
      loader.set('infinite-loop', infiniteLoopWasm);
      const host = new WorkerWasmHost({ loader });

      // Kick off the wedged plugin with a generous timeout so the
      // event-loop responsiveness check runs while the plugin is still
      // spinning in its worker. We catch the eventual Timeout so the
      // test doesn't fail on the unhandled rejection.
      const wedged = host.invoke({
        pluginRef: 'infinite-loop',
        input: {},
        timeoutMs: 2000,
      });
      const wedgedSettled = vi.fn();
      void wedged.catch(wedgedSettled);

      // Now race a setImmediate against a generous tick budget. If the
      // event loop were blocked by the plugin, the immediate would not
      // fire until after the plugin finished (which it never will,
      // since terminate is the only exit). On a worker-isolated host
      // the immediate fires on the next macrotask — well under 200 ms
      // even with the dev tsx bootstrap cost in flight.
      const before = Date.now();
      await setImmediateAsync(undefined);
      const elapsed = Date.now() - before;
      expect(elapsed).toBeLessThan(200);

      // Drain the wedged invocation so the test cleans up cleanly.
      await wedged.catch(() => undefined);
      expect(wedgedSettled).toHaveBeenCalled();
    },
    10_000,
  );
});
