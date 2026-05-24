/**
 * Shared harness for the cross-cutting invariant property suites.
 *
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 *
 * Each `properties/<invariant>.ts` file exports a `runProperty(adapters)`
 * function that fast-check evaluates. The `adapters` argument is the seam
 * that lets the SAME property run against `adapter-node`, `adapter-idb`,
 * and (in the self-tests) a deliberately-broken in-memory adapter — the
 * "test the test" discipline from §6.3: a property that passes against a
 * broken adapter is itself broken.
 *
 * This module owns two things every property file needs:
 *
 *   1. `runConfig()` — the fast-check run config. Default ≥ 200 cases
 *      (testing.md §5.3); the high-budget ≥ 5000 nightly variant is gated
 *      behind `ATLAS_PROPERTY_SOAK=1`. Shrinking is always on; the seed is
 *      pinned from `ATLAS_PROPERTY_SEED` when present so a CI flake is
 *      reproducible (a flake is a real bug, never "the generator was
 *      unlucky" — testing.md §5.5).
 *
 *   2. `extractCounterexampleFixture()` — the documented path from a real
 *      property failure to a regression fixture at
 *      `specs/fixtures/<kind>__invalid__<name>.json` (testing.md §6.3).
 *      We don't have a real failure to extract here; this is the plumbing
 *      so that when one fires, the counterexample lands in the canonical
 *      place instead of scrolling away in CI logs.
 */
import fc from 'fast-check';

/** Default per-run case budget (testing.md §5.3 floor). */
export const DEFAULT_RUNS = 200;
/** Nightly soak budget (testing.md §5.3 ceiling). */
export const SOAK_RUNS = 5000;

/**
 * fast-check run parameters shared by every property. `numRuns` honors the
 * §5.3 budget; `ATLAS_PROPERTY_SOAK=1` raises it to the nightly floor.
 * `ATLAS_PROPERTY_SEED` pins the seed for reproducing a CI failure.
 */
export function runConfig(overrides: fc.Parameters<unknown> = {}): fc.Parameters<unknown> {
  const soak = process.env['ATLAS_PROPERTY_SOAK'] === '1';
  const seedEnv = process.env['ATLAS_PROPERTY_SEED'];
  const base: fc.Parameters<unknown> = {
    numRuns: soak ? SOAK_RUNS : DEFAULT_RUNS,
    // Shrinking is always enabled (fast-check default); we make it explicit
    // so a reviewer sees the §6.3 "shrink to a minimal counterexample"
    // requirement is honored.
    verbose: true,
    ...overrides,
  };
  if (seedEnv !== undefined && Number.isFinite(Number(seedEnv))) {
    base.seed = Number(seedEnv);
  }
  return base;
}

/**
 * The shape a failed property reduces to. fast-check throws an error whose
 * `.message` carries the counterexample; the `counterexamplePath` lets a
 * reviewer re-run the exact shrink. We capture both so the regression
 * fixture is faithful.
 */
export interface CounterexampleFixture {
  /** Invariant id this counterexample violates, e.g. "I3". */
  invariant: string;
  /** The minimal shrunk input fast-check reduced the failure to. */
  counterexample: unknown;
  /** fast-check's replay path — pass to `{ path }` in runConfig to re-run. */
  path: string | null;
  /** The seed the failing run used. */
  seed: number | null;
  /** Human note on why this input violates the invariant. */
  note: string;
}

/**
 * Documented counterexample-to-fixture path (testing.md §6.3). On a real
 * property failure, a reviewer calls this with the thrown
 * `fc.PropertyFailure`-shaped error and writes the result to
 * `specs/fixtures/<kind>__invalid__<name>.json`. We don't have a real
 * failure to extract in the self-tests — this is the plumbing and the
 * canonical destination, not a live extraction.
 *
 * @example
 *   try { runProperty(adapters); }
 *   catch (err) {
 *     const fixture = extractCounterexampleFixture('I3', err);
 *     // write to specs/fixtures/intent__invalid__i3-double-dispatch.json
 *   }
 */
export function extractCounterexampleFixture(
  invariant: string,
  err: unknown,
  note = '',
): CounterexampleFixture {
  const e = err as {
    counterexample?: unknown;
    counterexamplePath?: string;
    seed?: number;
  } & Error;
  return {
    invariant,
    counterexample: e.counterexample ?? null,
    path: e.counterexamplePath ?? null,
    seed: typeof e.seed === 'number' ? e.seed : null,
    note: note || (e.message ?? 'property failed'),
  };
}

/** The canonical fixture directory for an extracted counterexample. */
export const FIXTURE_DIR = 'specs/fixtures';

/**
 * Build the canonical fixture filename for a counterexample
 * (`<kind>__invalid__<name>.json`, testing.md §3 + §6.3).
 */
export function counterexampleFixturePath(kind: string, name: string): string {
  return `${FIXTURE_DIR}/${kind}__invalid__${name}.json`;
}
