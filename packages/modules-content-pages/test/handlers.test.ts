/**
 * ContentPages handler unit tests.
 *
 * Exercises create/update/delete + the render-tree projection rebuild
 * against in-memory implementations of EventStore, ProjectionStore,
 * and RenderTreeStore.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  EventStore,
  ProjectionStore,
  RenderTreeStore,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  handlePageCreate,
  handlePageUpdate,
  handlePageDelete,
  dispatchContentPagesEvent,
  defaultRenderTree,
  buildRenderTree,
  getPage,
  getRenderTree,
  readPageList,
  ContentPagesError,
  contentPagesErrorCodes,
  pageDocumentKey,
  renderTreeKey,
  pageListKey,
  type PageDocument,
  type PageSummary,
  type ContentPagesQueryDeps,
} from '../src/index.ts';

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];

  async append(envelope: EventEnvelope): Promise<string> {
    this.events.push({ ...envelope });
    return envelope.eventId;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }

  async readEvents(_tenantId: string): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class InMemoryProjectionStore implements ProjectionStore {
  data = new Map<string, unknown>();

  async get(key: string): Promise<unknown | null> {
    return this.data.has(key) ? this.data.get(key) ?? null : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
}

class InMemoryRenderTreeStore implements RenderTreeStore {
  data = new Map<string, unknown>();
  private k(tenantId: string, pageId: string): string {
    return `${tenantId}::${pageId}`;
  }

  async write(tenantId: string, pageId: string, tree: unknown): Promise<void> {
    this.data.set(this.k(tenantId, pageId), tree);
  }
  async read(tenantId: string, pageId: string): Promise<unknown | null> {
    return this.data.get(this.k(tenantId, pageId)) ?? null;
  }
  async delete(tenantId: string, pageId: string): Promise<void> {
    this.data.delete(this.k(tenantId, pageId));
  }
}

interface Fixture {
  events: InMemoryEventStore;
  projections: InMemoryProjectionStore;
  renderTrees: InMemoryRenderTreeStore;
  cache: { invalidateByTags(): Promise<number> };
  queryDeps: ContentPagesQueryDeps;
  dispatch(envelope: EventEnvelope): Promise<void>;
}

function newFixture(tenantId = 't1', principalId = 'u1'): Fixture {
  const events = new InMemoryEventStore();
  const projections = new InMemoryProjectionStore();
  const renderTrees = new InMemoryRenderTreeStore();
  const cache = { invalidateByTags: async () => 0 };
  const queryDeps: ContentPagesQueryDeps = {
    tenantId,
    principalId,
    correlationId: 'corr',
    projections,
    renderTreeStore: renderTrees,
  };
  return {
    events,
    projections,
    renderTrees,
    cache,
    queryDeps,
    dispatch: (envelope) =>
      dispatchContentPagesEvent(envelope, {
        projections,
        renderTreeStore: renderTrees,
        cache: cache as never,
      }),
  };
}

describe('handlePageCreate', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = newFixture();
  });

  it('emits a PageCreated event with cache-invalidation tags', async () => {
    const { envelope, document } = await handlePageCreate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'welcome',
        title: 'Welcome',
        slug: 'welcome',
      },
      fx.events,
    );
    expect(envelope.eventType).toBe('ContentPages.PageCreated');
    expect(envelope.cacheInvalidationTags).toEqual(['Tenant:t1', 'Page:welcome']);
    expect(document.pageId).toBe('welcome');
    expect(document.status).toBe('draft');
    expect(fx.events.events).toHaveLength(1);
  });

  it('writes the document, page list, and render tree via the dispatcher', async () => {
    const { envelope } = await handlePageCreate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'about',
        title: 'About Us',
        slug: 'about',
      },
      fx.events,
    );
    await fx.dispatch(envelope);

    const doc = await getPage(fx.queryDeps, 'about');
    expect(doc?.title).toBe('About Us');

    const list = await readPageList('t1', fx.projections);
    expect(list.map((p: PageSummary) => p.pageId)).toEqual(['about']);

    const tree = await getRenderTree(fx.queryDeps, 'about');
    expect(tree).toEqual(defaultRenderTree('About Us', 'about'));

    // Render tree is also durable (write-through).
    expect(await fx.renderTrees.read('t1', 'about')).toEqual(tree);
  });

  it('produces deterministic render-tree bytes from the same input', async () => {
    const a = buildRenderTree({
      pageId: 'p',
      tenantId: 't1',
      title: 'Hello',
      slug: 'hello',
      status: 'draft',
      createdAt: 'now',
      updatedAt: 'now',
    });
    const b = buildRenderTree({
      pageId: 'p',
      tenantId: 't1',
      title: 'Hello',
      slug: 'hello',
      status: 'draft',
      createdAt: 'later',
      updatedAt: 'later',
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('handlePageUpdate', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = newFixture();
    const { envelope } = await handlePageCreate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'home',
        title: 'Home',
        slug: 'home',
      },
      fx.events,
    );
    await fx.dispatch(envelope);
  });

  it('throws PAGE_NOT_FOUND for a missing page', async () => {
    await expect(
      handlePageUpdate(
        {
          tenantId: 't1',
          correlationId: 'c',
          principalId: 'u1',
          pageId: 'never',
          title: 'X',
        },
        fx.events,
        fx.projections,
      ),
    ).rejects.toThrow(ContentPagesError);
  });

  it('updates the title + render tree on dispatch', async () => {
    const { envelope } = await handlePageUpdate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'home',
        title: 'Welcome Home',
      },
      fx.events,
      fx.projections,
    );
    expect(envelope.eventType).toBe('ContentPages.PageUpdated');
    await fx.dispatch(envelope);

    const doc = await getPage(fx.queryDeps, 'home');
    expect(doc?.title).toBe('Welcome Home');
    // Render tree reflects the new title.
    const tree = await getRenderTree(fx.queryDeps, 'home');
    expect(tree).toEqual(defaultRenderTree('Welcome Home', 'home'));
  });

  it('preserves createdAt while bumping updatedAt', async () => {
    const before = (await getPage(fx.queryDeps, 'home')) as PageDocument;
    // Wait a tick so the timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    const { envelope } = await handlePageUpdate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'home',
        slug: 'home-2',
      },
      fx.events,
      fx.projections,
    );
    await fx.dispatch(envelope);
    const after = (await getPage(fx.queryDeps, 'home')) as PageDocument;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.slug).toBe('home-2');
  });
});

describe('handlePageDelete', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = newFixture();
    const { envelope } = await handlePageCreate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'gone',
        title: 'Gone',
        slug: 'gone',
      },
      fx.events,
    );
    await fx.dispatch(envelope);
  });

  it('emits a PageDeleted event and clears all projections', async () => {
    const { envelope } = await handlePageDelete(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'gone',
      },
      fx.events,
    );
    expect(envelope.eventType).toBe('ContentPages.PageDeleted');
    await fx.dispatch(envelope);

    expect(await getPage(fx.queryDeps, 'gone')).toBeNull();
    expect(await getRenderTree(fx.queryDeps, 'gone')).toBeNull();
    const list = await readPageList('t1', fx.projections);
    expect(list).toEqual([]);
    // Durable store cleaned up too.
    expect(await fx.renderTrees.read('t1', 'gone')).toBeNull();
  });
});

describe('dispatchContentPagesEvent', () => {
  it('ignores non-content-pages events', async () => {
    const fx = newFixture();
    const ev: EventEnvelope = {
      eventId: 'e1',
      eventType: 'StructuredCatalog.SeedPackageApplied',
      schemaId: 'catalog.seed_package_applied.v1',
      schemaVersion: 1,
      occurredAt: '2026-04-29T00:00:00Z',
      tenantId: 't1',
      correlationId: 'c',
      idempotencyKey: 'k',
      payload: {},
    };
    await fx.dispatch(ev);
    // Nothing landed in the projection store.
    expect(fx.projections.data.size).toBe(0);
  });
});

describe('render-tree fallback', () => {
  it('falls back to the durable store and repopulates the fast path', async () => {
    const fx = newFixture();
    const { envelope } = await handlePageCreate(
      {
        tenantId: 't1',
        correlationId: 'c',
        principalId: 'u1',
        pageId: 'persist',
        title: 'Persist',
        slug: 'persist',
      },
      fx.events,
    );
    await fx.dispatch(envelope);

    // Simulate an in-memory cache clear (parity with persistence_test.rs).
    fx.projections.data.delete(renderTreeKey('t1', 'persist'));

    const tree = await getRenderTree(fx.queryDeps, 'persist');
    expect(tree).toEqual(defaultRenderTree('Persist', 'persist'));

    // Fast path repopulated.
    expect(fx.projections.data.has(renderTreeKey('t1', 'persist'))).toBe(true);
  });
});

describe('id helpers', () => {
  it('produces tenant-scoped projection keys', () => {
    expect(pageDocumentKey('t1', 'p')).toBe('PageDocument:t1:p');
    expect(renderTreeKey('t1', 'p')).toBe('RenderTree:t1:p');
    expect(pageListKey('t1')).toBe('PageList:t1');
  });
});

void contentPagesErrorCodes;
