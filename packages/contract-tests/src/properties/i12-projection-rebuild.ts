/**
 * I12 — Projections Are Rebuildable (property).
 *
 * @spec: specs/architecture.md#i12-projections-are-rebuildable
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every event sequence,
 * replay-from-empty produces the same projection state (testing.md §2.2).
 * Two corollaries the property pins:
 *
 *   1. DETERMINISM — rebuilding from the same event history twice yields
 *      byte-identical state. A projection that reads any non-event input
 *      (wall clock, random, external store) breaks this.
 *   2. IDEMPOTENT DISPATCH — replaying the SAME events a second time onto
 *      an already-built projection does not change it (testing.md §6.2:
 *      "no duplicate projection writes").
 *
 * The seam is `adapters.projector`: a pure reducer `(state, event) =>
 * state` plus its `empty` seed. The property persists a generated event
 * sequence, rebuilds the projection from `store.readEvents`, and checks
 * both corollaries. A correct projector is a pure fold over events; a
 * broken one folds in non-event state.
 */
import fc from 'fast-check';
import type { EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { runConfig } from './_harness.ts';

/** A pure projector: fold events into read-model state. */
export interface Projector<S> {
  empty: () => S;
  apply: (state: S, event: EventEnvelope) => S;
  /** Stable serialization for equality (canonical, key-order independent). */
  serialize: (state: S) => string;
}

export interface I12Adapters<S> {
  makeStore: () => Promise<EventStore>;
  projector: Projector<S>;
}

/** Rebuild projection state for a tenant by folding its event history. */
async function rebuild<S>(
  store: EventStore,
  tenantId: string,
  projector: Projector<S>,
): Promise<S> {
  const events = await store.readEvents(tenantId);
  return events.reduce<S>((s, e) => projector.apply(s, e), projector.empty());
}

interface GenEvent {
  tenantId: string;
  idempotencyKey: string;
  kind: 'created' | 'renamed' | 'deleted';
  resourceId: string;
}

function toEnvelope(e: GenEvent, i: number): EventEnvelope {
  return {
    eventId: `evt-i12-${e.tenantId}-${i}-${e.idempotencyKey}`,
    eventType: `Resource.${e.kind}`,
    schemaId: 'test.i12.v1',
    schemaVersion: 1,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60)).toISOString(),
    tenantId: e.tenantId,
    correlationId: 'corr-i12',
    idempotencyKey: `${e.idempotencyKey}-${i}`,
    causationId: null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: [`Tenant:${e.tenantId}`],
    payload: { resourceId: e.resourceId, kind: e.kind },
  };
}

const genEventArb: fc.Arbitrary<GenEvent> = fc.record({
  tenantId: fc.constant('tenant-i12'),
  idempotencyKey: fc.string({ minLength: 1, maxLength: 6 }),
  kind: fc.constantFrom('created' as const, 'renamed' as const, 'deleted' as const),
  resourceId: fc.constantFrom('r1', 'r2', 'r3'),
});

const seqArb = fc.array(genEventArb, { minLength: 0, maxLength: 16 });

export function runProperty<S>(adapters: I12Adapters<S>): Promise<void> {
  const { projector } = adapters;
  return fc.assert(
    fc.asyncProperty(seqArb, async function (seq) {
      const store = await adapters.makeStore();
      for (let i = 0; i < seq.length; i++) {
        await store.append(toEnvelope(seq[i]!, i));
      }
      const tenantId = 'tenant-i12';

      // (1) Determinism: two independent rebuilds match.
      const a = await rebuild(store, tenantId, projector);
      const b = await rebuild(store, tenantId, projector);
      if (projector.serialize(a) !== projector.serialize(b)) return false;

      // (2) Idempotent dispatch: re-applying the same events onto an
      // already-built projection does not change it.
      const events = await store.readEvents(tenantId);
      const reapplied = events.reduce<S>((s, e) => projector.apply(s, e), a);
      if (projector.serialize(reapplied) !== projector.serialize(a)) return false;

      return true;
    }),
    runConfig(),
  );
}
