/**
 * I5 — Correlation Propagation (property).
 *
 * @spec: specs/architecture.md#i5-correlation-propagation
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every request, the assigned
 * `correlationId` appears UNCHANGED on every event emitted within that
 * request. testing.md §2.2: "correlationId appears unchanged in every
 * downstream log, event, and audit record."
 *
 * We model a request as a batch of envelopes the handler emits carrying a
 * single request-level correlationId. The property persists the batch and
 * asserts every stored event for the request still carries that exact
 * correlationId — the store (or any layer it passes through) must not
 * rewrite, drop, or default it.
 *
 * The seam is `adapters.emitRequest(store, correlationId, events)`: it
 * stamps the correlationId onto each event and appends them. A correct
 * implementation copies the id verbatim; a broken one regenerates or
 * mutates it.
 */
import fc from 'fast-check';
import type { EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { runConfig } from './_harness.ts';

/** A single emitted event within a request, before correlation stamping. */
export interface RequestEvent {
  tenantId: string;
  idempotencyKey: string;
  eventType: string;
}

export interface I5Adapters {
  makeStore: () => Promise<EventStore>;
  /**
   * Stamp `correlationId` onto each event and append it. The contract: the
   * stamped correlationId on every persisted event equals the argument,
   * verbatim. The default correct impl is `stampCorrelationVerbatim`.
   */
  emitRequest: (
    store: EventStore,
    correlationId: string,
    events: RequestEvent[],
  ) => Promise<string[]>;
}

/** Reference correct stamping — copies correlationId verbatim onto each event. */
export async function stampCorrelationVerbatim(
  store: EventStore,
  correlationId: string,
  events: RequestEvent[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const envelope: EventEnvelope = {
      eventId: `evt-${correlationId}-${i}`,
      eventType: e.eventType,
      schemaId: 'test.i5.v1',
      schemaVersion: 1,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60)).toISOString(),
      tenantId: e.tenantId,
      correlationId,
      idempotencyKey: e.idempotencyKey,
      causationId: null,
      principalId: 'user:test',
      userId: null,
      cacheInvalidationTags: [`Tenant:${e.tenantId}`],
      payload: { i },
    };
    const stored = await store.append(envelope);
    ids.push(stored.eventId);
  }
  return ids;
}

const requestEventArb: fc.Arbitrary<RequestEvent> = fc.record({
  tenantId: fc.constantFrom('tenant-a', 'tenant-b'),
  idempotencyKey: fc.string({ minLength: 1, maxLength: 8 }),
  eventType: fc.constantFrom('A.Created', 'B.Updated', 'C.Deleted'),
});

const requestArb = fc.record({
  // correlationId from a realistic alphabet incl. punctuation a buggy
  // serializer might mangle.
  correlationId: fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((s) => s.trim().length > 0),
  events: fc.array(requestEventArb, { minLength: 1, maxLength: 8 }),
});

export function runProperty(adapters: I5Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(requestArb, async function ({ correlationId, events }) {
      const store = await adapters.makeStore();
      // Dedup idempotency keys within the request so the store doesn't
      // collapse two events into one (which is correct I3 behavior but
      // would shrink the request below the asserted count).
      const seen = new Set<string>();
      const unique = events.filter((e) => {
        const k = `${e.tenantId}::${e.idempotencyKey}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const ids = await adapters.emitRequest(store, correlationId, unique);

      // Every emitted event, read back, carries the request's correlationId.
      for (const id of ids) {
        const fetched = await store.getEvent(id);
        if (fetched === null) return false;
        if (fetched.correlationId !== correlationId) return false;
      }
      return true;
    }),
    runConfig(),
  );
}
