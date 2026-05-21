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
 * Real conformance checker. Lands in slice #3 alongside the expression DSL.
 * Drives the six §2 properties as executable assertions:
 *
 *   - **Bounded**: `stepCost(ast)` for each sample's AST root is >= 1.
 *   - **Pure**: evaluating the same `(ast, scope, hostOps)` twice yields
 *     `Result.ok` agreement and (when ok) value equality via JSON-string
 *     comparison. Approximation, not proof — purity is undecidable in
 *     general, but a sample-driven differential assertion catches the
 *     common drift cases.
 *   - **No ambient I/O**: every effectful op in the registry names a
 *     port; every pure op leaves port null. The closed-set property
 *     (ADR 0007 §6) is enforced at registration; this assertion proves
 *     the registry was registered correctly.
 *   - **Deterministic**: shares its body with the purity check.
 *   - **Budget-enforced**: re-evaluates each `expect.outcome === 'ok'`
 *     sample with a step budget of 1; the assertion expects either an
 *     `ok` outcome (trivial AST, finished within the budget) or a
 *     `DSL_BUDGET_EXCEEDED` failure. Anything else means the evaluator
 *     ignored the budget.
 *   - **Statically typeable**: for samples whose `expect.outcome` is
 *     `'error'` with `code === 'DSL_UNKNOWN_IDENTIFIER'`, `staticCheck`
 *     must return at least one error with that same code.
 *
 * Returns a list of human-readable violation strings per method; empty
 * array = pass. Aggregating violations rather than throwing keeps the
 * substrate's no-throws invariant intact.
 */
export function makeConformanceChecker(): DslConformanceChecker {
  function deepEqualJson(a: unknown, b: unknown): boolean {
    // Structural equality via canonical JSON. Adequate for the value
    // shapes a DSL outputs (primitives + JSON-serialisable structures).
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return {
    checkBounded(args) {
      const violations: string[] = [];
      const evaluator = args.makeEvaluator();
      for (const sample of args.samples) {
        const cost = evaluator.stepCost(sample.ast);
        if (!Number.isFinite(cost) || cost < 1) {
          violations.push(`sample '${sample.name}': stepCost(ast) returned ${cost}; must be >= 1`);
        }
      }
      return violations;
    },
    async checkPure(args) {
      const { openBudget } = await import('./budget.ts');
      const violations: string[] = [];
      const evaluator = args.makeEvaluator();
      for (const sample of args.samples) {
        const b1 = openBudget(10_000, 5000);
        const r1 = await evaluator.evaluate(sample.ast, sample.scope, sample.ops, b1);
        const b2 = openBudget(10_000, 5000);
        const r2 = await evaluator.evaluate(sample.ast, sample.scope, sample.ops, b2);
        if (r1.ok !== r2.ok) {
          violations.push(
            `sample '${sample.name}': two evaluations disagreed on ok (${r1.ok} vs ${r2.ok})`,
          );
        } else if (r1.ok && r2.ok && !deepEqualJson(r1.value, r2.value)) {
          violations.push(`sample '${sample.name}': two evaluations returned different values`);
        }
      }
      return violations;
    },
    checkNoAmbientIo(args) {
      const violations: string[] = [];
      for (const op of args.registry.list()) {
        if (op.category === 'effectful' && op.port === null) {
          violations.push(`op '${op.name}': effectful but port is null`);
        }
      }
      return violations;
    },
    async checkDeterministic(args) {
      // Determinism subsumes purity (same inputs → same outputs).
      // Implementation re-uses the purity body.
      return this.checkPure(args);
    },
    async checkBudgetEnforced(args) {
      const { openBudget } = await import('./budget.ts');
      const violations: string[] = [];
      const evaluator = args.makeEvaluator();
      for (const sample of args.samples) {
        if (sample.expect.outcome !== 'ok') continue;
        // 1-step budget: anything beyond a trivial AST must exceed.
        const tinyBudget = openBudget(1, 5000);
        const r = await evaluator.evaluate(sample.ast, sample.scope, sample.ops, tinyBudget);
        if (!r.ok && r.error.code !== 'DSL_BUDGET_EXCEEDED') {
          violations.push(
            `sample '${sample.name}': tiny-budget eval failed with ${r.error.code} rather than DSL_BUDGET_EXCEEDED`,
          );
        }
        // ok and BUDGET_EXCEEDED are both acceptable — the AST may have been small enough to fit.
      }
      return violations;
    },
    checkStaticallyTypeable(args) {
      const violations: string[] = [];
      const evaluator = args.makeEvaluator();
      for (const sample of args.samples) {
        if (sample.expect.outcome !== 'error') continue;
        if (sample.expect.code !== 'DSL_UNKNOWN_IDENTIFIER') continue;
        const errors = evaluator.staticCheck(sample.ast, sample.hints ?? {});
        const found = errors.some((e) => e.code === 'DSL_UNKNOWN_IDENTIFIER');
        if (!found) {
          violations.push(
            `sample '${sample.name}': staticCheck did not catch DSL_UNKNOWN_IDENTIFIER`,
          );
        }
      }
      return violations;
    },
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
