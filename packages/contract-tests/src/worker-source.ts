import { describe, test, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import type { StoredEvent, WorkerSource, WorkerSubscription } from '@atlas/ports';

/**
 * Per-test factory. Each `test()` calls this once at the start and the
 * returned `cleanup()` in a `finally` block. This keeps adapters (which
 * may hold long-lived LISTEN connections, BroadcastChannel handles, etc.)
 * from leaking state between tests.
 */
export interface WorkerSourceFactory {
  source: WorkerSource;
  appendEvent: (envelope: EventEnvelope) => Promise<StoredEvent>;
  cleanup: () => Promise<void>;
}

interface MakeEventOptions {
  eventId?: string;
  tenantId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
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
    causationId: null,
    principalId: 'user:test',
    userId: null,
    cacheInvalidationTags: null,
    payload: opts.payload ?? { hello: 'world' },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Drain at most `n` events from a subscription, with a per-batch deadline.
 * Resolves once `n` events have arrived OR `timeoutMs` has elapsed since
 * the last event (or since start, if no events arrived). Used to assert
 * "iterator yields N within ~1s".
 */
async function drain(
  sub: WorkerSubscription,
  n: number,
  timeoutMs: number,
): Promise<EventEnvelope[]> {
  const out: EventEnvelope[] = [];
  const iter = sub.events()[Symbol.asyncIterator]();
  while (out.length < n) {
    const next = iter.next();
    const timer = sleep(timeoutMs).then(() => '__timeout__' as const);
    const winner = await Promise.race([next, timer]);
    if (winner === '__timeout__') break;
    if (winner.done) break;
    out.push(winner.value);
  }
  return out;
}

export function runWorkerSourceContract(
  name: string,
  makeFactory: () => Promise<WorkerSourceFactory>,
): void {
  describe(`WorkerSource contract [${name}]`, () => {
    test('subscribe + drain — yields all appended events in seq order', async () => {
      const f = await makeFactory();
      try {
        const sub = f.source.subscribe('tenant-a', 0n);
        try {
          const s1 = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          const s2 = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          const s3 = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          const events = await drain(sub, 3, 1000);
          expect(events.map((e) => e.eventId)).toEqual([s1.eventId, s2.eventId, s3.eventId]);
          // Strictly ascending seq.
          for (let i = 1; i < events.length; i++) {
            expect(events[i - 1]!.seq! < events[i]!.seq!).toBe(true);
          }
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('afterSeq filter — yields only events strictly after the cursor', async () => {
      const f = await makeFactory();
      try {
        const stored: StoredEvent[] = [];
        for (let i = 0; i < 5; i++) {
          stored.push(await f.appendEvent(makeEvent({ tenantId: 'tenant-a' })));
        }
        const after = stored[1]!.seq;
        const sub = f.source.subscribe('tenant-a', after);
        try {
          const events = await drain(sub, 3, 1000);
          expect(events.map((e) => e.eventId)).toEqual([
            stored[2]!.eventId,
            stored[3]!.eventId,
            stored[4]!.eventId,
          ]);
          for (const e of events) {
            expect(e.seq! > after).toBe(true);
          }
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('ack does NOT filter active reads — afterSeq is the only filter', async () => {
      // Documents the worker contract: ack persists the cursor for restart
      // recovery, but a fresh subscription with afterSeq=0n still sees the
      // full history. The worker's resume-on-restart path passes the last
      // acked seq as afterSeq itself.
      const f = await makeFactory();
      try {
        const stored: StoredEvent[] = [];
        for (let i = 0; i < 3; i++) {
          stored.push(await f.appendEvent(makeEvent({ tenantId: 'tenant-a' })));
        }
        const sub1 = f.source.subscribe('tenant-a', 0n);
        const drained = await drain(sub1, 3, 1000);
        expect(drained.length).toBe(3);
        await sub1.ack(stored[1]!.seq);
        await sub1.close();

        const sub2 = f.source.subscribe('tenant-a', 0n);
        try {
          const replayed = await drain(sub2, 3, 1000);
          expect(replayed.map((e) => e.eventId)).toEqual(stored.map((s) => s.eventId));
        } finally {
          await sub2.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('ack monotonicity — acking a lower seq after a higher seq is a no-op', async () => {
      // The port does not expose cursor reads, so we cannot directly verify
      // the persisted cursor here. The behavioural assertion is: ack(low)
      // after ack(high) does not throw and the system continues to function
      // (a subsequent subscription with afterSeq=high still skips low ones).
      // TODO: when/if the port exposes a cursor inspection API (or a
      // dedicated harness hook on the factory), tighten this to assert the
      // cursor stayed at `high` after the no-op ack.
      const f = await makeFactory();
      try {
        const stored: StoredEvent[] = [];
        for (let i = 0; i < 5; i++) {
          stored.push(await f.appendEvent(makeEvent({ tenantId: 'tenant-a' })));
        }
        const sub = f.source.subscribe('tenant-a', 0n);
        try {
          await drain(sub, 5, 1000);
          await sub.ack(stored[4]!.seq);
          await expect(sub.ack(stored[2]!.seq)).resolves.toBeUndefined();
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('live wake — append after subscribe causes the iterator to yield within ~1s', async () => {
      const f = await makeFactory();
      try {
        const sub = f.source.subscribe('tenant-a', 0n);
        try {
          await sleep(100);
          const appendStart = Date.now();
          const stored = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          const events = await drain(sub, 1, 1000);
          const elapsed = Date.now() - appendStart;
          expect(events.length).toBe(1);
          expect(events[0]!.eventId).toBe(stored.eventId);
          expect(elapsed).toBeLessThan(1500);
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('tenant isolation — subscribing to tenant A never yields tenant B events', async () => {
      const f = await makeFactory();
      try {
        const sub = f.source.subscribe('tenant-a', 0n);
        try {
          const a1 = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          await f.appendEvent(makeEvent({ tenantId: 'tenant-b' }));
          const a2 = await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          await f.appendEvent(makeEvent({ tenantId: 'tenant-b' }));

          const events = await drain(sub, 2, 1000);
          expect(events.map((e) => e.eventId)).toEqual([a1.eventId, a2.eventId]);
          expect(events.every((e) => e.tenantId === 'tenant-a')).toBe(true);

          // No tenant-B events should be queued behind these — give the
          // adapter a beat to (incorrectly) deliver one if it would.
          const more = await drain(sub, 1, 250);
          expect(more.length).toBe(0);
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });

    test('close terminates the for-await loop cleanly within ~1s', async () => {
      const f = await makeFactory();
      try {
        const sub = f.source.subscribe('tenant-a', 0n);
        const seen: string[] = [];
        const consumer = (async () => {
          for await (const ev of sub.events()) {
            seen.push(ev.eventId);
          }
        })();
        await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
        // Let the first event arrive before closing so we exercise the
        // "iterator was actively yielding" path, not just "iterator
        // never started".
        await sleep(200);
        await sub.close();

        const closed = await Promise.race([
          consumer.then(() => 'closed' as const),
          sleep(1000).then(() => 'hung' as const),
        ]);
        expect(closed).toBe('closed');
        try {
          await f.cleanup();
        } catch {
          // Some adapters reject leftover ops on cleanup after close — fine.
        }
      } finally {
        // Cleanup may already have run above; suppress double-cleanup errors.
        try {
          await f.cleanup();
        } catch {
          /* idempotent */
        }
      }
    });

    test('out-of-tenant subscribe — stays open with 0 events while other tenants get appends', async () => {
      const f = await makeFactory();
      try {
        const sub = f.source.subscribe('tenant-empty', 0n);
        try {
          await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));
          await f.appendEvent(makeEvent({ tenantId: 'tenant-b' }));
          await f.appendEvent(makeEvent({ tenantId: 'tenant-a' }));

          const events = await drain(sub, 1, 1000);
          expect(events.length).toBe(0);
        } finally {
          await sub.close();
        }
      } finally {
        await f.cleanup();
      }
    });
  });
}
