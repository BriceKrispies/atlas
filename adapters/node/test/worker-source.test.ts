/**
 * Smoke tests for `PostgresWorkerSource`. Mirrors the env-gating pattern in
 * `event-store.test.ts` — silently skipped when `TEST_TENANT_DB_URL` is not
 * set. Imports the implementation directly because the public re-export
 * (`adapters/node/src/index.ts`) hasn't been added yet.
 */
import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EventEnvelope } from '@atlas/platform-core';
import { PostgresEventStore } from '../src/index.ts';
import { PostgresWorkerSource } from '../src/worker-source.ts';
import { freshSql, HAS_DB } from './_setup.ts';
const TENANT = 'tenant_ws';
const MODULE = 'test-module';
function makeEnvelope(idemSuffix: string): EventEnvelope {
    const id = `evt-ws-${idemSuffix}-${Date.now().toString(36)}`;
    return {
        eventId: id,
        eventType: 'Test.WorkerSource',
        schemaId: 'test.worker.v1',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: TENANT,
        correlationId: `corr-${id}`,
        idempotencyKey: `idem-${id}`,
        causationId: null,
        principalId: 'user:test',
        userId: null,
        cacheInvalidationTags: null,
        payload: { hello: idemSuffix },
    };
}
/**
 * Pulls the next event from an async iterable with a timeout. Returns null
 * if the deadline passes — used to assert non-delivery.
 */
async function nextWithTimeout(iter: AsyncIterator<EventEnvelope>, ms: number): Promise<EventEnvelope | null> {
    // Create the timer outside the Promise executor so `timer` is always
    // initialised before clearTimeout runs — avoids the `timer!` non-null
    // assertion the older `let timer; new Promise(executor)` shape required.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>(function (resolve) {
        timer = setTimeout(function () { resolve(null); }, ms);
    });
    const result = await Promise.race([
        iter.next().then(function (r) {
            return (r.done ? null : r.value);
        }),
        timeout,
    ]);
    if (timer !== undefined)
        clearTimeout(timer);
    return result;
}
if (HAS_DB) {
    describe('PostgresWorkerSource', function () {
        it('subscribe + receive a freshly-appended event in events() within ~500ms', async function () {
            const sql = await freshSql();
            // Reset cursors so previous runs don't leak.
            await sql.unsafe('TRUNCATE TABLE worker_cursors');
            const store = new PostgresEventStore(sql);
            const source = new PostgresWorkerSource(sql, MODULE);
            const sub = source.subscribe(TENANT, 0n);
            const iter = sub.events()[Symbol.asyncIterator]();
            // Tiny delay to let LISTEN register before we append. The drain on
            // start should still pick it up if we lose the race, but giving it a
            // beat keeps the assertion focused on the LISTEN path.
            await new Promise(function (r) {
                return setTimeout(r, 50);
            });
            const env = makeEnvelope('a');
            await store.append(env);
            const received = assertDefined(await nextWithTimeout(iter, 1000), 'freshly-appended event must arrive within 1s');
            expect(received.eventId).toBe(env.eventId);
            expect(typeof received.seq).toBe('bigint');
            await sub.close();
        });
        it('ack persists across reconnect — second subscribe past cursor sees no duplicate', async function () {
            const sql = await freshSql();
            await sql.unsafe('TRUNCATE TABLE worker_cursors');
            const store = new PostgresEventStore(sql);
            const source = new PostgresWorkerSource(sql, MODULE);
            // Append before subscribing — the drain on start must pick it up.
            const env = makeEnvelope('b');
            const stored = await store.append(env);
            const sub1 = source.subscribe(TENANT, 0n);
            const iter1 = sub1.events()[Symbol.asyncIterator]();
            const r1 = assertDefined(await nextWithTimeout(iter1, 1000), 'pre-subscribed event must drain on start within 1s');
            expect(r1.eventId).toBe(env.eventId);
            await sub1.ack(stored.seq);
            await sub1.close();
            // Read the cursor as a worker would on restart.
            const rows = await sql<{
                last_seq: string | number | bigint;
            }[]> `
        SELECT last_seq FROM worker_cursors
        WHERE tenant_id = ${TENANT} AND module_id = ${MODULE}
      `;
            expect(rows.length).toBe(1);
            const cursorRow = assertDefined(rows[0], 'we asserted rows.length === 1 above');
            // BigInt() accepts string | number | bigint; the cast widens the
            // last_seq union for the call-site without `as never`.
            const cursor = BigInt(cursorRow.last_seq);
            expect(cursor).toBe(stored.seq);
            // Subscribe again from the cursor — no duplicate, but a NEW event
            // after this point should be delivered.
            const sub2 = source.subscribe(TENANT, cursor);
            const iter2 = sub2.events()[Symbol.asyncIterator]();
            // Within a short window we must NOT see the already-acked event.
            const dup = await nextWithTimeout(iter2, 250);
            expect(dup).toBeNull();
            // Now append a brand new event — it should arrive.
            await new Promise(function (r) {
                return setTimeout(r, 50);
            });
            const env2 = makeEnvelope('c');
            await store.append(env2);
            const r2 = assertDefined(await nextWithTimeout(iter2, 1000), 'a post-cursor event must arrive on the resumed subscription within 1s');
            expect(r2.eventId).toBe(env2.eventId);
            await sub2.close();
        });
        it('close resolves any pending events() iterator immediately', async function () {
            const sql = await freshSql();
            await sql.unsafe('TRUNCATE TABLE worker_cursors');
            const source = new PostgresWorkerSource(sql, MODULE);
            const sub = source.subscribe(TENANT, 0n);
            const iter = sub.events()[Symbol.asyncIterator]();
            // Start a next() that has nothing to consume yet — it should park.
            const pending = iter.next();
            // Give the LISTEN setup + initial drain a moment to complete with no
            // events present, leaving the iterator parked on the waker.
            await new Promise(function (r) {
                return setTimeout(r, 100);
            });
            // Closing should resolve the parked next() with done: true.
            const start = Date.now();
            await sub.close();
            const result = await pending;
            const elapsed = Date.now() - start;
            expect(result.done).toBe(true);
            // Generously bounded — the resolution should be near-instant
            // (signal() runs synchronously after we flip closed=true).
            expect(elapsed).toBeLessThan(500);
            // ack after close must reject.
            await expect(sub.ack(1n)).rejects.toThrow();
            // close is idempotent.
            await sub.close();
        });
    });
}
else {
    describe('PostgresWorkerSource (skipped)', function () {
        it.skip('TEST_TENANT_DB_URL not set — skipping Postgres worker source tests', function () {
            // intentionally empty
        });
    });
}
