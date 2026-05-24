/**
 * I13 — Quota Enforcement Precedes Execution (property).
 *
 * @spec: specs/architecture.md#i13-quota-enforcement-precedes-execution
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every over-budget intent, zero
 * events are emitted and zero handlers run (testing.md §2.2). The quota
 * check sits between authz and idempotency in the pipeline; an over-budget
 * tenant short-circuits with `QUOTA_EXCEEDED` BEFORE any side effect.
 *
 * No `Quota` port exists yet, so the seam is the pipeline function under
 * test: `adapters.submit(state, intent)`. It returns `{ admitted, error? }`
 * and is wired with instrumented `runHandler` / `emitEvent` spies the
 * property reads. The property feeds a stream of intents against a fixed
 * budget and asserts:
 *
 *   - every REJECTED (over-budget) intent caused zero handler runs and
 *     zero event emits, AND
 *   - the cumulative admitted cost never exceeds the budget (the boundary
 *     held under the whole sequence, not just per-intent).
 *
 * A correct pipeline checks-then-dispatches; a broken one dispatches first
 * (or admits over budget).
 */
import fc from 'fast-check';
import { runConfig } from './_harness.ts';

export interface QuotaState {
  budget: number;
  /** mutated by the pipeline as it admits intents */
  consumed: number;
}

export interface Intent {
  cost: number;
}

export interface SubmitResult {
  admitted: boolean;
  error?: 'QUOTA_EXCEEDED';
}

export interface I13Adapters {
  /**
   * The ingress pipeline. MUST consult quota before invoking `onDispatch`
   * (handler run) or `onEmit` (event emit). The instrumentation callbacks
   * let the property count side effects.
   */
  submit: (
    state: QuotaState,
    intent: Intent,
    hooks: { onDispatch: () => void; onEmit: () => void },
  ) => SubmitResult;
}

/** Reference correct pipeline: check quota, then dispatch + emit. */
export function quotaCheckedSubmit(
  state: QuotaState,
  intent: Intent,
  hooks: { onDispatch: () => void; onEmit: () => void },
): SubmitResult {
  if (state.consumed + intent.cost > state.budget) {
    return { admitted: false, error: 'QUOTA_EXCEEDED' };
  }
  // Within budget: run the handler and emit, then account the cost.
  hooks.onDispatch();
  hooks.onEmit();
  state.consumed += intent.cost;
  return { admitted: true };
}

const intentArb: fc.Arbitrary<Intent> = fc.record({
  cost: fc.integer({ min: 0, max: 10 }),
});

const scenarioArb = fc.record({
  budget: fc.integer({ min: 0, max: 20 }),
  intents: fc.array(intentArb, { minLength: 0, maxLength: 16 }),
});

export function runProperty(adapters: I13Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(scenarioArb, async function ({ budget, intents }) {
      const state: QuotaState = { budget, consumed: 0 };
      let admittedCost = 0;

      for (const intent of intents) {
        let dispatched = 0;
        let emitted = 0;
        const result = adapters.submit(state, intent, {
          onDispatch: () => dispatched++,
          onEmit: () => emitted++,
        });

        if (!result.admitted) {
          // Over-budget intent: ZERO handler runs, ZERO events.
          if (dispatched !== 0) return false;
          if (emitted !== 0) return false;
          if (result.error !== 'QUOTA_EXCEEDED') return false;
        } else {
          admittedCost += intent.cost;
        }
      }

      // The boundary held across the whole sequence.
      if (admittedCost > budget) return false;
      return true;
    }),
    runConfig(),
  );
}
