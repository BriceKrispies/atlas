/**
 * Multi-tab IDB stress test.
 *
 * Goal: catch single-thread assumptions in the IDB adapters before they bite
 * a user with two browser tabs open against the same database name. We open
 * two independent `IdbDb` connections to the SAME db name (the way two real
 * tabs would) and run write workloads concurrently across them.
 *
 * What this exercises:
 *
 * 1. EventStore idempotency across connections. The unique index on
 *    `(tenantId, idempotencyKey)` is enforced by IDB at the database level,
 *    not at the adapter level — both connections must converge on a single
 *    event for a shared idempotency key, and both `append` calls must
 *    return the same eventId.
 * 2. Cache invalidation atomicity across connections. Each tab's
 *    `invalidateByTags` must leave the database in a consistent state: every
 *    row that should be removed is gone, and untagged rows survive.
 *
 * The plan (`yes-then-after-commit-shimmying-mist.md`) calls this out
 * explicitly: "Add a multi-tab IDB stress test so single-thread assumptions
 * surface before they bite."
 */

import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import { IdbCache, IdbEventStore, openAtlasIdb, type IdbDb } from '@atlas/adapter-idb';

let dbCounter = 0;

function freshDbName(): string {
  dbCounter++;
  return `multi-tab-${dbCounter}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

interface Tab {
  db: IdbDb;
  events: IdbEventStore;
  cache: IdbCache;
}

async function openTab(name: string): Promise<Tab> {
  const db = await openAtlasIdb(name);
  return { db, events: new IdbEventStore(db), cache: new IdbCache(db) };
}

let envelopeCounter = 0;
function makeEvent(opts: {
  tab: 'A' | 'B';
  idempotencyKey: string;
  tenantId?: string;
}): EventEnvelope {
  envelopeCounter++;
  // Each tab proposes a DISTINCT eventId for the same idempotency key.
  // The contract is that exactly one wins and both calls return that
  // winner's eventId.
  const eventId = `evt-${opts.tab}-${envelopeCounter.toString(36)}`;
  const idem = opts.idempotencyKey;
  return {
    eventId,
    eventType: 'Test.MultiTab',
    schemaId: 'test.multi-tab.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId ?? 'tenant-mt',
    correlationId: `corr-${eventId}`,
    idempotencyKey: idem,
    causationId: null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: null,
    payload: { tab: opts.tab, idem },
  };
}

describe('IDB multi-tab stress', () => {
  let dbName: string;
  let tabA: Tab;
  let tabB: Tab;

  beforeEach(async () => {
    dbName = freshDbName();
    tabA = await openTab(dbName);
    tabB = await openTab(dbName);
  });

  test('cross-tab idempotent appends produce exactly one event with one shared eventId per key', async () => {
    // 10 idempotency keys; each tab tries to append a distinct envelope
    // for every key. Half the keys are SHARED across tabs (these test
    // cross-tab idempotency); half are tab-distinct (sanity).
    const sharedKeys = ['idem-shared-0', 'idem-shared-1', 'idem-shared-2', 'idem-shared-3', 'idem-shared-4'];
    const tabAOnly = ['idem-a-0', 'idem-a-1', 'idem-a-2', 'idem-a-3', 'idem-a-4'];
    const tabBOnly = ['idem-b-0', 'idem-b-1', 'idem-b-2', 'idem-b-3', 'idem-b-4'];

    const aOps: Promise<string>[] = [];
    const bOps: Promise<string>[] = [];
    for (const k of sharedKeys) {
      aOps.push(tabA.events.append(makeEvent({ tab: 'A', idempotencyKey: k })));
      bOps.push(tabB.events.append(makeEvent({ tab: 'B', idempotencyKey: k })));
    }
    for (const k of tabAOnly) {
      aOps.push(tabA.events.append(makeEvent({ tab: 'A', idempotencyKey: k })));
    }
    for (const k of tabBOnly) {
      bOps.push(tabB.events.append(makeEvent({ tab: 'B', idempotencyKey: k })));
    }

    const [aResults, bResults] = await Promise.all([
      Promise.all(aOps),
      Promise.all(bOps),
    ]);

    // Tenant has 5 (shared) + 5 (a-only) + 5 (b-only) = 15 distinct keys,
    // hence exactly 15 events.
    const stored = await tabA.events.readEvents('tenant-mt');
    expect(stored.length).toBe(15);

    // Every shared key resolves to exactly one event in the store, and both
    // tabs' append() calls returned that event's id.
    for (let i = 0; i < sharedKeys.length; i++) {
      const aId = aResults[i]!;
      const bId = bResults[i]!;
      expect(aId).toBe(bId);
      const matchingStored = stored.filter((e) => e.idempotencyKey === sharedKeys[i]);
      expect(matchingStored.length).toBe(1);
      expect(matchingStored[0]!.eventId).toBe(aId);
    }
  });

  test('cross-tab cache writes + invalidations leave a consistent state (no torn rows)', async () => {
    // Pre-populate via tab A. 12 entries: 4 'red', 4 'blue', 4 'green'.
    const setOps: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      setOps.push(
        tabA.cache.set(`red-${i}`, i, { ttlSeconds: 0, tags: ['red'] }),
        tabA.cache.set(`blue-${i}`, i, { ttlSeconds: 0, tags: ['blue'] }),
        tabA.cache.set(`green-${i}`, i, { ttlSeconds: 0, tags: ['green'] }),
      );
    }
    await Promise.all(setOps);

    // Both tabs concurrently invalidate ['red', 'blue']. 'green' must
    // survive on every row. 'red' and 'blue' must be fully gone.
    const [aPurged, bPurged] = await Promise.all([
      tabA.cache.invalidateByTags(['red', 'blue']),
      tabB.cache.invalidateByTags(['red', 'blue']),
    ]);

    expect(aPurged + bPurged).toBe(8);
    // No row should be reported deleted by both tabs (no double-counting).
    expect(aPurged).toBeGreaterThanOrEqual(0);
    expect(bPurged).toBeGreaterThanOrEqual(0);

    // State check via a third inspection through tab A.
    for (let i = 0; i < 4; i++) {
      expect(await tabA.cache.get(`red-${i}`)).toBeNull();
      expect(await tabA.cache.get(`blue-${i}`)).toBeNull();
      expect(await tabA.cache.get(`green-${i}`)).toBe(i);
      // Tab B sees the same.
      expect(await tabB.cache.get(`red-${i}`)).toBeNull();
      expect(await tabB.cache.get(`blue-${i}`)).toBeNull();
      expect(await tabB.cache.get(`green-${i}`)).toBe(i);
    }
  });

  test('mixed workload: 10 cross-tab appends with shared idempotency keys + 5 cross-tab cache invalidations', async () => {
    // The integration scenario: each tab does the work it would naturally
    // do — a stream of appends and a stream of cache invalidations — and
    // we verify the database survives unscathed.

    // Seed 8 cache rows with tag 'workload'. Both tabs will race to
    // invalidate them.
    const seedOps: Promise<void>[] = [];
    for (let i = 0; i < 8; i++) {
      seedOps.push(
        tabA.cache.set(`w-${i}`, i, { ttlSeconds: 0, tags: ['workload'] }),
      );
    }
    await Promise.all(seedOps);

    // Half the idempotency keys are shared across tabs.
    const sharedIdems = ['mw-shared-0', 'mw-shared-1', 'mw-shared-2', 'mw-shared-3', 'mw-shared-4'];

    const aWork: Promise<unknown>[] = [];
    const bWork: Promise<unknown>[] = [];

    for (const k of sharedIdems) {
      aWork.push(tabA.events.append(makeEvent({ tab: 'A', idempotencyKey: k })));
      bWork.push(tabB.events.append(makeEvent({ tab: 'B', idempotencyKey: k })));
    }
    for (let i = 0; i < 5; i++) {
      aWork.push(tabA.events.append(
        makeEvent({ tab: 'A', idempotencyKey: `mw-a-${i}` }),
      ));
      bWork.push(tabB.events.append(
        makeEvent({ tab: 'B', idempotencyKey: `mw-b-${i}` }),
      ));
    }
    for (let i = 0; i < 5; i++) {
      aWork.push(tabA.cache.invalidateByTags(['workload']));
      bWork.push(tabB.cache.invalidateByTags(['workload']));
    }

    await Promise.all([Promise.all(aWork), Promise.all(bWork)]);

    // 5 shared + 5 a-only + 5 b-only = 15 distinct events in the tenant.
    const stored = await tabA.events.readEvents('tenant-mt');
    expect(stored.length).toBe(15);
    for (const k of sharedIdems) {
      const matching = stored.filter((e) => e.idempotencyKey === k);
      expect(matching.length).toBe(1);
    }

    // All 8 'workload' cache rows must be gone, regardless of which tab's
    // invalidation deleted which.
    for (let i = 0; i < 8; i++) {
      expect(await tabA.cache.get(`w-${i}`)).toBeNull();
      expect(await tabB.cache.get(`w-${i}`)).toBeNull();
    }
  });
});
