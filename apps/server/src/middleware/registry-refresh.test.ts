/**
 * Unit tests for the registry-refresh middleware (decision O1,
 * refresh-at-request-boundary).
 *
 * Asserts:
 *   - `registry.refresh()` is awaited BEFORE `next()` runs (the boundary
 *     refresh must complete before submitIntent's sync schema/action lookups),
 *   - `next()` is invoked exactly once,
 *   - a registry whose `refresh()` resolves slowly still blocks `next()` until
 *     it settles (proves the `await`, not fire-and-forget).
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#hot-registration-contract
 */
import { describe, test, expect } from '@atlas/test';
import type { Context, Next } from 'hono';
import { registryRefreshMiddleware } from './registry-refresh.ts';

function fakeContext(): Context {
  // The middleware does not read anything off the context; an empty object
  // satisfies the call signature for this unit test.
  return {} as unknown as Context;
}

describe('registryRefreshMiddleware', function () {
  test('awaits registry.refresh() before invoking next()', async function () {
    const order: string[] = [];
    const registry = {
      async refresh(): Promise<void> {
        // Defer one microtask so a fire-and-forget (un-awaited) call would let
        // next() run first; awaiting it keeps the ordering deterministic.
        await Promise.resolve();
        order.push('refresh');
      },
    };
    const next: Next = async function () {
      order.push('next');
    };

    await registryRefreshMiddleware(registry)(fakeContext(), next);

    expect(order).toEqual(['refresh', 'next']);
  });

  test('invokes next() exactly once', async function () {
    let refreshCalls = 0;
    let nextCalls = 0;
    const registry = {
      async refresh(): Promise<void> {
        refreshCalls += 1;
      },
    };
    const next: Next = async function () {
      nextCalls += 1;
    };

    await registryRefreshMiddleware(registry)(fakeContext(), next);

    expect(refreshCalls).toBe(1);
    expect(nextCalls).toBe(1);
  });

  test('a slow refresh blocks next() until it settles (the await is real, not fire-and-forget)', async function () {
    const order: string[] = [];
    let resolveRefresh!: () => void;
    const registry = {
      refresh(): Promise<void> {
        order.push('refresh-start');
        return new Promise<void>(function (resolve) {
          resolveRefresh = resolve;
        });
      },
    };
    const next: Next = async function () {
      order.push('next');
    };

    const ran = registryRefreshMiddleware(registry)(fakeContext(), next);
    // Yield several microtasks: next() MUST NOT have run while refresh is pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['refresh-start']);

    resolveRefresh();
    await ran;
    expect(order).toEqual(['refresh-start', 'next']);
  });
});
