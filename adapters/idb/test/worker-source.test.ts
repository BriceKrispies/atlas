import 'fake-indexeddb/auto';
import { describe, test, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import { IdbEventStore } from '@atlas/adapter-idb';
import { IdbWorkerSource } from '../src/worker-source.ts';
import { freshDb } from './_setup.ts';

let envCounter = 0;
function makeEvent(tenantId: string, suffix: string): EventEnvelope {
  envCounter++;
  const eventId = `evt-ws-${envCounter.toString(36)}-${suffix}`;
  return {
    eventId,
    eventType: 'Test.WorkerSource',
    schemaId: 'test.worker-source.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    correlationId: `corr-${eventId}`,
    idempotencyKey: `idem-${eventId}`,
    causationId: null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: null,
    payload: { suffix },
  };
}

/**
 * Race a promise against a timeout. Returns the resolved value or rejects
 * with a timeout error. Used so polling-based tests can't hang forever.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function nextEvent(
  iter: AsyncIterator<EventEnvelope>,
  ms: number,
  label: string,
): Promise<IteratorResult<EventEnvelope>> {
  return withTimeout(iter.next(), ms, label);
}

describe('IdbWorkerSource', () => {
  test('subscribe receives a manually-inserted event via polling fallback', async () => {
    const db = await freshDb();
    const events = new IdbEventStore(db);
    const source = new IdbWorkerSource(db, 'test-module');

    const sub = source.subscribe('tenant-ws', 0n);
    const iter = sub.events()[Symbol.asyncIterator]();

    // Append AFTER subscribe so we exercise the wake/poll path, not the
    // initial drain. BroadcastChannel isn't fired by IdbEventStore today
    // (see TODO in worker-source.ts) — the 250ms poll fallback should
    // still surface the event well within 1s.
    const appended = await events.append(makeEvent('tenant-ws', 'a'));

    const got = await nextEvent(iter, 1500, 'first event');
    expect(got.done).toBe(false);
    expect(got.value?.eventId).toBe(appended.eventId);
    expect(got.value?.seq).toBe(appended.seq);

    await sub.close();
    db.close();
  });

  test('ack persists cursor; reopened subscription past cursor yields no duplicates', async () => {
    const db = await freshDb();
    const eventStore = new IdbEventStore(db);
    const source = new IdbWorkerSource(db, 'test-module');

    const first = await eventStore.append(makeEvent('tenant-ws', 'first'));

    const sub1 = source.subscribe('tenant-ws', 0n);
    const iter1 = sub1.events()[Symbol.asyncIterator]();
    const got1 = await nextEvent(iter1, 1500, 'first delivery');
    expect(got1.value?.eventId).toBe(first.eventId);
    await sub1.ack(first.seq);
    await sub1.close();

    // Cursor should now hold first.seq. Verify durability directly.
    const cursor = await db.get('worker_cursors', `tenant-ws test-module`);
    expect(cursor).toBeDefined();
    expect(cursor?.lastSeq).toBe(Number(first.seq));

    // New subscription resuming from the persisted cursor should NOT
    // re-deliver `first`. Append a second event and confirm only that one
    // arrives.
    const second = await eventStore.append(makeEvent('tenant-ws', 'second'));
    const sub2 = source.subscribe('tenant-ws', BigInt(cursor!.lastSeq));
    const iter2 = sub2.events()[Symbol.asyncIterator]();
    const got2 = await nextEvent(iter2, 1500, 'second delivery');
    expect(got2.value?.eventId).toBe(second.eventId);

    await sub2.close();
    db.close();
  });

  test('close resolves a pending iterator immediately', async () => {
    const db = await freshDb();
    const source = new IdbWorkerSource(db, 'test-module');

    const sub = source.subscribe('tenant-ws-empty', 0n);
    const iter = sub.events()[Symbol.asyncIterator]();
    const pending = iter.next();

    // Give the initial drain a tick to settle (no events => waiter set).
    await new Promise((r) => setTimeout(r, 20));

    await sub.close();
    const result = await withTimeout(pending, 500, 'close-terminated iterator');
    expect(result.done).toBe(true);
    db.close();
  });
});
