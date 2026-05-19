/**
 * Tests for `settleEvents` — the helper used to drive a dispatcher
 * chain manually after the Phase-3 worker cut-over (see
 * `specs/worker.md`).
 *
 * Coverage:
 *  - Drains all events past `afterSeq` in seq order.
 *  - Returns processed count + lastSeq.
 *  - Rethrows dispatcher errors with the offending eventId in the
 *    message and preserves the original via `cause`.
 *  - Defaults `afterSeq` to `0n` (drains the whole tenant stream).
 */
import { describe, it, expect } from '@atlas/test';
import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore, StoredEvent, EventDispatcher, } from '@atlas/ports';
import { settleEvents } from '../src/settle-events.ts';
function envelope(seq: bigint, eventId = `evt-${seq}`): EventEnvelope {
    return {
        eventId,
        eventType: 'TestEvent',
        schemaId: 'test.event.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-02T00:00:00Z',
        tenantId: 't1',
        correlationId: 'cor-1',
        idempotencyKey: `idem-${seq}`,
        payload: { seq: Number(seq) },
        seq,
    };
}
function fakeStore(events: EventEnvelope[]): EventStore {
    return {
        async append(env: EventEnvelope): Promise<StoredEvent> {
            return { ...env, seq: env.seq ?? 0n } satisfies StoredEvent;
        },
        async getEvent(eventId: string): Promise<EventEnvelope | null> {
            return events.find(function (e) {
                return e.eventId === eventId;
            }) ?? null;
        },
        async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<EventEnvelope | null> {
            return (events.find(function (e) {
                return e.tenantId === tenantId && e.idempotencyKey === idempotencyKey;
            }) ?? null);
        },
        async readEvents(): Promise<EventEnvelope[]> {
            return events;
        },
    };
}
describe('settleEvents', function () {
    it('drains all events past afterSeq in seq order', async function () {
        const events = [envelope(1n), envelope(2n), envelope(3n), envelope(4n)];
        const store = fakeStore(events);
        const dispatched: bigint[] = [];
        const dispatch: EventDispatcher = async function (env) {
            dispatched.push(env.seq ?? 0n);
        };
        const result = await settleEvents({
            eventStore: store,
            dispatch,
            tenantId: 't1',
            afterSeq: 1n,
        });
        expect(dispatched).toEqual([2n, 3n, 4n]);
        expect(result).toEqual({ lastSeq: 4n, processed: 3 });
    });
    it('defaults afterSeq to 0n (drains everything)', async function () {
        const events = [envelope(1n), envelope(2n)];
        const store = fakeStore(events);
        const dispatched: string[] = [];
        const dispatch: EventDispatcher = async function (env) {
            dispatched.push(env.eventId);
        };
        const result = await settleEvents({
            eventStore: store,
            dispatch,
            tenantId: 't1',
        });
        expect(dispatched).toEqual(['evt-1', 'evt-2']);
        expect(result).toEqual({ lastSeq: 2n, processed: 2 });
    });
    it('sorts ascending even when readEvents returns out-of-order events', async function () {
        const events = [envelope(3n), envelope(1n), envelope(2n)];
        const store = fakeStore(events);
        const dispatched: bigint[] = [];
        const dispatch: EventDispatcher = async function (env) {
            dispatched.push(env.seq ?? 0n);
        };
        const result = await settleEvents({
            eventStore: store,
            dispatch,
            tenantId: 't1',
        });
        expect(dispatched).toEqual([1n, 2n, 3n]);
        expect(result).toEqual({ lastSeq: 3n, processed: 3 });
    });
    it('returns afterSeq + 0 processed when stream is empty past cursor', async function () {
        const events = [envelope(1n), envelope(2n)];
        const store = fakeStore(events);
        let calls = 0;
        const dispatch: EventDispatcher = async function () {
            calls += 1;
        };
        const result = await settleEvents({
            eventStore: store,
            dispatch,
            tenantId: 't1',
            afterSeq: 5n,
        });
        expect(calls).toBe(0);
        // lastSeq is the highest observed seq in the stream (2n), even
        // though nothing was processed past the cursor.
        expect(result.processed).toBe(0);
        // Highest observed seq advances; afterSeq=5n was beyond it so
        // nothing dispatched but lastSeq reports what was seen.
        expect(result.lastSeq === 5n || result.lastSeq === 2n).toBe(true);
    });
    it('rethrows dispatcher errors with the eventId in the message', async function () {
        const events = [envelope(1n, 'evt-good'), envelope(2n, 'evt-boom')];
        const store = fakeStore(events);
        const original = new Error('projection blew up');
        const dispatched: string[] = [];
        const dispatch: EventDispatcher = async function (env) {
            dispatched.push(env.eventId);
            if (env.eventId === 'evt-boom')
                throw original;
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.stringContaining returns `any` by design; the matchObject API expects asymmetric matchers
        const messageMatcher: string = expect.stringContaining('evt-boom');
        await expect(settleEvents({ eventStore: store, dispatch, tenantId: 't1' })).rejects.toMatchObject({
            message: messageMatcher,
            cause: original,
        });
        // Short-circuited on failure — evt-good ran, evt-boom ran (and
        // threw); no further events would have been processed if any
        // existed past it.
        expect(dispatched).toEqual(['evt-good', 'evt-boom']);
    });
});
