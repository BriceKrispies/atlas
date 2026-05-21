/**
 * Purity-by-signature for the DSL evaluator surface.
 *
 * ADR 0007 §2 property 2: "Pure with respect to host state. No mutation of
 * host objects. Outputs are functions of inputs and the host-provided
 * context only."
 *
 * That requirement is encoded structurally in `DslEvaluator.evaluate`:
 *
 *   1. **No thrown exceptions.** `Result<T, E>` is the only return shape.
 *      A budget-exceeded or parse-error outcome is `{ ok: false, error: ... }`,
 *      never a throw that surprises the caller's control flow.
 *   2. **No ambient effects.** The signature accepts only `(ast, scope,
 *      hostOps, budget)`. Anything not in those four arguments cannot
 *      influence the output. `now()` cannot exist as a free function inside
 *      the evaluator; it must be in `hostOps`.
 *   3. **Static checkability.** `staticCheck` is the `validate` endpoint's
 *      engine, called with NO host ops. Errors at this stage are
 *      statically catchable; runtime errors are limited to host-op
 *      failures and budget exhaustion (ADR 0007 §2 property 6).
 *
 * Liskov note: every concrete DSL evaluator implements this interface for
 * its own `TAst`, `TScope`, `TOutput`, and `TOps`. The substrate sees them
 * all at `DslEvaluator<unknown, unknown, unknown, HostOpSet>` for uniform
 * dispatch (e.g. an `atlasctl dsl <kind> validate` command picks the right
 * evaluator off the kind and calls `staticCheck`). Preconditions (a parsed
 * AST, a scope object, a closed host-op set, a budget ticket) and
 * postconditions (a `Result`) are the same for every kind.
 */

import type { DslError } from './errors.ts';
import type { BudgetTicket } from './budget.ts';
import type { HostOpSet } from './host-ops.ts';
import type { Result } from './result.ts';

export type { Result } from './result.ts';

/**
 * Hints passed to `staticCheck` to narrow type analysis. The expected scope
 * shape (when the host can predict it — e.g. "this template renders inside
 * an article context") goes here. Per-DSL static checkers may extend the
 * type via declaration merging or by accepting a narrower hint type — the
 * substrate only requires the base fields.
 */
export interface StaticCheckHints {
  /**
   * When set, the static checker may verify identifier references against
   * this shape. Otherwise unknown identifiers are flagged as
   * `DSL_UNKNOWN_IDENTIFIER` only if they cannot match any plausible scope.
   */
  readonly expectedScopeShape?: Readonly<Record<string, unknown>>;
  /**
   * The substrate version the artifact was authored against. The checker
   * MAY emit `DSL_SUBSTRATE_VERSION_MISMATCH` when it detects a hint that
   * a newer/older substrate would resolve differently. Optional — the
   * authoritative version check lives at the artifact load boundary.
   */
  readonly authoredSubstrateVersion?: string;
}

/**
 * The evaluator surface every concrete DSL implements. Generic over the
 * AST type (`TAst`), the per-evaluation scope (`TScope`), the output type
 * (`TOutput`), and the kind's closed host-op set (`TOps`).
 *
 * The interface is intentionally narrow:
 *   - `evaluate` is the hot path. Pure by signature (see file header).
 *   - `staticCheck` is the validate-without-commit path (ADR 0007 §8).
 *   - `stepCost` is the per-node cost the substrate's budget enforcer
 *     multiplies into the running step total. Constrained ≥ 1 by
 *     contract-test convention (`./contract-tests.ts`).
 */
export interface DslEvaluator<TAst, TScope, TOutput, TOps extends HostOpSet> {
  /**
   * The hot path. Returns `Result<TOutput, DslError>` — no throws. Effects
   * route exclusively through `hostOps`. Budget consumption happens via
   * `budget.consumeSteps` / `budget.consumeWallClock` (see `./budget.ts`).
   */
  evaluate(
    ast: TAst,
    scope: TScope,
    hostOps: TOps,
    budget: BudgetTicket,
  ): Promise<Result<TOutput, DslError>>;

  /**
   * The validate-without-commit path. Walks the AST, type-checks identifier
   * references against `hints.expectedScopeShape`, and returns the list of
   * errors detected. Empty array = the artifact passed static checking.
   *
   * Static checking does NOT execute the artifact. No host ops are
   * available; budget is not consulted. Errors here are limited to
   * `DSL_PARSE_ERROR` (if the static checker re-parses), `DSL_TYPE_ERROR`,
   * `DSL_UNKNOWN_IDENTIFIER`, `DSL_BROKEN_REFERENCE`,
   * `DSL_SUBSTRATE_VERSION_MISMATCH`. Runtime-only codes
   * (`DSL_BUDGET_EXCEEDED`, `DSL_HOST_OP_FAILED`) are never returned from
   * `staticCheck`.
   */
  staticCheck(ast: TAst, hints: StaticCheckHints): ReadonlyArray<DslError>;

  /**
   * Per-AST-node step cost. The substrate's evaluator loop calls this for
   * each node visited and consumes the returned value from the budget.
   * Authors must return ≥ 1 for every node — the contract-test checker
   * rejects a `stepCost` that returns 0 or negative numbers (would allow a
   * tree to evaluate for free, circumventing the bounded-execution
   * guarantee from ADR 0007 §2 property 5).
   *
   * Note: `node` is typed as `unknown` so this method participates in the
   * `DslEvaluator<unknown, unknown, unknown, HostOpSet>` projection the
   * substrate uses for uniform dispatch. Each concrete evaluator narrows
   * internally (e.g. with a type predicate) when computing the cost.
   */
  stepCost(node: unknown): number;
}
