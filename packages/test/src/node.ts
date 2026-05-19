/**
 * Node-runtime implementation of the `@atlas/test` shim.
 *
 * - `describe`, `it`, `test`, hooks: re-exported from `node:test`.
 * - `expect`: from the `expect` npm package (jest's matcher library).
 * - `vi`: a thin wrapper over `node:test`'s `mock` plus a handful of
 *   stateful helpers (stubEnv, stubGlobal, waitFor).
 * - `expectTypeOf`: runtime no-op proxy; the assertions are purely
 *   type-level so tsc does the work.
 */

import {
  describe as nodeDescribe,
  it as nodeIt,
  test as nodeTest,
  before as nodeBefore,
  beforeEach as nodeBeforeEach,
  after as nodeAfter,
  afterEach as nodeAfterEach,
  mock as nodeMock,
} from 'node:test';
import expectPkg from 'expect';
import type { ExpectTypeOf, MockedFunction, ViShim } from './types.ts';

export type { MockInstance, MockedFunction, ExpectTypeOf } from './types.ts';

// --- .each table-test helper ---------------------------------------------
// node:test doesn't ship `.each`, but vitest/jest do. We attach a small
// formatter so existing `it.each([...])('case "%s"', fn)` and
// `it.each([{ a, b }])('$a -> $b', fn)` patterns keep working.

type EachFn = <T>(table: readonly T[]) => (
  name: string,
  fn: (row: T) => void | Promise<void>,
) => void;

function formatRowName(template: string, row: unknown, index: number): string {
  // jest-style %s / %d / %j / %i placeholders + vitest-style $prop.
  let i = 0;
  const args = Array.isArray(row) ? row : [row];
  let out = template.replace(/%[sdij%]/g, (m) => {
    if (m === '%%') return '%';
    const v = args[i++];
    if (m === '%j') return JSON.stringify(v);
    if (m === '%d' || m === '%i') return String(Number(v));
    return String(v);
  });
  if (typeof row === 'object' && row !== null) {
    const rec = row as Record<string, unknown>;
    out = out.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, prop) => {
      const v = rec[prop];
      return v === undefined ? '$' + prop : String(v);
    });
  }
  return out.includes('#') ? out.replace(/#/g, String(index)) : out;
}

function attachEach<F extends (name: string, fn: (...args: unknown[]) => unknown) => unknown>(
  runner: F,
): F & { each: EachFn } {
  const wrapped = runner as F & { each: EachFn };
  wrapped.each = (table) => (template, body) => {
    table.forEach((row, idx) => {
      const name = formatRowName(template, row, idx);
      // jest/vitest semantics: when the row is an array, spread it as
      // positional arguments to the callback. Object/primitive rows go
      // as a single argument. Tests rely on the spread when writing
      // `it.each([['a','b']])('%s → %s', (a, b) => ...)`.
      runner(name, () => (Array.isArray(row) ? (body as (...a: unknown[]) => unknown)(...row) : body(row)));
    });
  };
  return wrapped;
}

const itWithEach = attachEach(nodeIt as never);
const testWithEach = attachEach(nodeTest as never);
const describeWithEach = attachEach(nodeDescribe as never);
// `.only` / `.skip` exist on node's it/test as method properties — re-attach
// onto the wrapped reference so legacy callers (it.only / it.skip) still work.
for (const key of ['only', 'skip', 'todo']) {
  const src = nodeIt as unknown as Record<string, unknown>;
  if (src[key]) (itWithEach as unknown as Record<string, unknown>)[key] = src[key];
  const srcT = nodeTest as unknown as Record<string, unknown>;
  if (srcT[key]) (testWithEach as unknown as Record<string, unknown>)[key] = srcT[key];
  const srcD = nodeDescribe as unknown as Record<string, unknown>;
  if (srcD[key]) (describeWithEach as unknown as Record<string, unknown>)[key] = srcD[key];
}

export const describe = describeWithEach;
export const it = itWithEach;
export const test = testWithEach;
export const beforeAll = nodeBefore;
export const beforeEach = nodeBeforeEach;
export const afterAll = nodeAfter;
export const afterEach = nodeAfterEach;
export const before = nodeBefore;
export const after = nodeAfter;

const expect_ = (expectPkg as unknown as { default?: typeof expectPkg }).default ?? expectPkg;

/**
 * Wrap jest's `expect` so it tolerates the vitest `(value, message)` signature
 * (vitest uses the second arg as a custom failure message). Jest's expect
 * throws "Expect takes at most one argument."; rather than rewrite every call
 * site, we strip the extra arg and prepend the message to any thrown
 * AssertionError. The behaviour for the single-arg case is identical to
 * passing through to jest's expect.
 */
function expectWithMessage(value: unknown, message?: unknown): unknown {
  const matchers = (expect_ as (v: unknown) => unknown)(value);
  if (message === undefined) return matchers;
  // Wrap every matcher (toBe, toEqual, ...) and every `.not` matcher so
  // assertion failures carry the message. We only intercept terminal
  // matchers; `.resolves` / `.rejects` / `.not` continue to expose their
  // wrapped chain.
  return new Proxy(matchers as object, {
    get(target, prop) {
      const original = (target as Record<string | symbol, unknown>)[prop];
      if (typeof original !== 'function') return original;
      return function wrapped(this: unknown, ...args: unknown[]): unknown {
        try {
          return (original as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          if (err instanceof Error && message) {
            err.message = `${String(message)}\n${err.message}`;
          }
          throw err;
        }
      };
    },
  });
}
// Copy static helpers (`objectContaining` etc.) onto the wrapper so callers
// still hit them via `expect.objectContaining(...)`.
for (const key of Object.keys(expect_ as object)) {
  (expectWithMessage as unknown as Record<string, unknown>)[key] =
    (expect_ as unknown as Record<string, unknown>)[key];
}

export const expect = expectWithMessage as unknown as typeof expectPkg & {
  objectContaining: (shape: unknown) => unknown;
  arrayContaining: (items: unknown[]) => unknown;
  stringContaining: (s: string) => unknown;
  stringMatching: (r: string | RegExp) => unknown;
  any: (ctor: unknown) => unknown;
  anything: () => unknown;
};

// --- vi shim --------------------------------------------------------------

/**
 * Build a vi.fn-shaped mock from scratch rather than wrapping
 * `node:test`'s `mock.fn()`. Node attaches its `mock` telemetry via a
 * non-overridable prototype path which made `defineProperty(fn, 'mock', ...)`
 * silently lose to the original shape — so we maintain the call ledger
 * ourselves. `mock.timers` integration is separate and unaffected.
 */
function makeMockFn<T extends (...a: never[]) => unknown>(
  initialImpl?: T,
): MockedFunction<T> {
  type Call = { arguments: unknown[]; result?: unknown; error?: unknown };
  const calls: Call[] = [];
  const implQueue: T[] = [];
  let baseImpl: T | undefined = initialImpl;

  const callable = function (this: unknown, ...args: unknown[]): unknown {
    const entry: Call = { arguments: args };
    calls.push(entry);
    const impl = implQueue.shift() ?? baseImpl;
    if (!impl) return undefined;
    try {
      const r = (impl as (...a: unknown[]) => unknown).apply(this, args);
      entry.result = r;
      return r;
    } catch (err) {
      entry.error = err;
      throw err;
    }
  } as unknown as MockedFunction<T>;

  Object.defineProperty(callable, 'mock', {
    get() {
      const callArgs = calls.map((c) => c.arguments);
      const results = calls.map((c) =>
        c.error !== undefined
          ? ({ type: 'throw' as const, value: c.error })
          : ({ type: 'return' as const, value: c.result }),
      );
      return {
        calls: callArgs,
        results,
        instances: [],
        contexts: [],
        invocationCallOrder: callArgs.map((_, i) => i + 1),
        lastCall: callArgs[callArgs.length - 1],
      };
    },
    configurable: true,
    enumerable: true,
  });
  // jest's expect matchers (toHaveBeenCalled / toHaveBeenCalledWith / ...)
  // detect a mock by the `_isMockFunction` flag. We set it (plus `getMockName`)
  // so the `expect` npm package, which ships jest's matcher set, treats our
  // makeMockFn output the same as a jest.fn().
  Object.defineProperty(callable, '_isMockFunction', {
    value: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(callable, 'getMockName', {
    value: () => 'atlas-mock',
    configurable: true,
    enumerable: false,
  });

  callable.mockClear = () => {
    calls.length = 0;
  };
  callable.mockReset = () => {
    calls.length = 0;
    implQueue.length = 0;
    baseImpl = undefined;
  };
  callable.mockRestore = () => {
    callable.mockReset();
  };
  callable.mockImplementation = (impl) => {
    baseImpl = impl;
    return callable;
  };
  callable.mockImplementationOnce = (impl) => {
    implQueue.push(impl);
    return callable;
  };
  callable.mockReturnValue = (value) => {
    baseImpl = (() => value) as T;
    return callable;
  };
  callable.mockReturnValueOnce = (value) => {
    implQueue.push((() => value) as T);
    return callable;
  };
  callable.mockResolvedValue = (value) => {
    baseImpl = (() => Promise.resolve(value)) as T;
    return callable;
  };
  callable.mockResolvedValueOnce = (value) => {
    implQueue.push((() => Promise.resolve(value)) as T);
    return callable;
  };
  callable.mockRejectedValue = (value) => {
    baseImpl = (() => Promise.reject(value)) as T;
    return callable;
  };
  callable.mockRejectedValueOnce = (value) => {
    implQueue.push((() => Promise.reject(value)) as T);
    return callable;
  };
  return callable;
}

const envStubs = new Map<string, string | undefined>();
const globalStubs = new Map<string, { existed: boolean; original: unknown }>();

export const vi: ViShim = {
  fn(impl) {
    return makeMockFn(impl ?? ((() => undefined) as never)) as never;
  },
  spyOn(obj, method) {
    const target = obj as Record<string, unknown>;
    const original = target[method as string];
    if (typeof original !== 'function') {
      throw new TypeError(`spyOn: ${String(method)} is not a function`);
    }
    const spy = makeMockFn(original.bind(target) as never);
    target[method as string] = spy as unknown as (...a: unknown[]) => unknown;
    const restore = spy.mockRestore;
    spy.mockRestore = () => {
      restore();
      target[method as string] = original;
    };
    return spy as never;
  },
  useFakeTimers() {
    // Deliberately omit `setImmediate` from the mocked APIs — our
    // `advanceTimersByTimeAsync` uses setImmediate (via setImmediate or
    // a microtask wait) to flush the microtask queue after ticking. If
    // setImmediate were also fake, that wait would deadlock.
    nodeMock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  },
  useRealTimers() {
    nodeMock.timers.reset();
  },
  advanceTimersByTime(ms) {
    nodeMock.timers.tick(ms);
  },
  async advanceTimersByTimeAsync(ms) {
    nodeMock.timers.tick(ms);
    // Flush microtasks scheduled by the ticked callbacks. setImmediate
    // is intentionally NOT mocked so this yield always lands on a real
    // event-loop tick.
    await new Promise((resolve) => setImmediate(resolve));
  },
  clearAllMocks() {
    nodeMock.reset();
  },
  restoreAllMocks() {
    nodeMock.restoreAll();
  },
  resetAllMocks() {
    nodeMock.reset();
  },
  resetModules() {
    // No-op: Node ESM has no per-test module cache flush.
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

// --- expectTypeOf no-op proxy --------------------------------------------

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
