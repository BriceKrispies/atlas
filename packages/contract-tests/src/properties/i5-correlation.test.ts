/**
 * Self-test for the I5 correlation-propagation property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i5-correlation-propagation
 */
import { describe, test } from '@atlas/test';
import type { EventStore } from '@atlas/ports';
import {
  runProperty,
  stampCorrelationVerbatim,
  type RequestEvent,
} from './i5-correlation.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { MemEventStore } from './_fakes.ts';

/**
 * BROKEN emit: regenerates the correlationId per event instead of
 * propagating the request's. Violates I5.
 */
async function brokenCorrelationEmit(
  store: EventStore,
  _correlationId: string,
  events: RequestEvent[],
): Promise<string[]> {
  return stampCorrelationVerbatim(
    store,
    // Discard the request correlationId; mint a fresh one each call.
    `regen-${Math.random().toString(36).slice(2)}`,
    events,
  );
}

describe('I5 correlation-propagation property', function () {
  test('holds when correlationId is stamped verbatim', async function () {
    await expectPropertyToHold(() =>
      runProperty({
        makeStore: async () => new MemEventStore(),
        emitRequest: stampCorrelationVerbatim,
      }),
    );
  });

  test('catches + shrinks an emit path that regenerates correlationId', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({
        makeStore: async () => new MemEventStore(),
        emitRequest: brokenCorrelationEmit,
      }),
    );
  });
});
