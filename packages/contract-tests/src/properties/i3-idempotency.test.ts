/**
 * Self-test for the I3 idempotency property ("test the test", §6.3).
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i3-idempotency-before-execution
 */
import { describe, test } from '@atlas/test';
import { runProperty } from './i3-idempotency.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { BrokenIdempotencyEventStore, MemEventStore } from './_fakes.ts';

describe('I3 idempotency property', function () {
  test('holds against a correct EventStore', async function () {
    await expectPropertyToHold(() =>
      runProperty({ makeStore: async () => new MemEventStore() }),
    );
  });

  test('catches + shrinks a store that ignores idempotency keys', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ makeStore: async () => new BrokenIdempotencyEventStore() }),
    );
  });
});
