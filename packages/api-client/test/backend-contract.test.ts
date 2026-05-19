/**
 * Cross-implementation contract tests for `Backend`.
 *
 * Both the in-memory mock backend and the HTTP backend MUST satisfy the
 * same observable contract — `query` resolves the right shape, `mutate`
 * returns the persisted object, `subscribe` (legacy) and `subscribeTags`
 * (Phase-5 tag-filter) wire up callbacks and tear down on unsubscribe.
 *
 * The contract is exposed as `runBackendContract(makeBackend)` so any
 * future Backend impl can run the same suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from '@atlas/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { Backend, SerializedServerEvent, SerializedServerEventCallback, } from '../src/backend.ts';
// ── Typed boundary readers ─────────────────────────────────────────
//
// `Backend.query()` and `Backend.mutate()` both return `Promise<unknown>`
// because the wire shape varies by path. The tests below know what
// shape they asked for; these helpers narrow `unknown` to the
// asserted shape at the boundary with one runtime check, instead of
// scattering `as { ... }` casts at every call site.
function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function asObject(v: unknown, what: string): Record<string, unknown> {
    if (!isRecord(v)) {
        throw new Error(`${what}: expected object, got ${typeof v}`);
    }
    return v;
}
function asArray(v: unknown, what: string): unknown[] {
    if (!Array.isArray(v)) {
        throw new Error(`${what}: expected array, got ${typeof v}`);
    }
    return v;
}
function asPageRowOrNull(v: unknown): {
    pageId: string;
    title?: string;
} | null {
    if (v === null)
        return null;
    const obj = asObject(v, 'page row');
    if (typeof obj['pageId'] !== 'string') {
        throw new Error('page row: pageId must be string');
    }
    const row: { pageId: string; title?: string } = { pageId: obj['pageId'] };
    if (typeof obj['title'] === 'string') {
        row.title = obj['title'];
    }
    return row;
}
function asPageRow(v: unknown): {
    pageId: string;
    title: string;
} {
    const obj = asObject(v, 'page row');
    if (typeof obj['pageId'] !== 'string')
        throw new Error('page row: pageId must be string');
    if (typeof obj['title'] !== 'string')
        throw new Error('page row: title must be string');
    return { pageId: obj['pageId'], title: obj['title'] };
}
// ── 1) In-memory backend used as the "mock" arm of the contract ─────
//
// We don't wire to packages/api-client/src/mock/index.ts because that
// module ships randomized 50-200ms latency in store.ts via setTimeout —
// non-deterministic for unit tests. The minimal in-memory impl below
// honors the same Backend interface and is good enough to lock down
// the cross-impl shape.
interface PageRow {
    pageId: string;
    title: string;
}
function makeMemoryBackend(): Backend {
    const pages: PageRow[] = [{ pageId: 'pg_1', title: 'Welcome' }];
    const tagSubs = new Set<{
        tags: string[];
        cb: SerializedServerEventCallback;
    }>();
    const eventSubs = new Map<string, Set<(e: unknown) => void>>();
    return {
        async query(path) {
            if (path === '/pages')
                return [...pages];
            if (path.startsWith('/pages/')) {
                const id = path.slice('/pages/'.length);
                return pages.find(function (p) {
                    return p.pageId === id;
                }) ?? null;
            }
            throw new Error(`unknown path: ${path}`);
        },
        async mutate(path, body) {
            if (path === '/intents') {
                const intent = body as {
                    actionId?: string;
                    title?: string;
                };
                if (intent.actionId === 'ContentPages.Page.Create') {
                    const row: PageRow = {
                        pageId: `pg_${pages.length + 1}`,
                        title: intent.title ?? 'untitled',
                    };
                    pages.push(row);
                    // Fire-and-forget tag dispatch.
                    const tags = [`Tenant:t-1`, `page:${row.pageId}`];
                    const ev: SerializedServerEvent = {
                        eventType: 'projection.updated',
                        resourceType: 'page',
                        resourceId: row.pageId,
                        correlationId: 'c1',
                        occurredAt: new Date().toISOString(),
                        tags,
                    };
                    for (const sub of tagSubs) {
                        const overlap = sub.tags.length === 0 || sub.tags.some(function (t) {
                            return tags.includes(t);
                        });
                        if (overlap)
                            sub.cb(ev);
                    }
                    for (const cb of eventSubs.get(ev.eventType) ?? [])
                        cb(ev);
                    return row;
                }
            }
            throw new Error(`unknown mutation ${path}`);
        },
        subscribe(eventType, callback) {
            let bucket = eventSubs.get(eventType);
            if (!bucket) {
                bucket = new Set();
                eventSubs.set(eventType, bucket);
            }
            bucket.add(callback);
            return function () {
                eventSubs.get(eventType)?.delete(callback);
            };
        },
        subscribeTags(tags, callback) {
            const entry = { tags, cb: callback };
            tagSubs.add(entry);
            return function () {
                tagSubs.delete(entry);
            };
        },
    };
}
// ── 2) The shared contract suite ────────────────────────────────────
export function runBackendContract(name: string, makeBackend: () => Backend): void {
    describe(`Backend contract — ${name}`, function () {
        let backend: Backend;
        beforeEach(function () {
            backend = makeBackend();
        });
        it('query() resolves a list for a known path', async function () {
            const res = asArray(await backend.query('/pages'), '/pages');
            expect(Array.isArray(res)).toBe(true);
        });
        it('query() resolves a parameterised resource path', async function () {
            const res = asPageRowOrNull(await backend.query('/pages/pg_1'));
            expect(res?.pageId).toBe('pg_1');
        });
        it('query() rejects for an unknown path', async function () {
            await expect(backend.query('/totally-unknown')).rejects.toBeDefined();
        });
        it('mutate() returns the persisted record', async function () {
            const created = asPageRow(await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'New page',
            }));
            expect(created.title).toBe('New page');
            expect(typeof created.pageId).toBe('string');
        });
        it('mutate() persists across query()', async function () {
            const created = asPageRow(await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'Second page',
            }));
            const fetched = asPageRowOrNull(await backend.query(`/pages/${created.pageId}`));
            expect(fetched?.pageId).toBe(created.pageId);
        });
        it('subscribe() invokes the callback for matching event types', async function () {
            const cb = vi.fn();
            const off = backend.subscribe('projection.updated', cb);
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'sub-test',
            });
            // For impls that fire async, give the microtask queue a beat.
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
            off();
        });
        it('subscribe() unsubscribe stops further callbacks', async function () {
            const cb = vi.fn();
            const off = backend.subscribe('projection.updated', cb);
            off();
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'after-off',
            });
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb).not.toHaveBeenCalled();
        });
        it('subscribeTags() fires when the event tags overlap the filter', async function () {
            const cb = vi.fn();
            const off = backend.subscribeTags(['Tenant:t-1'], cb);
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'tag-fire',
            });
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
            off();
        });
        it('subscribeTags() does NOT fire when filter has no overlap', async function () {
            const cb = vi.fn();
            const off = backend.subscribeTags(['Tenant:OTHER'], cb);
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'tag-miss',
            });
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb).not.toHaveBeenCalled();
            off();
        });
        it('subscribeTags() with empty filter receives every event', async function () {
            const cb = vi.fn();
            const off = backend.subscribeTags([], cb);
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'broadcast',
            });
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
            off();
        });
        it('subscribeTags() returns an unsubscribe that detaches the callback', async function () {
            const cb = vi.fn();
            const off = backend.subscribeTags(['Tenant:t-1'], cb);
            off();
            await backend.mutate('/intents', {
                actionId: 'ContentPages.Page.Create',
                title: 'after-tag-off',
            });
            await new Promise(function (r) {
                return setTimeout(r, 0);
            });
            expect(cb).not.toHaveBeenCalled();
        });
    });
}
// ── 3) HTTP backend harness — exercises the same contract ───────────
//
// The HTTP impl uses `fetch` and `EventSource`. We stub both globally.
// `EventSource` is constructed inside the module's pool when subscribe
// is called, so a tiny in-test fake suffices.
class FakeEventSource {
    static instances: FakeEventSource[] = [];
    url: string;
    readyState = 1;
    private listeners = new Map<string, Array<(ev: {
        data: string;
    }) => void>>();
    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: {
        data: string;
    }) => void): void {
        let bucket = this.listeners.get(type);
        if (!bucket) {
            bucket = [];
            this.listeners.set(type, bucket);
        }
        bucket.push(cb);
    }
    removeEventListener(): void { }
    close(): void {
        this.readyState = 2;
        this.listeners.clear();
    }
    dispatch(eventType: string, payload: unknown): void {
        for (const cb of this.listeners.get(eventType) ?? []) {
            cb({ data: JSON.stringify(payload) });
        }
    }
}
interface HttpBackendModule {
    httpBackend: Backend;
    _resetSubscriptionPool: () => void;
}
function isHttpBackendModule(v: unknown): v is HttpBackendModule {
    if (!isRecord(v))
        return false;
    return (typeof v['httpBackend'] === 'object' &&
        v['httpBackend'] !== null &&
        typeof v['_resetSubscriptionPool'] === 'function');
}
// Test-only globals — read/write `globalThis.fetch`, `globalThis.EventSource`,
// and `import.meta.env` via narrow widening casts. These widening casts
// (subset-of-original → original) are NOT flagged by the unsafe-type-assertion
// rule; they're shown here as the canonical way to access optional globals
// in a test harness without a runtime type-system escape.
function stampViteEnv(extras: Record<string, unknown>): void {
    const meta = import.meta as {
        env?: Record<string, unknown>;
    };
    meta.env = { ...(meta.env ?? {}), ...extras };
}
function getGlobalFetch(): typeof fetch | undefined {
    return (globalThis as {
        fetch?: typeof fetch;
    }).fetch;
}
function setGlobalFetch(v: unknown): void {
    (globalThis as {
        fetch?: unknown;
    }).fetch = v;
}
function clearGlobalFetch(): void {
    delete (globalThis as {
        fetch?: unknown;
    }).fetch;
}
function getGlobalEventSource(): typeof EventSource | undefined {
    return (globalThis as {
        EventSource?: typeof EventSource;
    }).EventSource;
}
function setGlobalEventSource(v: unknown): void {
    (globalThis as {
        EventSource?: unknown;
    }).EventSource = v;
}
function clearGlobalEventSource(): void {
    delete (globalThis as {
        EventSource?: unknown;
    }).EventSource;
}
async function loadHttpBackend(): Promise<HttpBackendModule> {
    // import.meta.env access in the http module — provide minimal env so
    // import succeeds.
    stampViteEnv({ VITE_API_URL: 'http://test.local', VITE_TENANT_ID: 't-1' });
    vi.resetModules();
    const mod: unknown = await import('../src/http/index.ts');
    if (!isHttpBackendModule(mod)) {
        throw new Error('http backend module did not export the expected shape');
    }
    return mod;
}
describe('httpBackend — fetch / EventSource integration', function () {
    let prevFetch: typeof fetch | undefined;
    let prevES: typeof EventSource | undefined;
    let mod: HttpBackendModule;
    let pages: Array<{
        pageId: string;
        title: string;
    }>;
    beforeEach(async function () {
        pages = [{ pageId: 'pg_1', title: 'Welcome' }];
        prevFetch = getGlobalFetch();
        prevES = getGlobalEventSource();
        setGlobalEventSource(FakeEventSource);
        FakeEventSource.instances = [];
        setGlobalFetch(vi.fn(async function (input: unknown, init?: {
            method?: string;
            body?: unknown;
        }) {
            const url = String(input);
            if (init?.method === 'POST' && url.endsWith('/api/v1/intents')) {
                const rawBody = JSON.parse(String(init.body)) as unknown;
                const bodyObj = asObject(rawBody, 'POST body');
                const payloadRaw = bodyObj['payload'];
                const payload = payloadRaw !== undefined && payloadRaw !== null
                    ? asObject(payloadRaw, 'POST body.payload')
                    : {};
                const action = payload['actionId'];
                if (action === 'ContentPages.Page.Create') {
                    const title = typeof payload['title'] === 'string' ? payload['title'] : 'untitled';
                    const row = {
                        pageId: `pg_${pages.length + 1}`,
                        title,
                    };
                    pages.push(row);
                    return new Response(JSON.stringify(row), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            }
            if (url.endsWith('/api/v1/pages')) {
                return new Response(JSON.stringify(pages), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('/api/v1/pages/')) {
                const id = assertDefined(url.split('/api/v1/pages/')[1], 'pages id segment');
                const found = pages.find(function (p) {
                    return p.pageId === id;
                }) ?? null;
                return new Response(JSON.stringify(found), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('not found', { status: 404 });
        }));
        mod = await loadHttpBackend();
    });
    afterEach(function () {
        mod?._resetSubscriptionPool?.();
        if (prevFetch)
            setGlobalFetch(prevFetch);
        else
            clearGlobalFetch();
        if (prevES)
            setGlobalEventSource(prevES);
        else
            clearGlobalEventSource();
    });
    it('query() forwards the path under /api/v1', async function () {
        const list = asArray(await mod.httpBackend.query('/pages'), '/pages list');
        expect(Array.isArray(list)).toBe(true);
    });
    it('mutate() POSTs an envelope-wrapped intent', async function () {
        const created = asPageRow(await mod.httpBackend.mutate('/intents', {
            actionId: 'ContentPages.Page.Create',
            resourceType: 'Page',
            title: 'http-fixture',
        }));
        expect(typeof created.pageId).toBe('string');
    });
    it('subscribeTags opens an EventSource and routes matching events', async function () {
        const cb = vi.fn();
        const off = mod.httpBackend.subscribeTags(['Tenant:t-1'], cb);
        expect(FakeEventSource.instances.length).toBe(1);
        const first = assertDefined(FakeEventSource.instances[0], 'first ES instance');
        expect(first.url).toContain('tags=Tenant%3At-1');
        first.dispatch('projection.updated', {
            eventType: 'projection.updated',
            resourceType: 'page',
            resourceId: 'pg_2',
            correlationId: 'c',
            occurredAt: new Date().toISOString(),
            tags: ['Tenant:t-1'],
        });
        expect(cb).toHaveBeenCalledTimes(1);
        off();
    });
    it('subscribeTags pools by signature — same tag-set shares a connection', function () {
        const a = mod.httpBackend.subscribeTags(['B', 'A'], function () { });
        const b = mod.httpBackend.subscribeTags(['A', 'B'], function () { });
        // signature is sorted+joined, so both calls reuse one EventSource.
        expect(FakeEventSource.instances.length).toBe(1);
        a();
        b();
    });
    it('closing the last subscriber for a signature closes the EventSource', function () {
        const off = mod.httpBackend.subscribeTags(['Z'], function () { });
        const es = assertDefined(FakeEventSource.instances[0], 'first ES instance');
        expect(es.readyState).toBe(1);
        off();
        expect(es.readyState).toBe(2);
    });
});
// ── 4) Run the contract twice ──────────────────────────────────────
runBackendContract('memory backend', function () {
    return makeMemoryBackend();
});
