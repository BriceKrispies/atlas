/**
 * Self-test helpers for the invariant property suites — the "test the test"
 * discipline from testing.md §6.3.
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 *
 * A property is only trustworthy if it FAILS against an adapter that
 * deliberately violates the invariant, and SHRINKS to a minimal
 * counterexample. These helpers wrap a `runProperty(adapters)` call so a
 * self-test can assert:
 *
 *   - `expectPropertyToCatchViolation` — running the property against a
 *     broken adapter throws (the property caught the violation) AND the
 *     thrown error carries a shrunk counterexample (fast-check minimized
 *     the failing input).
 *
 *   - `expectPropertyToHold` — running the property against a correct
 *     adapter does NOT throw (no false positives).
 *
 * Without the first assertion a green property is meaningless: a property
 * that never fails proves nothing.
 */
import { expect } from '@atlas/test';

export interface ViolationCaught {
  threw: boolean;
  message: string;
  /** True when fast-check reported a shrunk counterexample in the message. */
  shrank: boolean;
  counterexample: unknown;
}

/**
 * Run a property that is expected to FAIL (because the adapter is broken)
 * and assert both that it threw and that fast-check shrank to a minimal
 * counterexample. fast-check's failure error message embeds
 * `Counterexample: ...` and a `Shrunk N time(s)` line — we assert on both.
 */
export async function expectPropertyToCatchViolation(
  run: () => void | Promise<void>,
): Promise<ViolationCaught> {
  let threw = false;
  let message = '';
  let counterexample: unknown = null;
  try {
    await run();
  } catch (err) {
    threw = true;
    const e = err as { message?: string; counterexample?: unknown };
    message = e.message ?? String(err);
    counterexample = e.counterexample ?? null;
  }
  // A property that does not throw against a broken adapter is itself broken.
  if (!threw) {
    throw new Error('property must FAIL against a broken adapter, but it passed');
  }
  expect(threw).toBe(true);
  // fast-check embeds the shrunk counterexample in the failure message.
  const shrank =
    /Counterexample:/.test(message) || /Shrunk \d+ time/.test(message);
  if (!shrank) {
    throw new Error(`property failure must carry a shrunk counterexample\n${message}`);
  }
  expect(shrank).toBe(true);
  return { threw, message, shrank, counterexample };
}

/**
 * Run a property that is expected to HOLD (because the adapter is correct)
 * and assert it does NOT throw — guards against a property so loose it
 * accepts everything (which would also "fail" a broken adapter for the
 * wrong reason).
 */
export async function expectPropertyToHold(
  run: () => void | Promise<void>,
): Promise<void> {
  await run();
}
