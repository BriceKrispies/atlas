/**
 * Shared test-shim types. Both `bun.ts` and `node.ts` conform to this
 * interface so test files written against `@atlas/test` typecheck the
 * same way regardless of which runtime ends up executing them.
 *
 * The shim deliberately exposes a narrow subset of the historical
 * vitest API — only what the codebase actually uses. New callers
 * should prefer the narrower surface to make future runner swaps
 * cheaper.
 */

export type TestFn = (name: string, fn?: () => void | Promise<void>) => void;
export type HookFn = (fn: () => void | Promise<void>) => void;
export type DescribeFn = (name: string, fn: () => void | Promise<void>) => void;

/**
 * Minimal `vi`-shape replacement. Methods that don't have a clean
 * cross-runtime equivalent (vi.mock, vi.hoisted, vi.importActual) are
 * intentionally omitted — call sites using them must be refactored to
 * dependency injection.
 */
export interface ViShim {
  fn<T extends (...args: never[]) => unknown>(impl?: T): MockedFunction<T>;
  spyOn<T extends object, K extends keyof T>(
    obj: T,
    method: K,
  ): MockedFunction<T[K] extends (...args: never[]) => unknown ? T[K] : never>;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  clearAllMocks(): void;
  restoreAllMocks(): void;
  resetAllMocks(): void;
  /**
   * No-op under both bun:test and node:test. Vitest used it to flush its
   * module cache so a re-import would re-evaluate; Node ESM offers no
   * equivalent, so callers that need a fresh module graph must restructure
   * (e.g. via a factory function). Kept for source compatibility.
   */
  resetModules(): void;
  /**
   * Identity helper that exists for type-narrowing only. At runtime
   * `vi.mocked(x)` returns `x` unchanged.
   */
  mocked<T>(value: T): T;
  stubEnv(name: string, value: string | undefined): void;
  unstubAllEnvs(): void;
  stubGlobal(name: string, value: unknown): void;
  unstubAllGlobals(): void;
  waitFor<T>(fn: () => T | Promise<T>, opts?: { timeout?: number; interval?: number }): Promise<T>;
}

export interface MockedFunction<T> {
  (...args: T extends (...args: infer A) => unknown ? A : never[]):
    T extends (...args: never[]) => infer R ? R : unknown;
  mock: {
    calls: unknown[][];
    results: { type: 'return' | 'throw'; value: unknown }[];
    instances: unknown[];
    lastCall?: unknown[];
  };
  mockClear(): void;
  mockReset(): void;
  mockRestore(): void;
  mockImplementation(impl: T): MockedFunction<T>;
  mockImplementationOnce(impl: T): MockedFunction<T>;
  mockReturnValue(value: unknown): MockedFunction<T>;
  mockReturnValueOnce(value: unknown): MockedFunction<T>;
  mockResolvedValue(value: unknown): MockedFunction<T>;
  mockResolvedValueOnce(value: unknown): MockedFunction<T>;
  mockRejectedValue(value: unknown): MockedFunction<T>;
  mockRejectedValueOnce(value: unknown): MockedFunction<T>;
}

/** Backwards-compat alias used by a handful of test files. */
export type MockInstance<T = unknown> = MockedFunction<
  T extends (...args: never[]) => unknown ? T : (...args: never[]) => unknown
>;

/**
 * Type-only chainable used in place of vitest's `expectTypeOf`. The
 * runtime returns a proxy that swallows every call — the assertions
 * only exist for tsc to evaluate.
 */
export interface ExpectTypeOf<_T> {
  toEqualTypeOf<U = unknown>(value?: U): ExpectTypeOf<_T>;
  toMatchTypeOf<U = unknown>(value?: U): ExpectTypeOf<_T>;
  toHaveProperty(name: string): ExpectTypeOf<_T>;
  toBeFunction(): ExpectTypeOf<_T>;
  toBeString(): ExpectTypeOf<_T>;
  toBeNumber(): ExpectTypeOf<_T>;
  toBeBoolean(): ExpectTypeOf<_T>;
  toBeObject(): ExpectTypeOf<_T>;
  parameter(idx: number): ExpectTypeOf<_T>;
  parameters: ExpectTypeOf<_T>;
  returns: ExpectTypeOf<_T>;
  not: ExpectTypeOf<_T>;
}
