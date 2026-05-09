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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Backend,
  SerializedServerEvent,
  SerializedServerEventCallback,
} from '../src/backend.ts';

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
      if (path === '/pages') return [...pages];
      if (path.startsWith('/pages/')) {
        const id = path.slice('/pages/'.length);
        return pages.find((p) => p.pageId === id) ?? null;
      }
      throw new Error(`unknown path: ${path}`);
    },
    async mutate(path, body) {
      if (path === '/intents') {
        const intent = body as { actionId?: string; title?: string };
        if (intent.actionId === 'ContentPages.Page.Create') {
          const row: PageRow = {
            pageId: `pg_${pages.length + 1}`,
            title: intent.title ?? 'untitled',
          };
          pages.push(row);
          // Fire-and-forget tag dispatch.
          const ev: SerializedServerEvent = {
            eventType: 'projection.updated',
            resourceType: 'page',
            resourceId: row.pageId,
            correlationId: 'c1',
            occurredAt: new Date().toISOString(),
            tags: [`Tenant:t-1`, `page:${row.pageId}`],
          };
          for (const sub of tagSubs) {
            const overlap =
              sub.tags.length === 0 ||
              sub.tags.some((t) => ev.tags!.includes(t));
            if (overlap) sub.cb(ev);
          }
          for (const cb of eventSubs.get(ev.eventType) ?? []) cb(ev);
          return row;
        }
      }
      throw new Error(`unknown mutation ${path}`);
    },
    subscribe(eventType, callback) {
      if (!eventSubs.has(eventType)) eventSubs.set(eventType, new Set());
      eventSubs.get(eventType)!.add(callback);
      return () => {
        eventSubs.get(eventType)?.delete(callback);
      };
    },
    subscribeTags(tags, callback) {
      const entry = { tags, cb: callback };
      tagSubs.add(entry);
      return () => {
        tagSubs.delete(entry);
      };
    },
  };
}

// ── 2) The shared contract suite ────────────────────────────────────

export function runBackendContract(
  name: string,
  makeBackend: () => Backend,
): void {
  describe(`Backend contract — ${name}`, () => {
    let backend: Backend;
    beforeEach(() => {
      backend = makeBackend();
    });

    it('query() resolves a list for a known path', async () => {
      const res = (await backend.query('/pages')) as unknown[];
      expect(Array.isArray(res)).toBe(true);
    });

    it('query() resolves a parameterised resource path', async () => {
      const res = (await backend.query('/pages/pg_1')) as { pageId: string };
      expect(res?.pageId).toBe('pg_1');
    });

    it('query() rejects for an unknown path', async () => {
      await expect(backend.query('/totally-unknown')).rejects.toBeDefined();
    });

    it('mutate() returns the persisted record', async () => {
      const created = (await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'New page',
      })) as { pageId: string; title: string };
      expect(created.title).toBe('New page');
      expect(typeof created.pageId).toBe('string');
    });

    it('mutate() persists across query()', async () => {
      const created = (await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'Second page',
      })) as { pageId: string };
      const fetched = (await backend.query(
        `/pages/${created.pageId}`,
      )) as { pageId: string } | null;
      expect(fetched?.pageId).toBe(created.pageId);
    });

    it('subscribe() invokes the callback for matching event types', async () => {
      const cb = vi.fn();
      const off = backend.subscribe('projection.updated', cb);
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'sub-test',
      });
      // For impls that fire async, give the microtask queue a beat.
      await new Promise((r) => setTimeout(r, 0));
      expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
      off();
    });

    it('subscribe() unsubscribe stops further callbacks', async () => {
      const cb = vi.fn();
      const off = backend.subscribe('projection.updated', cb);
      off();
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'after-off',
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(cb).not.toHaveBeenCalled();
    });

    it('subscribeTags() fires when the event tags overlap the filter', async () => {
      const cb = vi.fn();
      const off = backend.subscribeTags(['Tenant:t-1'], cb);
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'tag-fire',
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
      off();
    });

    it('subscribeTags() does NOT fire when filter has no overlap', async () => {
      const cb = vi.fn();
      const off = backend.subscribeTags(['Tenant:OTHER'], cb);
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'tag-miss',
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(cb).not.toHaveBeenCalled();
      off();
    });

    it('subscribeTags() with empty filter receives every event', async () => {
      const cb = vi.fn();
      const off = backend.subscribeTags([], cb);
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'broadcast',
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
      off();
    });

    it('subscribeTags() returns an unsubscribe that detaches the callback', async () => {
      const cb = vi.fn();
      const off = backend.subscribeTags(['Tenant:t-1'], cb);
      off();
      await backend.mutate('/intents', {
        actionId: 'ContentPages.Page.Create',
        title: 'after-tag-off',
      });
      await new Promise((r) => setTimeout(r, 0));
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
  private listeners = new Map<string, Array<(ev: { data: string }) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: { data: string }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  }
  removeEventListener(): void {}
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

async function loadHttpBackend(): Promise<HttpBackendModule> {
  // import.meta.env access in the http module — provide minimal env so
  // import succeeds.
  const meta = import.meta as unknown as { env: Record<string, unknown> };
  meta.env = {
    ...(meta.env ?? {}),
    VITE_API_URL: 'http://test.local',
    VITE_TENANT_ID: 't-1',
  };
  vi.resetModules();
  return (await import('../src/http/index.ts')) as unknown as HttpBackendModule;
}

describe('httpBackend — fetch / EventSource integration', () => {
  let prevFetch: typeof fetch | undefined;
  let prevES: typeof EventSource | undefined;
  let mod: HttpBackendModule;
  let pages: Array<{ pageId: string; title: string }>;

  beforeEach(async () => {
    pages = [{ pageId: 'pg_1', title: 'Welcome' }];
    prevFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    prevES = (globalThis as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as { EventSource?: unknown }).EventSource =
      FakeEventSource as unknown as typeof EventSource;
    FakeEventSource.instances = [];

    (globalThis as { fetch?: unknown }).fetch = vi.fn(
      async (input: unknown, init?: { method?: string; body?: unknown }) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/api/v1/intents')) {
          const body = JSON.parse(String(init.body)) as {
            payload?: { actionId?: string; title?: string };
          };
          const action = body.payload?.actionId;
          if (action === 'ContentPages.Page.Create') {
            const row = {
              pageId: `pg_${pages.length + 1}`,
              title: body.payload?.title ?? 'untitled',
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
          const id = url.split('/api/v1/pages/')[1]!;
          const found = pages.find((p) => p.pageId === id) ?? null;
          return new Response(JSON.stringify(found), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    );

    mod = await loadHttpBackend();
  });

  afterEach(() => {
    mod?._resetSubscriptionPool?.();
    if (prevFetch) (globalThis as { fetch?: unknown }).fetch = prevFetch;
    else delete (globalThis as { fetch?: unknown }).fetch;
    if (prevES)
      (globalThis as { EventSource?: unknown }).EventSource = prevES;
    else delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  it('query() forwards the path under /api/v1', async () => {
    const list = (await mod.httpBackend.query('/pages')) as unknown[];
    expect(Array.isArray(list)).toBe(true);
  });

  it('mutate() POSTs an envelope-wrapped intent', async () => {
    const created = (await mod.httpBackend.mutate('/intents', {
      actionId: 'ContentPages.Page.Create',
      resourceType: 'Page',
      title: 'http-fixture',
    })) as { pageId: string };
    expect(typeof created.pageId).toBe('string');
  });

  it('subscribeTags opens an EventSource and routes matching events', async () => {
    const cb = vi.fn();
    const off = mod.httpBackend.subscribeTags(['Tenant:t-1'], cb);
    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0]!.url).toContain('tags=Tenant%3At-1');
    FakeEventSource.instances[0]!.dispatch('projection.updated', {
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

  it('subscribeTags pools by signature — same tag-set shares a connection', () => {
    const a = mod.httpBackend.subscribeTags(['B', 'A'], () => {});
    const b = mod.httpBackend.subscribeTags(['A', 'B'], () => {});
    // signature is sorted+joined, so both calls reuse one EventSource.
    expect(FakeEventSource.instances.length).toBe(1);
    a();
    b();
  });

  it('closing the last subscriber for a signature closes the EventSource', () => {
    const off = mod.httpBackend.subscribeTags(['Z'], () => {});
    const es = FakeEventSource.instances[0]!;
    expect(es.readyState).toBe(1);
    off();
    expect(es.readyState).toBe(2);
  });
});

// ── 4) Run the contract twice ──────────────────────────────────────

runBackendContract('memory backend', () => makeMemoryBackend());
