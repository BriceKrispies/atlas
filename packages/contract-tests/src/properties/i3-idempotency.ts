/**
 * I3 — Idempotency Before Execution (property).
 *
 * @spec: specs/architecture.md#i3-idempotency-before-execution
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every sequence of appends in
 * which some share a `(tenantId, idempotencyKey)` pair, the store
 * persists EXACTLY ONE event per distinct pair, and every replay of a
 * pair resolves to the original event's `eventId` / `seq`. No duplicate
 * key ever produces a second row.
 *
 * Property shape (testing.md §2.2): "For every (intent, replayCount), the
 * handler runs ≤ 1 time and emits ≤ 1 event." We model the handler-emit at
 * the EventStore boundary: a replay is a re-append with the same
 * idempotency key; the store is the dedup point ingress relies on (I3).
 */
import fc from 'fast-check';
import type { EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { runConfig } from './_harness.ts';

export interface I3Adapters {
  /** A fresh, empty EventStore for each generated case. */
  makeStore: () => Promise<EventStore>;
}

/** One append op the generator can emit. */
interface AppendOp {
  tenantId: string;
  idempotencyKey: string;
  /** A nonce so re-appends carry a distinct candidate eventId/payload. */
  nonce: number;
}

function makeEnvelope(op: AppendOp, seqHint: number): EventEnvelope {
  return {
    eventId: `evt-${op.tenantId}-${op.idempotencyKey}-${op.nonce}-${seqHint}`,
    eventType: 'Test.I3.Event',
    schemaId: 'test.i3.v1',
    schemaVersion: 1,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seqHint % 60)).toISOString(),
    tenantId: op.tenantId,
    correlationId: `corr-${op.idempotencyKey}-${op.nonce}`,
    idempotencyKey: op.idempotencyKey,
    causationId: null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: [`Tenant:${op.tenantId}`],
    payload: { nonce: op.nonce },
  };
}

/** Generator: a small tenant/key alphabet maximizes replay collisions. */
const appendOpArb: fc.Arbitrary<AppendOp> = fc.record({
  tenantId: fc.constantFrom('tenant-a', 'tenant-b', 'tenant-c'),
  idempotencyKey: fc.constantFrom('idem-1', 'idem-2', 'idem-3'),
  nonce: fc.integer({ min: 0, max: 1_000_000 }),
});

const opsArb: fc.Arbitrary<AppendOp[]> = fc.array(appendOpArb, {
  minLength: 1,
  maxLength: 12,
});

export function runProperty(adapters: I3Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(opsArb, async function (ops) {
      const store = await adapters.makeStore();
      // The eventId each (tenant,key) pair SHOULD forever resolve to —
      // the eventId of its FIRST append.
      const firstEventIdFor = new Map<string, string>();
      const firstSeqFor = new Map<string, bigint>();

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        const pair = `${op.tenantId}::${op.idempotencyKey}`;
        const stored = await store.append(makeEnvelope(op, i));
        if (!firstEventIdFor.has(pair)) {
          firstEventIdFor.set(pair, stored.eventId);
          firstSeqFor.set(pair, stored.seq);
        } else {
          // Replay: MUST resolve to the original event, not a new one.
          if (stored.eventId !== firstEventIdFor.get(pair)) return false;
          if (stored.seq !== firstSeqFor.get(pair)) return false;
        }
      }

      // After all appends, each tenant holds exactly one event per distinct
      // idempotency key seen for that tenant.
      const tenants = new Set(ops.map((o) => o.tenantId));
      for (const tenantId of tenants) {
        const distinctKeys = new Set(
          ops.filter((o) => o.tenantId === tenantId).map((o) => o.idempotencyKey),
        );
        const events = await store.readEvents(tenantId);
        if (events.length !== distinctKeys.size) return false;
        // No two persisted events share an idempotency key within a tenant.
        const keys = events.map((e) => e.idempotencyKey);
        if (new Set(keys).size !== keys.length) return false;
      }
      return true;
    }),
    runConfig(),
  );
}
