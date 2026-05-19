/**
 * Bun-runtime implementation of the `@atlas/test` shim.
 *
 * `bun:test` already ships jest-compatible `expect`, `mock`, `spyOn`,
 * `useFakeTimers`, etc., so the wrapper is thin — mostly a `vi` object
 * that points the legacy method names at the bun primitives.
 */

// @ts-expect-error - "bun:test" is provided by the Bun runtime only.
import {
  afterAll as bunAfterAll,
  afterEach as bunAfterEach,
  beforeAll as bunBeforeAll,
  beforeEach as bunBeforeEach,
  describe as bunDescribe,
  expect as bunExpect,
  it as bunIt,
  mock as bunMock,
  spyOn as bunSpyOn,
  test as bunTest,
} from 'bun:test';
import type { ExpectTypeOf, MockedFunction, ViShim } from './types.ts';

export type { MockInstance, MockedFunction, ExpectTypeOf } from './types.ts';

export const describe = bunDescribe;
export const it = bunIt;
export const test = bunTest;
export const beforeAll = bunBeforeAll;
export const beforeEach = bunBeforeEach;
export const afterAll = bunAfterAll;
export const afterEach = bunAfterEach;
export const before = bunBeforeAll;
export const after = bunAfterAll;
export const expect = bunExpect;

const envStubs = new Map<string, string | undefined>();
const globalStubs = new Map<string, { existed: boolean; original: unknown }>();

export const vi: ViShim = {
  fn(impl) {
    return bunMock(impl ?? (() => undefined)) as unknown as MockedFunction<typeof impl extends undefined ? (...a: never[]) => unknown : NonNullable<typeof impl>>;
  },
  spyOn(obj, method) {
    return bunSpyOn(obj as object, method as never) as never;
  },
  useFakeTimers() {
    // Bun's setSystemTime + jest-style timers. Bun exports
    // useFakeTimers via the jest namespace; the project mostly uses
    // timers indirectly via setTimeout, so we shim with no-op (tests
    // using advanceTimersByTime should rely on real timers in bun).
    // Bun's `mock.module` + manual advancement is the supported path,
    // but our test corpus doesn't need it once vi.mock is refactored
    // away.
    const anyBun = bunMock as unknown as { useFakeTimers?: () => void };
    anyBun.useFakeTimers?.();
  },
  useRealTimers() {
    const anyBun = bunMock as unknown as { useRealTimers?: () => void };
    anyBun.useRealTimers?.();
  },
  advanceTimersByTime(_ms) {
    // No-op under bun for now — see useFakeTimers note above.
  },
  async advanceTimersByTimeAsync(_ms) {
    await Promise.resolve();
  },
  clearAllMocks() {
    const anyBun = bunMock as unknown as { restore?: () => void };
    anyBun.restore?.();
  },
  restoreAllMocks() {
    const anyBun = bunMock as unknown as { restore?: () => void };
    anyBun.restore?.();
  },
  resetAllMocks() {
    const anyBun = bunMock as unknown as { restore?: () => void };
    anyBun.restore?.();
  },
  resetModules() {
    // No-op: bun has no public per-test module-cache flush either.
  },
  mocked<T>(value: T): T {
    return value;
  },
  stubEnv(name, value) {
    if (!envStubs.has(name)) envStubs.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  },
  unstubAllEnvs() {
    for (const [name, original] of envStubs) {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    envStubs.clear();
  },
  stubGlobal(name, value) {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!globalStubs.has(name)) {
      globalStubs.set(name, { existed: name in g, original: g[name] });
    }
    g[name] = value;
  },
  unstubAllGlobals() {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const [name, { existed, original }] of globalStubs) {
      if (existed) g[name] = original;
      else delete g[name];
    }
    globalStubs.clear();
  },
  async waitFor<T>(fn: () => T | Promise<T>, opts: { timeout?: number; interval?: number } = {}): Promise<T> {
    const timeout = opts.timeout ?? 1000;
    const interval = opts.interval ?? 10;
    const deadline = Date.now() + timeout;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    throw lastErr ?? new Error(`waitFor timed out after ${timeout}ms`);
  },
};

function makeTypeProxy(): ExpectTypeOf<unknown> {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_, key) {
      if (key === 'not' || key === 'parameters' || key === 'returns') return proxy;
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy as ExpectTypeOf<unknown>;
}

export function expectTypeOf<T = unknown>(_value?: T): ExpectTypeOf<T> {
  return makeTypeProxy() as ExpectTypeOf<T>;
}
