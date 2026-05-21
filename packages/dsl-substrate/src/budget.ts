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
 * Substrate-shipped factory interface for budget tickets. Implemented by
 * `openBudget` below. DSL authors call the function; the interface exists
 * for tests and alternate implementations (e.g., a budget mock that
 * exposes consumption counts for assertions).
 */
export interface BudgetFactory {
  open(stepLimit: number, wallClockMs: number): BudgetTicket;
}

/**
 * Concrete `BudgetTicket` implementation. Tracks remaining steps and
 * wall-clock budget against a wall-clock start anchor (captured at open
 * time). Both `consumeSteps` and `consumeWallClock` are non-throwing;
 * exceeding either yields `{ok: false, error: DSL_BUDGET_EXCEEDED}`.
 *
 * The wall-clock side is sampled by the caller (the evaluator's loop
 * calls `consumeWallClock(0)` periodically to check elapsed time without
 * charging more time — the ticket reads `Date.now()` and compares to its
 * anchor). Step budgeting is the primary mechanism; wall-clock is a
 * safety net for runtime-dominated work like deep host-op chains.
 *
 * No ambient state is read except `Date.now()` — and that's required for
 * the wall-clock budget to mean anything. The ticket is otherwise
 * referentially transparent on its inputs.
 */
export function openBudget(stepLimit: number, wallClockMs: number): BudgetTicket {
  if (stepLimit < 0) {
    throw new Error(`openBudget: stepLimit must be >= 0 (got ${stepLimit})`);
  }
  if (wallClockMs < 0) {
    throw new Error(`openBudget: wallClockMs must be >= 0 (got ${wallClockMs})`);
  }
  let remainingSteps = stepLimit;
  let remainingWallClock = wallClockMs;
  const startedAt = Date.now();

  function refreshWallClock(): void {
    const elapsed = Date.now() - startedAt;
    remainingWallClock = Math.max(0, wallClockMs - elapsed);
  }

  return {
    consumeSteps(n: number): Result<void, DslError> {
      if (n < 0) {
        return {
          ok: false,
          error: {
            code: 'DSL_BUDGET_EXCEEDED',
            message: `BudgetTicket.consumeSteps requires n >= 0 (got ${n})`,
          },
        };
      }
      if (n > remainingSteps) {
        remainingSteps = 0;
        return {
          ok: false,
          error: {
            code: 'DSL_BUDGET_EXCEEDED',
            message: `step budget exhausted (limit ${stepLimit})`,
          },
        };
      }
      remainingSteps -= n;
      return { ok: true, value: undefined };
    },
    consumeWallClock(ms: number): Result<void, DslError> {
      // First refresh the wall-clock view, then charge the explicit ms.
      refreshWallClock();
      if (ms < 0) {
        return {
          ok: false,
          error: {
            code: 'DSL_BUDGET_EXCEEDED',
            message: `BudgetTicket.consumeWallClock requires ms >= 0 (got ${ms})`,
          },
        };
      }
      if (ms > remainingWallClock) {
        remainingWallClock = 0;
        return {
          ok: false,
          error: {
            code: 'DSL_BUDGET_EXCEEDED',
            message: `wall-clock budget exhausted (limit ${wallClockMs}ms)`,
          },
        };
      }
      remainingWallClock -= ms;
      return { ok: true, value: undefined };
    },
    get remaining() {
      refreshWallClock();
      return { steps: remainingSteps, wallClockMs: remainingWallClock };
    },
  };
}
