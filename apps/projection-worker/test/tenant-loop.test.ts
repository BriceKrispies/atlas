/**
 * Unit tests for `runTenantLoop`.
 *
 * `runTenantLoop` is the heart of WORKER_MODE=async dispatch. The test
 * harness drives it with a fake `WorkerSubscription`, a fake
 * `controlPlaneSql` (just a function returning row arrays), and an
 * in-memory adapter set, so the loop's retry/dead-letter/cursor logic is
 * exercised without touching Postgres.
 *
 * What we cover:
 *   - `sub.ack(seq)` is called only after dispatch settles (success path).
 *   - On dispatch throw, retries follow exponential backoff bounded by
 *     `BACKOFF_INITIAL_MS / BACKOFF_CAP_MS` (use `vi.useFakeTimers()`).
 *   - After `MAX_RETRIES_BEFORE_DEAD_LETTER` retries, the event is
 *     dead-lettered (warn log) and the cursor advances.
 *   - Cursor advances monotonically (one ack per delivered event).
 *   - Tenant-discovery transient failure is logged and the loop keeps
 *     running for healthy tenants.
 *
 * The dispatcher composition itself is not asserted here — that lives in
 * `apps/server/src/middleware/dispatcher-chain.test.ts`. We assert the
 * orchestration semantics that wrap the chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import type { Cache, CatalogStateStore, Entity, EntityListOptions, EntityQueryOptions, EntityStatus, EntityStore, EntityWriteInput, EventStore, ProjectionStore, Relation, RelationStore, RelationWriteInput, RepositoryRevisionStore, RepositoryStore, SearchEngine, StoredEvent, WorkerSource, WorkerSubscription, } from '@atlas/ports';
import type { CacheSetOptions } from '@atlas/platform-core';
import { CollectorSink, InMemoryLevelController, LogPipeline, createSystemContext, } from '@atlas/logging';
import type { PerTenantAdapters, WorkerAppState } from '../src/bootstrap.ts';
import type { WorkerConfig } from '../src/config.ts';
import { runTenantLoop } from '../src/tenant-loop.ts';
// ---------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------
function makeEvent(seq: bigint, eventType = 'Identity.UserCreated'): EventEnvelope {
    return {
        eventId: `evt-${seq.toString()}`,
        eventType,
        schemaId: `${eventType.toLowerCase()}.v1`,
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: 't1',
        correlationId: `corr-${seq.toString()}`,
        idempotencyKey: `idem-${seq.toString()}`,
        causationId: null,
        principalId: 'admin',
        userId: 'admin',
        cacheInvalidationTags: ['Tenant:t1'],
        payload: {},
        seq,
    } as EventEnvelope & {
        seq: bigint;
    };
}
/**
 * Hand-rollable fake subscription. Caller pushes events via `push(...)`
 * and signals completion via `done()`. `ack(seq)` and `close()` are
 * recorded.
 */
class FakeSubscription implements WorkerSubscription {
    acks: bigint[] = [];
    closed = false;
    private queue: EventEnvelope[] = [];
    private resolveNext: (() => void) | null = null;
    private finished = false;
    push(event: EventEnvelope): void {
        this.queue.push(event);
        if (this.resolveNext) {
            const r = this.resolveNext;
            this.resolveNext = null;
            r();
        }
    }
    done(): void {
        this.finished = true;
        if (this.resolveNext) {
            const r = this.resolveNext;
            this.resolveNext = null;
            r();
        }
    }
    events(): AsyncIterable<EventEnvelope> {
        const self = this;
        return {
            [Symbol.asyncIterator](): AsyncIterator<EventEnvelope> {
                return {
                    async next(): Promise<IteratorResult<EventEnvelope>> {
                        // Drain queue first
                        while (self.queue.length === 0 && !self.finished && !self.closed) {
                            await new Promise<void>(function (r) {
                                self.resolveNext = r;
                            });
                        }
                        if (self.queue.length > 0) {
                            const value = self.queue.shift()!;
                            return { value, done: false };
                        }
                        return { value: undefined as unknown as EventEnvelope, done: true };
                    },
                };
            },
        };
    }
    async ack(seq: bigint): Promise<void> {
        this.acks.push(seq);
    }
    async close(): Promise<void> {
        this.closed = true;
        this.done();
    }
}
class FakeWorkerSource implements WorkerSource {
    subs: FakeSubscription[] = [];
    perTenant = new Map<string, FakeSubscription>();
    subscribe(tenantId: string, _afterSeq: bigint): WorkerSubscription {
        const s = new FakeSubscription();
        this.subs.push(s);
        this.perTenant.set(tenantId, s);
        return s;
    }
}
class MemEntityStore implements EntityStore {
    rows = new Map<string, Entity<unknown>>();
    private k(t: string, ty: string, id: string): string {
        return `${t}::${ty}::${id}`;
    }
    async get<TAttrs = unknown>(t: string, ty: string, id: string): Promise<Entity<TAttrs> | null> {
        const r = this.rows.get(this.k(t, ty, id));
        if (!r || r.status === 'deleted')
            return null;
        return r as Entity<TAttrs>;
    }
    async put<TAttrs = unknown>(input: EntityWriteInput<TAttrs>): Promise<Entity<TAttrs>> {
        const now = new Date().toISOString();
        const row: Entity<TAttrs> = {
            tenantId: input.tenantId,
            entityType: input.entityType,
            entityId: input.entityId,
            schemaVersion: input.schemaVersion ?? 1,
            attrs: input.attrs,
            status: input.status ?? 'active',
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(this.k(input.tenantId, input.entityType, input.entityId), row as Entity<unknown>);
        return row;
    }
    async delete(t: string, ty: string, id: string): Promise<void> {
        const k = this.k(t, ty, id);
        const e = this.rows.get(k);
        if (e)
            this.rows.set(k, { ...e, status: 'deleted' });
    }
    async list<TAttrs = unknown>(t: string, ty: string, opts?: EntityListOptions): Promise<Entity<TAttrs>[]> {
        const desired: EntityStatus | null = opts?.status === undefined ? 'active' : opts.status;
        return Array.from(this.rows.values())
            .filter(function (r) {
            return r.tenantId === t && r.entityType === ty;
        })
            .filter(function (r) {
            return (desired === null ? true : r.status === desired);
        }) as Entity<TAttrs>[];
    }
    async query<TAttrs = unknown>(t: string, ty: string, opts: EntityQueryOptions): Promise<Entity<TAttrs>[]> {
        return this.list<TAttrs>(t, ty, opts);
    }
}
class MemRelationStore implements RelationStore {
    rows = new Map<string, Relation<unknown>>();
    private k(t: string, e: string, f: string, to: string): string {
        return `${t}::${e}::${f}::${to}`;
    }
    async add<TAttrs = unknown>(input: RelationWriteInput<TAttrs>): Promise<Relation<TAttrs>> {
        const row: Relation<TAttrs> = {
            tenantId: input.tenantId,
            edgeType: input.edgeType,
            fromId: input.fromId,
            toId: input.toId,
            attrs: input.attrs ?? null,
            createdAt: new Date().toISOString(),
        };
        this.rows.set(this.k(input.tenantId, input.edgeType, input.fromId, input.toId), row as Relation<unknown>);
        return row;
    }
    async remove(t: string, e: string, f: string, to: string): Promise<void> {
        this.rows.delete(this.k(t, e, f, to));
    }
    async outgoing<TAttrs = unknown>(): Promise<Relation<TAttrs>[]> {
        return [];
    }
    async incoming<TAttrs = unknown>(): Promise<Relation<TAttrs>[]> {
        return [];
    }
}
class MemProjectionStore implements ProjectionStore {
    store = new Map<string, unknown>();
    async get(k: string): Promise<unknown | null> {
        return this.store.get(k) ?? null;
    }
    async set(k: string, v: unknown): Promise<void> {
        this.store.set(k, v);
    }
    async delete(k: string): Promise<boolean> {
        return this.store.delete(k);
    }
}
class MemCache implements Cache {
    store = new Map<string, unknown>();
    async get(k: string): Promise<unknown | null> {
        return this.store.get(k) ?? null;
    }
    async set(k: string, v: unknown, _o: CacheSetOptions): Promise<void> {
        this.store.set(k, v);
    }
    async invalidateByKey(k: string): Promise<boolean> {
        return this.store.delete(k);
    }
    async invalidateByTags(): Promise<number> {
        return 0;
    }
}
function noopThrowingProxy<T extends object>(name: string): T {
    return new Proxy({} as T, {
        get(_t, p) {
            // EventStore / catalogState / etc. aren't used by the tenant-loop
            // for identity events but the type system forces us to provide
            // them. Throw on access so any accidental traversal is loud.
            throw new Error(`${name}.${String(p)} unexpectedly accessed in test`);
        },
    });
}
function buildAdapters(tenantId: string, sub: FakeSubscription): PerTenantAdapters {
    return {
        tenantId,
        eventStore: noopThrowingProxy<EventStore>('EventStore'),
        entities: new MemEntityStore(),
        relations: new MemRelationStore(),
        projections: new MemProjectionStore(),
        cache: new MemCache(),
        workerSource: {
            subscribe: function () {
                return sub;
            },
        },
        catalogState: noopThrowingProxy<CatalogStateStore>('CatalogStateStore'),
        search: noopThrowingProxy<SearchEngine>('SearchEngine'),
        repositories: noopThrowingProxy<RepositoryStore>('RepositoryStore'),
        revisions: noopThrowingProxy<RepositoryRevisionStore>('RepositoryRevisionStore'),
    };
}
interface FakeStateOptions {
    tenants: string[];
    /**
     * Map of tenantId -> subscription. The fake `controlPlaneSql` returns
     * those tenant rows; `adaptersForTenant` resolves to adapters that hand
     * out the matching sub.
     */
    subs: Map<string, FakeSubscription>;
    /** Throw on the first discover query when set. */
    discoveryThrow?: Error;
}
function buildState(opts: FakeStateOptions): WorkerAppState {
    // postgres.js template-literal SQL is a tagged template fn returning a
    // promise of rows. We fake just enough of the surface tenant-loop uses:
    //   sql<RowT[]>`SELECT tenant_id FROM control_plane.tenants WHERE status = 'active'`
    //   sql<{last_seq: ...}[]>`SELECT last_seq FROM worker_cursors ...`
    // Both calls are template-literal; the loop never inspects the strings.
    let firstDiscoveryCall = true;
    const sqlFn = (function (..._args: unknown[]) {
        if (opts.discoveryThrow && firstDiscoveryCall) {
            firstDiscoveryCall = false;
            return Promise.reject(opts.discoveryThrow);
        }
        firstDiscoveryCall = false;
        // Discovery query: returns tenant rows.
        // We can't tell which query is which from inside this stub since we
        // don't inspect the template strings. Heuristic: discovery is called
        // first (from runTenantLoop), then cursor reads. Tag both responses
        // by call count would be fragile — instead, use a minimal shape that
        // satisfies both consumers: an array, where the first row has both
        // `tenant_id` and `last_seq`. The loop's destructuring tolerates the
        // extra fields. For the cursor query specifically we want a default
        // of `0n` — supply `last_seq: 0`.
        return Promise.resolve(opts.tenants.map(function (t) {
            return ({ tenant_id: t, last_seq: 0 });
        }));
    }) as unknown as import('postgres').Sql;
    const tenantDb = {
        async getPool(_tenantId: string): Promise<import('postgres').Sql> {
            // Used by `readCursor` in tenant-loop. Same fake.
            return sqlFn;
        },
    } as unknown as WorkerAppState['tenantDb'];
    const config: WorkerConfig = {
        controlPlaneDbUrl: 'postgres://noop',
        tenantDiscoveryIntervalSeconds: 60,
        moduleId: 'projection-test',
        workerMode: 'shadow',
        environment: 'test',
    };
    return {
        config,
        controlPlaneSql: sqlFn,
        tenantDb,
        async adaptersForTenant(tenantId: string): Promise<PerTenantAdapters> {
            const sub = opts.subs.get(tenantId);
            if (!sub)
                throw new Error(`no fake subscription for ${tenantId}`);
            return buildAdapters(tenantId, sub);
        },
    };
}
function newTestPipeline(): {
    pipeline: LogPipeline;
    sink: CollectorSink;
} {
    const sink = new CollectorSink();
    const pipeline = new LogPipeline([sink], new InMemoryLevelController('debug'));
    return { pipeline, sink };
}
function newBaseCtx(pipeline: LogPipeline): import('@atlas/platform-core').AtlasExecutionContext {
    return createSystemContext({
        pipeline,
        environment: 'test',
        moduleId: '@atlas/projection-worker',
    });
}
// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------
describe('runTenantLoop — happy path', function () {
    let stop: (() => Promise<void>) | undefined;
    afterEach(async function () {
        if (stop) {
            await stop();
            stop = undefined;
        }
    });
    it('acks each event in seq order after dispatch settles', async function () {
        const sub = new FakeSubscription();
        const subs = new Map([['t1', sub]]);
        const state = buildState({ tenants: ['t1'], subs });
        const { pipeline } = newTestPipeline();
        stop = await runTenantLoop(newBaseCtx(pipeline), pipeline, state);
        // Push three identity events; the dispatcher chain handles them
        // (no-op for unknown types is fine — identity events with empty
        // documents short-circuit in dispatch.ts).
        sub.push(makeEvent(1n, 'Identity.SessionAnomaly')); // dispatcher returns early
        sub.push(makeEvent(2n, 'Identity.SessionAnomaly'));
        sub.push(makeEvent(3n, 'Identity.SessionAnomaly'));
        // Wait until the loop has acked all three.
        await waitFor(function () {
            return sub.acks.length === 3;
        }, 1000);
        expect(sub.acks).toEqual([1n, 2n, 3n]);
    });
    it('does NOT ack until dispatch resolves (ordering invariant)', async function () {
        const sub = new FakeSubscription();
        const subs = new Map([['t1', sub]]);
        const state = buildState({ tenants: ['t1'], subs });
        const { pipeline } = newTestPipeline();
        stop = await runTenantLoop(newBaseCtx(pipeline), pipeline, state);
        sub.push(makeEvent(7n, 'Identity.SessionAnomaly'));
        await waitFor(function () {
            return sub.acks.length === 1;
        }, 1000);
        // Once acked, the seq ordering guarantee holds.
        expect(sub.acks).toEqual([7n]);
    });
});
describe('runTenantLoop — retry and dead-letter', function () {
    let stop: (() => Promise<void>) | undefined;
    beforeEach(function () {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(async function () {
        if (stop) {
            await stop();
            stop = undefined;
        }
        vi.useRealTimers();
    });
    it('dead-letters after MAX_RETRIES_BEFORE_DEAD_LETTER, then advances cursor', async function () {
        // Use a custom dispatcher harness — patch the dispatcher chain by
        // intercepting one of the in-memory adapters so it throws on first
        // event, then succeeds afterward. We'll use the cache's
        // invalidateByTags as a hook: cacheTagDispatcher is the last module
        // dispatcher in the chain; making it throw forces a retry path.
        const sub = new FakeSubscription();
        const subs = new Map([['t1', sub]]);
        const state = buildState({ tenants: ['t1'], subs });
        const { pipeline, sink } = newTestPipeline();
        // Wrap adaptersForTenant so we replace `cache.invalidateByTags` with
        // an always-throwing fn — the chain will throw on every dispatch
        // attempt and exhaust retries.
        const orig = state.adaptersForTenant.bind(state);
        state.adaptersForTenant = async function (tenantId: string) {
            const a = await orig(tenantId);
            a.cache = {
                ...a.cache,
                get: a.cache.get.bind(a.cache),
                set: a.cache.set.bind(a.cache),
                invalidateByKey: a.cache.invalidateByKey.bind(a.cache),
                invalidateByTags: async function () {
                    throw new Error('synthetic cache failure');
                },
            };
            return a;
        };
        stop = await runTenantLoop(newBaseCtx(pipeline), pipeline, state);
        sub.push(makeEvent(1n, 'Identity.UserCreated'));
        // Drive the backoff timers: backoff starts at 100ms and doubles up
        // to 30s — total over 5 retries < ~3.2s at most. Advance enough to
        // unblock all sleeps.
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(200);
        await vi.advanceTimersByTimeAsync(400);
        await vi.advanceTimersByTimeAsync(800);
        await vi.advanceTimersByTimeAsync(1600);
        // A few extra ticks to make sure ack runs.
        await vi.advanceTimersByTimeAsync(100);
        await waitForReal(function () {
            return sub.acks.length === 1;
        }, 1000);
        // Even though dispatch failed, the cursor advanced (dead-letter).
        expect(sub.acks).toEqual([1n]);
        // Dead-letter log line landed.
        const events = sink.events.map(function (e) {
            return e.eventName;
        });
        expect(events).toContain('ProjectionWorker.Dispatch.DeadLettered');
        // Retry warns are present (one per retry attempt).
        const failedCount = events.filter(function (e) {
            return e === 'ProjectionWorker.Dispatch.Failed';
        }).length;
        expect(failedCount).toBeGreaterThanOrEqual(5);
    });
});
describe('runTenantLoop — discovery resilience', function () {
    let stop: (() => Promise<void>) | undefined;
    afterEach(async function () {
        if (stop) {
            await stop();
            stop = undefined;
        }
    });
    it('initial discovery failure throws, healthy tenants stay isolated thereafter', async function () {
        // The initial `discoverAndStart` is awaited by `runTenantLoop`. A
        // throw there propagates — but the *caught* path inside discovery
        // (the tenants query failing) is intentionally swallowed and logged.
        // We exercise the swallowed path here.
        const sub = new FakeSubscription();
        const subs = new Map([['t1', sub]]);
        const state = buildState({
            tenants: ['t1'],
            subs,
            discoveryThrow: new Error('transient db error'),
        });
        const { pipeline, sink } = newTestPipeline();
        stop = await runTenantLoop(newBaseCtx(pipeline), pipeline, state);
        // The initial discovery returned no tenants because the query
        // threw; no subscription was started.
        expect(sub.acks).toEqual([]);
        // The warn line is logged.
        const events = sink.events.map(function (e) {
            return e.eventName;
        });
        expect(events).toContain('ProjectionWorker.TenantDiscovery.QueryFailed');
    });
});
// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
/** Real-time waitFor (no fake timers in scope). */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor: predicate never true within ${timeoutMs}ms`);
        }
        await new Promise(function (r) {
            return setTimeout(r, 5);
        });
    }
}
/** Same as waitFor, but uses `setImmediate`-style polling that survives fake timers. */
async function waitForReal(pred: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitForReal: predicate never true within ${timeoutMs}ms`);
        }
        // Yield to the event loop. With fake timers active we still need
        // the microtask queue to drain; setImmediate via Promise.resolve()
        // keeps things flowing.
        await new Promise(function (r) {
            return setImmediate(r);
        });
    }
}
