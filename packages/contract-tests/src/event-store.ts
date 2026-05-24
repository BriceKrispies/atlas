import { describe, test, expect, beforeEach } from '@atlas/test';
import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { runProperty as runI3Property } from './properties/i3-idempotency.ts';
import {
  runProperty as runI6Property,
  linkCausationByParentId,
} from './properties/i6-causation.ts';
import {
  runProperty as runI12Property,
  type Projector,
} from './properties/i12-projection-rebuild.ts';
interface MakeEventOptions {
  eventId?: string;
  tenantId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  causationId?: string | null;
  cacheInvalidationTags?: string[] | null;
  payload?: unknown;
  eventType?: string;
}
let counter = 0;
function fresh(prefix: string): string {
  counter++;
  return `${prefix}-${counter.toString(36)}-${Date.now().toString(36)}`;
}
function makeEvent(opts: MakeEventOptions = {}): EventEnvelope {
  const eventId = opts.eventId ?? fresh('evt');
  return {
    eventId,
    eventType: opts.eventType ?? 'Test.Event',
    schemaId: 'test.event.v1',
    schemaVersion: 1,
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
    tenantId: opts.tenantId ?? 'tenant-a',
    correlationId: `corr-${eventId}`,
    idempotencyKey: opts.idempotencyKey ?? fresh('idem'),
    causationId: opts.causationId ?? null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: opts.cacheInvalidationTags ?? null,
    payload: opts.payload ?? { hello: 'world' },
  };
}
export function eventStoreContract(makeStore: () => Promise<EventStore>): void {
  describe('EventStore contract', function () {
    let store: EventStore;
    beforeEach(async function () {
      store = await makeStore();
    });
    test('append returns a StoredEvent with the envelope eventId for a fresh idempotency key', async function () {
      const env = makeEvent({ eventId: 'evt-001' });
      const stored = await store.append(env);
      expect(stored.eventId).toBe('evt-001');
      expect(typeof stored.seq).toBe('bigint');
      expect(stored.seq > 0n).toBe(true);
    });
    test('append + getEvent round-trip preserves envelope shape', async function () {
      const env = makeEvent({
        eventId: 'evt-rt',
        cacheInvalidationTags: ['Tenant:tenant-a', 'SearchIndex:catalog'],
      });
      await store.append(env);
      const fetched = assertDefined(
        await store.getEvent('evt-rt'),
        'getEvent(evt-rt) after append',
      );
      expect(fetched.eventId).toBe('evt-rt');
      expect(fetched.tenantId).toBe('tenant-a');
      expect(fetched.cacheInvalidationTags).toEqual(['Tenant:tenant-a', 'SearchIndex:catalog']);
      expect(fetched.payload).toEqual({ hello: 'world' });
    });
    test('append returns the original eventId when the same idempotency key is replayed with the same payload', async function () {
      const env = makeEvent({ eventId: 'evt-orig', idempotencyKey: 'idem-replay' });
      const r1 = await store.append(env);
      const r2 = await store.append(env);
      expect(r1.eventId).toBe('evt-orig');
      expect(r2.eventId).toBe('evt-orig');
      // Idempotency: replay returns the SAME seq (no new row inserted).
      expect(r2.seq).toBe(r1.seq);
    });
    test('append returns the original eventId when the same idempotency key is replayed with a DIFFERENT eventId/payload', async function () {
      const first = makeEvent({
        eventId: 'evt-first',
        idempotencyKey: 'idem-collision',
        payload: { v: 1 },
      });
      await store.append(first);
      const second = makeEvent({
        eventId: 'evt-second',
        idempotencyKey: 'idem-collision',
        payload: { v: 2 },
      });
      const r2 = await store.append(second);
      expect(r2.eventId).toBe('evt-first');
    });
    test('idempotency key is tenant-scoped — same key in different tenants produces two distinct events', async function () {
      const a = makeEvent({
        eventId: 'evt-a',
        tenantId: 'tenant-a',
        idempotencyKey: 'idem-shared',
      });
      const b = makeEvent({
        eventId: 'evt-b',
        tenantId: 'tenant-b',
        idempotencyKey: 'idem-shared',
      });
      const ra = await store.append(a);
      const rb = await store.append(b);
      expect(ra.eventId).toBe('evt-a');
      expect(rb.eventId).toBe('evt-b');
      const aEvents = await store.readEvents('tenant-a');
      const bEvents = await store.readEvents('tenant-b');
      expect(
        aEvents.map(function (e) {
          return e.eventId;
        }),
      ).toEqual(['evt-a']);
      expect(
        bEvents.map(function (e) {
          return e.eventId;
        }),
      ).toEqual(['evt-b']);
    });
    test('idempotency key replay within the same tenant returns the original eventId', async function () {
      const a = makeEvent({
        eventId: 'evt-orig-tenant',
        tenantId: 'tenant-same',
        idempotencyKey: 'idem-same-tenant',
      });
      const b = makeEvent({
        eventId: 'evt-replay-tenant',
        tenantId: 'tenant-same',
        idempotencyKey: 'idem-same-tenant',
      });
      const ra = await store.append(a);
      const rb = await store.append(b);
      expect(ra.eventId).toBe('evt-orig-tenant');
      expect(rb.eventId).toBe('evt-orig-tenant');
      const events = await store.readEvents('tenant-same');
      expect(events.length).toBe(1);
    });
    test('readEvents is tenant-scoped — never returns events from another tenant', async function () {
      await store.append(makeEvent({ eventId: 'evt-a1', tenantId: 'tenant-a' }));
      await store.append(makeEvent({ eventId: 'evt-a2', tenantId: 'tenant-a' }));
      await store.append(makeEvent({ eventId: 'evt-b1', tenantId: 'tenant-b' }));
      const aEvents = await store.readEvents('tenant-a');
      const bEvents = await store.readEvents('tenant-b');
      expect(
        aEvents
          .map(function (e) {
            return e.eventId;
          })
          .sort(),
      ).toEqual(['evt-a1', 'evt-a2']);
      expect(
        bEvents.map(function (e) {
          return e.eventId;
        }),
      ).toEqual(['evt-b1']);
    });
    test('readEvents on an unseen tenant returns an empty array', async function () {
      const list = await store.readEvents('tenant-empty');
      expect(list).toEqual([]);
    });
    test('readEvents returns events strictly ascending by seq (insertion order)', async function () {
      const t = function (offset: number): string {
        return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
      };
      // Insert out of order by occurredAt: late, early, mid. Contract is
      // insertion order — seq is monotonic per tenant, assigned at append.
      // This is the canonical event-sourcing order: what actually happened
      // in the store, not what producers claimed via occurredAt (which
      // may lie due to clock skew or backfill).
      await store.append(
        makeEvent({ eventId: 'evt-late', tenantId: 'tenant-ord', occurredAt: t(30) }),
      );
      await store.append(
        makeEvent({ eventId: 'evt-early', tenantId: 'tenant-ord', occurredAt: t(0) }),
      );
      await store.append(
        makeEvent({ eventId: 'evt-mid', tenantId: 'tenant-ord', occurredAt: t(15) }),
      );
      const events = await store.readEvents('tenant-ord');
      expect(
        events.map(function (e) {
          return e.eventId;
        }),
      ).toEqual(['evt-late', 'evt-early', 'evt-mid']);
      for (let i = 1; i < events.length; i++) {
        const prev = assertDefined(events[i - 1], `events[${i - 1}] in readEvents result`);
        const curr = assertDefined(events[i], `events[${i}] in readEvents result`);
        const prevSeq = assertDefined(prev.seq, 'prev.seq after append');
        const currSeq = assertDefined(curr.seq, 'curr.seq after append');
        expect(prevSeq < currSeq).toBe(true);
      }
    });
    test('getEvent returns null for an unknown eventId', async function () {
      const v = await store.getEvent('does-not-exist');
      expect(v).toBeNull();
    });
    test('cacheInvalidationTags survive append + getEvent round-trip', async function () {
      const env = makeEvent({
        eventId: 'evt-tags',
        cacheInvalidationTags: ['Tenant:t', 'TaxonomyTree:recognition', 'SearchIndex:catalog'],
      });
      await store.append(env);
      const fetched = assertDefined(
        await store.getEvent('evt-tags'),
        'getEvent(evt-tags) after append',
      );
      expect(fetched.cacheInvalidationTags).toContain('Tenant:t');
      expect(fetched.cacheInvalidationTags).toContain('TaxonomyTree:recognition');
      expect(fetched.cacheInvalidationTags).toContain('SearchIndex:catalog');
    });
    test('causationId on a child event references the parent event', async function () {
      const parent = makeEvent({ eventId: 'evt-parent' });
      await store.append(parent);
      const child = makeEvent({ eventId: 'evt-child', causationId: 'evt-parent' });
      await store.append(child);
      const fetched = assertDefined(
        await store.getEvent('evt-child'),
        'getEvent(evt-child) after append',
      );
      expect(fetched.causationId).toBe('evt-parent');
    });
    test('readEvents includes events with a wide variety of payload shapes', async function () {
      await store.append(
        makeEvent({
          eventId: 'evt-shapes-1',
          tenantId: 'tenant-shapes',
          payload: { nested: { a: 1, b: [1, 2, 3] } },
        }),
      );
      await store.append(
        makeEvent({ eventId: 'evt-shapes-2', tenantId: 'tenant-shapes', payload: 'string-body' }),
      );
      const events = await store.readEvents('tenant-shapes');
      expect(events.length).toBe(2);
    });
    test('[concurrency] 5 concurrent appends with the same idempotency key produce one event and one shared eventId', async function () {
      const idem = 'idem-concurrent';
      const envelopes = Array.from({ length: 5 }, function (_, i) {
        return makeEvent({
          eventId: `evt-conc-${i}`,
          tenantId: 'tenant-conc',
          idempotencyKey: idem,
        });
      });
      const results = await Promise.all(
        envelopes.map(function (e) {
          return store.append(e);
        }),
      );
      // Idempotency: all 5 concurrent appends MUST resolve to the same
      // eventId (and the same seq, since only one row is actually
      // persisted).
      const uniqueIds = new Set(
        results.map(function (r) {
          return r.eventId;
        }),
      );
      expect(uniqueIds.size).toBe(1);
      const uniqueSeqs = new Set(
        results.map(function (r) {
          return r.seq;
        }),
      );
      expect(uniqueSeqs.size).toBe(1);
      const stored = await store.readEvents('tenant-conc');
      expect(stored.length).toBe(1);
      const firstResult = assertDefined(results[0], 'results[0] from 5 concurrent appends');
      const firstStored = assertDefined(stored[0], 'stored[0] after concurrent appends');
      expect(firstResult.eventId).toBe(firstStored.eventId);
    });
    test('[error-shape] append with a missing required field on the envelope throws', async function () {
      // The `eventId` is the keyPath of the IDB store and the PK of the
      // Postgres `events` table — neither adapter can persist a row without
      // it. Contract: append rejects (rather than silently writing a
      // half-shaped row).
      const { eventId: _omitted, ...broken } = makeEvent({ eventId: 'evt-broken' });
      const brokenEnvelope = broken as unknown as EventEnvelope;
      await expect(store.append(brokenEnvelope)).rejects.toThrow();
    });
    test('[error-shape] getEvent on an empty eventId returns null (not an error)', async function () {
      // Neither adapter pre-validates the input string; a row with key '' has
      // not been written, so `get('')` falls through to "missing key", which
      // the contract pins to `null`.
      const v = await store.getEvent('');
      expect(v).toBeNull();
    });
    test('[concurrency] interleaved appends across tenants do not cross-contaminate', async function () {
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        ops.push(
          store.append(
            makeEvent({
              eventId: `evt-x-a-${i}`,
              tenantId: 'tenant-x-a',
              idempotencyKey: `idem-x-a-${i}`,
            }),
          ),
        );
        ops.push(
          store.append(
            makeEvent({
              eventId: `evt-x-b-${i}`,
              tenantId: 'tenant-x-b',
              idempotencyKey: `idem-x-b-${i}`,
            }),
          ),
        );
      }
      await Promise.all(ops);
      const aEvents = await store.readEvents('tenant-x-a');
      const bEvents = await store.readEvents('tenant-x-b');
      expect(aEvents.length).toBe(10);
      expect(bEvents.length).toBe(10);
      expect(
        aEvents.every(function (e) {
          return e.tenantId === 'tenant-x-a';
        }),
      ).toBe(true);
      expect(
        bEvents.every(function (e) {
          return e.tenantId === 'tenant-x-b';
        }),
      ).toBe(true);
    });
    // ── Cross-cutting invariant properties (testing.md §2.2) ──────────
    // The EventStore enforces I3 (idempotency), I6 (causation linkage),
    // and is the rebuild source for I12 (projection rebuildability). Each
    // adapter that imports this suite runs the SAME universally-quantified
    // properties against its own backing store. The properties' own
    // broken-adapter self-tests live alongside them in src/properties/.
    test('[property] I3 — duplicate idempotencyKey never re-executes (append dedups)', async function () {
      await runI3Property({ makeStore });
    });
    test('[property] I6 — every emitted event causationId references an event in the request set', async function () {
      await runI6Property({ makeStore, emitChain: linkCausationByParentId });
    });
    test('[property] I12 — projections rebuild identically and dispatch is idempotent', async function () {
      // A pure last-write-wins projector exercised against the real store:
      // determinism + idempotent re-apply must hold for any event sequence.
      type State = Record<string, string>;
      const projector: Projector<State> = {
        empty: function () {
          return {};
        },
        apply: function (state, event) {
          const p = event.payload as { resourceId: string; kind: string };
          if (p.kind === 'deleted') {
            const { [p.resourceId]: _drop, ...rest } = state;
            return rest;
          }
          return { ...state, [p.resourceId]: p.kind };
        },
        serialize: function (s) {
          return JSON.stringify(
            Object.fromEntries(
              Object.entries(s).sort(function (a, b) {
                return a[0].localeCompare(b[0]);
              }),
            ),
          );
        },
      };
      await runI12Property({ makeStore, projector });
    });
  });
}
