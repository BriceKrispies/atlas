/**
 * Self-test for the I6 causation-linkage property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i6-causation-linkage
 */
import { describe, test } from '@atlas/test';
import type { EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { runProperty, linkCausationByParentId, type ChainNode } from './i6-causation.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { MemEventStore } from './_fakes.ts';

/**
 * BROKEN linkage: sets causationId to a fabricated id that is NOT in the
 * request's event-id set. Violates I6 (dangling causation).
 */
async function brokenCausationEmit(
  store: EventStore,
  chain: ChainNode[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    const envelope: EventEnvelope = {
      eventId: `evt-broken-${node.tenantId}-${i}`,
      eventType: 'Test.I6.Event',
      schemaId: 'test.i6.v1',
      schemaVersion: 1,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60)).toISOString(),
      tenantId: node.tenantId,
      correlationId: 'corr-i6',
      idempotencyKey: `${node.idempotencyKey}-${i}`,
      // Dangling: references an event that was never appended.
      causationId: node.parentIndex === null ? null : `ghost-${i}`,
      principalId: 'user:test',
      userId: null,
      cacheInvalidationTags: [`Tenant:${node.tenantId}`],
      payload: { i },
    };
    const stored = await store.append(envelope);
    ids.push(stored.eventId);
  }
  return ids;
}

describe('I6 causation-linkage property', function () {
  test('holds when causationId references the real parent eventId', async function () {
    await expectPropertyToHold(() =>
      runProperty({
        makeStore: async () => new MemEventStore(),
        emitChain: linkCausationByParentId,
      }),
    );
  });

  test('catches + shrinks a chain with a dangling causationId', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({
        makeStore: async () => new MemEventStore(),
        emitChain: brokenCausationEmit,
      }),
    );
  });
});
