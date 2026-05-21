/**
 * Step + wall-clock budgets, enforced by the substrate (not by DSL authors).
 *
 * ADR 0007 §2 property 5: "Every evaluation runs under a step budget
 * (instructions executed) and a wall-clock budget. Exceeding either returns
 * `DSL_BUDGET_EXCEEDED` and aborts the host request — no partial output
 * committed. Budgets are enforced by the platform evaluator, not by the DSL
 * author."
 *
 * The implementation here lives in `./evaluator-impl.ts` once a concrete
 * evaluator lands. This file ships the *interface* the evaluator sees and
 * a factory `openBudget` that produces a fresh ticket per evaluation. DSL
 * authors call `budget.consumeSteps(n)` per AST node visited (the `n`
 * comes from the evaluator's own `stepCost(node)` method); the substrate
 * wraps this with wall-clock sampling and returns `DSL_BUDGET_EXCEEDED`
 * when either runs out.
 *
 * No implementation lands in this slice — only the contract. The first
 * concrete evaluator (expression DSL, slice #3) ships `openBudget` along
 * with the rest of `evaluator-impl.ts`. Until then this file is types-only.
 */

import type { DslError } from './errors.ts';
import type { Result } from './result.ts';

/**
 * Substrate-enforced budget ticket. Threaded through every evaluator call;
 * each AST-node visit consumes steps via `consumeSteps`. The wall-clock
 * side is the evaluator-loop's responsibility (it samples on a cadence
 * the substrate decides — typically every N steps).
 *
 * Both consumption methods return `Result<void, DslError>` rather than
 * throwing. The evaluator inspects the result and short-circuits — keeps
 * the no-throws property of the substrate intact (see `./evaluator.ts`).
 */
export interface BudgetTicket {
  /**
   * Charge `n` steps to the ticket. Returns ok with no payload when the
   * ticket still has budget remaining; returns a `DSL_BUDGET_EXCEEDED`
   * error when it doesn't. `n` is expected to be ≥ 1 (the evaluator's
   * `stepCost(node)` is constrained to that range).
   */
  consumeSteps(n: number): Result<void, DslError>;
  /**
   * Charge `ms` of wall-clock time. The evaluator samples this periodically
   * (not on every node) — call sites are at the evaluator-loop boundaries.
   * `ms` is expected to be ≥ 0.
   */
  consumeWallClock(ms: number): Result<void, DslError>;
  /** Read-only snapshot of remaining budget. Useful for logging / introspection. */
  readonly remaining: {
    readonly steps: number;
    readonly wallClockMs: number;
  };
}

/**
 * Open a fresh budget ticket. Implementation deferred to slice #3 (the
 * expression DSL ships the first concrete evaluator and the first
 * implementation of this factory). The shape is committed here so DSL
 * authors can write evaluators against the interface today.
 */
export interface BudgetFactory {
  open(stepLimit: number, wallClockMs: number): BudgetTicket;
}
