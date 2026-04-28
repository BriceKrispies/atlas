import { describe, test, expect, beforeEach } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';

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
  describe('EventStore contract', () => {
    let store: EventStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    test('append returns the envelope eventId for a fresh idempotency key', async () => {
      const env = makeEvent({ eventId: 'evt-001' });
      const id = await store.append(env);
      expect(id).toBe('evt-001');
    });

    test('append + getEvent round-trip preserves envelope shape', async () => {
      const env = makeEvent({
        eventId: 'evt-rt',
        cacheInvalidationTags: ['Tenant:tenant-a', 'SearchIndex:catalog'],
      });
      await store.append(env);
      const fetched = await store.getEvent('evt-rt');
      expect(fetched).not.toBeNull();
      expect(fetched!.eventId).toBe('evt-rt');
      expect(fetched!.tenantId).toBe('tenant-a');
      expect(fetched!.cacheInvalidationTags).toEqual([
        'Tenant:tenant-a',
        'SearchIndex:catalog',
      ]);
      expect(fetched!.payload).toEqual({ hello: 'world' });
    });

    test('append returns the original eventId when the same idempotency key is replayed with the same payload', async () => {
      const env = makeEvent({ eventId: 'evt-orig', idempotencyKey: 'idem-replay' });
      const r1 = await store.append(env);
      const r2 = await store.append(env);
      expect(r1).toBe('evt-orig');
      expect(r2).toBe('evt-orig');
    });

    test('append returns the original eventId when the same idempotency key is replayed with a DIFFERENT eventId/payload', async () => {
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
      expect(r2).toBe('evt-first');
    });

    test('idempotency key is tenant-scoped — same key in different tenants produces two distinct events', async () => {
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
      expect(ra).toBe('evt-a');
      expect(rb).toBe('evt-b');

      const aEvents = await store.readEvents('tenant-a');
      const bEvents = await store.readEvents('tenant-b');
      expect(aEvents.map((e) => e.eventId)).toEqual(['evt-a']);
      expect(bEvents.map((e) => e.eventId)).toEqual(['evt-b']);
    });

    test('idempotency key replay within the same tenant returns the original eventId', async () => {
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
      expect(ra).toBe('evt-orig-tenant');
      expect(rb).toBe('evt-orig-tenant');

      const events = await store.readEvents('tenant-same');
      expect(events.length).toBe(1);
    });

    test('readEvents is tenant-scoped — never returns events from another tenant', async () => {
      await store.append(makeEvent({ eventId: 'evt-a1', tenantId: 'tenant-a' }));
      await store.append(makeEvent({ eventId: 'evt-a2', tenantId: 'tenant-a' }));
      await store.append(makeEvent({ eventId: 'evt-b1', tenantId: 'tenant-b' }));

      const aEvents = await store.readEvents('tenant-a');
      const bEvents = await store.readEvents('tenant-b');

      expect(aEvents.map((e) => e.eventId).sort()).toEqual(['evt-a1', 'evt-a2']);
      expect(bEvents.map((e) => e.eventId)).toEqual(['evt-b1']);
    });

    test('readEvents on an unseen tenant returns an empty array', async () => {
      const list = await store.readEvents('tenant-empty');
      expect(list).toEqual([]);
    });

    test('readEvents returns events strictly ascending by occurredAt (regardless of insertion order)', async () => {
      const t = (offset: number): string =>
        new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
      // Insert out of order: late, early, mid. The contract is the adapter
      // sorts the result by occurredAt ASC.
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
      expect(events.map((e) => e.eventId)).toEqual(['evt-early', 'evt-mid', 'evt-late']);

      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1]!;
        const curr = events[i]!;
        expect(prev.occurredAt <= curr.occurredAt).toBe(true);
      }
    });

    test('getEvent returns null for an unknown eventId', async () => {
      const v = await store.getEvent('does-not-exist');
      expect(v).toBeNull();
    });

    test('cacheInvalidationTags survive append + getEvent round-trip', async () => {
      const env = makeEvent({
        eventId: 'evt-tags',
        cacheInvalidationTags: ['Tenant:t', 'TaxonomyTree:recognition', 'SearchIndex:catalog'],
      });
      await store.append(env);
      const fetched = await store.getEvent('evt-tags');
      expect(fetched!.cacheInvalidationTags).toContain('Tenant:t');
      expect(fetched!.cacheInvalidationTags).toContain('TaxonomyTree:recognition');
      expect(fetched!.cacheInvalidationTags).toContain('SearchIndex:catalog');
    });

    test('causationId on a child event references the parent event', async () => {
      const parent = makeEvent({ eventId: 'evt-parent' });
      await store.append(parent);
      const child = makeEvent({ eventId: 'evt-child', causationId: 'evt-parent' });
      await store.append(child);
      const fetched = await store.getEvent('evt-child');
      expect(fetched!.causationId).toBe('evt-parent');
    });

    test('readEvents includes events with a wide variety of payload shapes', async () => {
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

    test('[concurrency] 5 concurrent appends with the same idempotency key produce one event and one shared eventId', async () => {
      const idem = 'idem-concurrent';
      const envelopes = Array.from({ length: 5 }, (_, i) =>
        makeEvent({
          eventId: `evt-conc-${i}`,
          tenantId: 'tenant-conc',
          idempotencyKey: idem,
        }),
      );
      const results = await Promise.all(envelopes.map((e) => store.append(e)));

      const unique = new Set(results);
      expect(unique.size).toBe(1);
      const stored = await store.readEvents('tenant-conc');
      expect(stored.length).toBe(1);
      expect(results[0]).toBe(stored[0]!.eventId);
    });

    test('[concurrency] interleaved appends across tenants do not cross-contaminate', async () => {
      const ops: Promise<string>[] = [];
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
      expect(aEvents.every((e) => e.tenantId === 'tenant-x-a')).toBe(true);
      expect(bEvents.every((e) => e.tenantId === 'tenant-x-b')).toBe(true);
    });
  });
}
