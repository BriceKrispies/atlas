/**
 * Mechanical checker for the six properties ADR 0007 §2 requires of every
 * DSL kind. Modeled on the cross-adapter parity contracts in
 * `@atlas/contract-tests` (e.g. `eventStoreContract(makeStore)`):
 * each new DSL kind passes its `DslEvaluator` to `dslContractTest(kind, ...)`
 * and the substrate runs the six §2 assertions uniformly.
 *
 * This is the Liskov enforcement mechanism — every concrete DSL satisfies
 * the same behavioral contract. ADR 0007 §"Constraints" item 1: "Each DSL
 * capability spec MUST include a 'DSL contract conformance' section
 * demonstrating §2 properties 1–6. Specs that don't are rejected." The
 * conformance demonstration is now an executable test, not just prose.
 *
 * Slice #1 (this file) ships the SHAPE — interface, factory signatures,
 * meta-tests proving the checker itself rejects malformed evaluators. The
 * actual assertion bodies (e.g. "evaluate twice with the same inputs and
 * compare outputs") land with the first concrete DSL evaluator (slice #3),
 * where the substrate also gains its first real implementation of
 * `BudgetTicket` and the evaluator loop. That separation keeps slice #1
 * types-only.
 */

import type { DslEvaluator, StaticCheckHints } from './evaluator.ts';
import type { HostOpRegistry, HostOpSet } from './host-ops.ts';
import type { DslError } from './errors.ts';
import type { Result } from './result.ts';

/**
 * Synthetic input the checker uses to exercise an evaluator. Each DSL's
 * contract-test caller supplies a small corpus of `(ast, scope, hostOps)`
 * triples — the checker drives the evaluator with the same triple multiple
 * times to assert determinism, calls `staticCheck` to assert no throws,
 * and so on.
 */
export interface DslConformanceSample<TAst, TScope, TOps extends HostOpSet> {
  /** Human-readable name for failure messages. */
  readonly name: string;
  readonly ast: TAst;
  readonly scope: TScope;
  readonly ops: TOps;
  readonly hints?: StaticCheckHints;
  /**
   * Expected outcome shape for the evaluation — `'ok'` means a `Result.ok ===
   * true` is required; `'error'` means the sample is supposed to fail with a
   * particular `DslErrorCode`. Used by the determinism check (same sample,
   * same outcome shape across repeated runs).
   */
  readonly expect:
    | { readonly outcome: 'ok' }
    | {
        readonly outcome: 'error';
        readonly code: DslError['code'];
      };
}

/**
 * Shape of the parameter `dslContractTest` accepts. Generic over the DSL
 * kind's types so the checker can drive a typed evaluator without `any`
 * casts at the call site. The DSL author supplies a factory because the
 * checker may want to instantiate fresh evaluators per assertion to rule
 * out cross-test contamination.
 */
export interface DslConformanceArgs<
  TKind extends string,
  TAst,
  TScope,
  TOutput,
  TOps extends HostOpSet,
> {
  readonly kind: TKind;
  /** Fresh evaluator per call. */
  makeEvaluator(): DslEvaluator<TAst, TScope, TOutput, TOps>;
  /** The kind's typed host-op registry. */
  readonly registry: HostOpRegistry<TOps>;
  /** Corpus of samples driving the six-property assertions. */
  readonly samples: ReadonlyArray<DslConformanceSample<TAst, TScope, TOps>>;
}

/**
 * The six-property checker. Each method returns the list of violations it
 * found — empty array = pass. Aggregating into a list rather than throwing
 * keeps the substrate's no-throws property intact even when validating
 * itself.
 *
 * In slice #3 a concrete `dslContractTest()` orchestrator wires these into
 * `describe(...)` / `test(...)` blocks (via `@atlas/test`). For slice #1
 * the interface + the meta-test (`contract-tests.test.ts`) prove the
 * shape is sound.
 */
export interface DslConformanceChecker {
  /**
   * Property 1: bounded. Asserts `stepCost(node) >= 1` for every node in
   * the supplied samples — a `stepCost` that returns 0 would allow free
   * evaluation and circumvent the budget.
   */
  checkBounded(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): ReadonlyArray<string>;
  /**
   * Property 2: pure w.r.t. host state. Asserts that evaluating the same
   * sample twice yields the same `Result.ok` and (when ok) the same
   * `Result.value` (via structural equality, since outputs may be objects).
   * The check is necessarily approximate — it cannot prove purity, only
   * disprove it on specific samples.
   */
  checkPure(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): Promise<ReadonlyArray<string>>;
  /**
   * Property 3: no ambient I/O. Asserts the kind's `HostOpRegistry` only
   * exposes `port: null` for ops with `category: 'pure'`. Effectful ops
   * MUST name a port. This is a static check against `registry.list()`.
   */
  checkNoAmbientIo(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): ReadonlyArray<string>;
  /**
   * Property 4: deterministic. Subsumes (2) — repeated evaluation of the
   * same `(ast, scope, hostOps)` yields the same `Result`. Implementation
   * shares the repeated-eval scaffolding with `checkPure`.
   */
  checkDeterministic(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): Promise<ReadonlyArray<string>>;
  /**
   * Property 5: budget-enforced. Asserts an over-budget sample returns
   * `{ ok: false, error: { code: 'DSL_BUDGET_EXCEEDED' } }`. The checker
   * synthesises a tiny budget and a deep sample (per DSL — supplied via
   * `samples`).
   */
  checkBudgetEnforced(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): Promise<ReadonlyArray<string>>;
  /**
   * Property 6: statically typeable. Asserts unknown identifiers in samples
   * with `expect.outcome === 'error'` and `code === 'DSL_UNKNOWN_IDENTIFIER'`
   * are caught by `staticCheck` (not deferred to `evaluate`).
   */
  checkStaticallyTypeable(
    args: DslConformanceArgs<string, unknown, unknown, unknown, HostOpSet>,
  ): ReadonlyArray<string>;
}

/**
 * Concrete checker factory. Returns a `DslConformanceChecker` whose method
 * bodies land in slice #3 alongside the expression DSL. This signature
 * lets slice #1 compile-test the surface and write a meta-test against a
 * stub implementation. The default export is the stub; the real one
 * replaces it in slice #3.
 */
export interface DslConformanceCheckerFactory {
  open(): DslConformanceChecker;
}

/**
 * Convenience helper for slice #1's meta-test. Returns a checker whose
 * methods uniformly emit a single placeholder violation, so the meta-test
 * can assert "any non-conforming evaluator produces violations" without
 * needing the real assertion bodies.
 *
 * Replaced in slice #3 by the real checker. Callers (DSL authors) should
 * use the export the substrate ships at the time their DSL lands — they
 * don't construct this stub themselves.
 */
export function stubConformanceChecker(): DslConformanceChecker {
  const stub = (): ReadonlyArray<string> => [
    'stub: checker assertion body lands with the first concrete DSL (slice #3)',
  ];
  const stubAsync = (): Promise<ReadonlyArray<string>> => Promise.resolve(stub());
  return {
    checkBounded: stub,
    checkPure: stubAsync,
    checkNoAmbientIo: stub,
    checkDeterministic: stubAsync,
    checkBudgetEnforced: stubAsync,
    checkStaticallyTypeable: stub,
  };
}

/**
 * Synthetic Result helpers used by future assertions and by the meta-test
 * to construct typed `Result` values without resorting to `as` casts.
 * Exported so DSL authors can use them in their own tests.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
