/**
 * Self-test for the I13 quota-before-dispatch property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i13-quota-enforcement-precedes-execution
 */
import { describe, test } from '@atlas/test';
import {
  runProperty,
  quotaCheckedSubmit,
  type QuotaState,
  type Intent,
  type SubmitResult,
} from './i13-quota-before-dispatch.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';

/**
 * BROKEN pipeline: dispatches + emits BEFORE checking quota, then rejects
 * over-budget. The side effects already fired — violates I13.
 */
function dispatchFirstSubmit(
  state: QuotaState,
  intent: Intent,
  hooks: { onDispatch: () => void; onEmit: () => void },
): SubmitResult {
  hooks.onDispatch();
  hooks.onEmit();
  if (state.consumed + intent.cost > state.budget) {
    return { admitted: false, error: 'QUOTA_EXCEEDED' };
  }
  state.consumed += intent.cost;
  return { admitted: true };
}

describe('I13 quota-before-dispatch property', function () {
  test('holds when quota is checked before dispatch', async function () {
    await expectPropertyToHold(() => runProperty({ submit: quotaCheckedSubmit }));
  });

  test('catches + shrinks a pipeline that dispatches before checking quota', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ submit: dispatchFirstSubmit }),
    );
  });
});
