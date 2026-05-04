/**
 * ContentPages handler unit tests.
 *
 * Exercises create/update/delete + the render-tree dispatch chain
 * against in-memory implementations of EventStore, EntityStore, and
 * RelationStore.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStatus,
  EntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
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
  listPages,
  ContentPagesError,
  contentPagesErrorCodes,
  getPageEntity,
  getRenderTreeEntity,
  findRenderTreeIdFor,
  renderTreeEntityIdFor,
  type PageDocument,
  type ContentPagesQueryDeps,
} from '../src/index.ts';

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = new Map<string, bigint>();

  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    const current = this.nextSeq.get(envelope.tenantId) ?? 0n;
    const seq = current + 1n;
    this.nextSeq.set(envelope.tenantId, seq);
    const stored: StoredEvent = { ...envelope, seq };
    this.events.push(stored);
    return stored;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<EventEnvelope | null> {
    return (
      this.events.find(
        (e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async readEvents(_tenantId: string): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

/**
 * In-memory `EntityStore` mirroring the Postgres adapter shape: rows are
 * keyed by (tenantId, entityType, entityId); `delete` is soft (marks
 * status='deleted' rather than removing the row).
 */
class InMemoryEntityStore implements EntityStore {
  rows = new Map<string, Entity<unknown>>();

  private k(tenantId: string, entityType: string, entityId: string): string {
    return `${tenantId}::${entityType}::${entityId}`;
  }

  async get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null> {
    const row = this.rows.get(this.k(tenantId, entityType, entityId));
    if (!row) return null;
    if (row.status === 'deleted') return null;
    return row as Entity<TAttrs>;
  }

  async put<TAttrs = unknown>(
    input: EntityWriteInput<TAttrs>,
  ): Promise<Entity<TAttrs>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<TAttrs> = {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      schemaVersion: input.schemaVersion ?? 1,
      attrs: input.attrs,
      status: input.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, row as Entity<unknown>);
    return row;
  }

  async delete(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const key = this.k(tenantId, entityType, entityId);
    const existing = this.rows.get(key);
    if (!existing) return;
    this.rows.set(key, {
      ...existing,
      status: 'deleted',
      updatedAt: new Date().toISOString(),
    });
  }

  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]> {
    const desiredStatus: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    const rows = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.entityType === entityType,
    );
    const filtered = rows
      .filter((r) => (desiredStatus === null ? true : r.status === desiredStatus))
      .sort((a, b) => a.entityId.localeCompare(b.entityId));
    const afterIdx = opts?.after
      ? filtered.findIndex((r) => r.entityId === opts.after)
      : -1;
    const sliced = afterIdx >= 0 ? filtered.slice(afterIdx + 1) : filtered;
    const limited = opts?.limit !== undefined ? sliced.slice(0, opts.limit) : sliced;
    return limited as Entity<TAttrs>[];
  }

  async query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]> {
    const base = await this.list<TAttrs>(tenantId, entityType, opts);
    if (!opts.attrsEqual) return base;
    const predicates = Object.entries(opts.attrsEqual);
    return base.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return predicates.every(([k, v]) => attrs?.[k] === v);
    });
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();

  private k(
    tenantId: string,
    edgeType: string,
    fromId: string,
    toId: string,
  ): string {
    return `${tenantId}::${edgeType}::${fromId}::${toId}`;
  }

  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const existing = this.rows.get(key);
    const row: Relation<TAttrs> = {
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.rows.set(key, row as Relation<unknown>);
    return row;
  }

  async remove(
    tenantId: string,
    edgeType: string,
    fromId: string,
    toId: string,
  ): Promise<void> {
    this.rows.delete(this.k(tenantId, edgeType, fromId, toId));
  }

  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) =>
        r.tenantId === tenantId &&
        r.edgeType === edgeType &&
        r.fromId === fromId,
    ) as Relation<TAttrs>[];
  }

  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) =>
        r.tenantId === tenantId &&
        r.edgeType === edgeType &&
        r.toId === toId,
    ) as Relation<TAttrs>[];
  }
}

interface Fixture {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  cache: { invalidateByTags(): Promise<number> };
  queryDeps: ContentPagesQueryDeps;
  tenantId: string;
  dispatch(envelope: EventEnvelope): Promise<void>;
}

function newFixture(tenantId = 't1', principalId = 'u1'): Fixture {
  const events = new InMemoryEventStore();
  const entities = new InMemoryEntityStore();
  const relations = new InMemoryRelationStore();
  const cache = { invalidateByTags: async () => 0 };
  const queryDeps: ContentPagesQueryDeps = {
    tenantId,
    principalId,
    correlationId: 'corr',
    entities,
    relations,
  };
  return {
    events,
    entities,
    relations,
    cache,
    queryDeps,
    tenantId,
    dispatch: (envelope) =>
      dispatchContentPagesEvent(envelope, {
        entities,
        relations,
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

  it('writes the Page entity, render-tree entity, and relation via the dispatcher', async () => {
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

    const summaries = await listPages(fx.queryDeps);
    expect(summaries.map((p) => p.pageId)).toEqual(['about']);

    const tree = await getRenderTree(fx.queryDeps, 'about');
    expect(tree).toEqual(defaultRenderTree('About Us', 'about'));

    const pageEntity = await getPageEntity(fx.entities, 't1', 'about');
    expect(pageEntity?.title).toBe('About Us');
    expect(pageEntity?.pageId).toBe('about');

    const treeEntity = await getRenderTreeEntity(fx.entities, 't1', 'about');
    expect(treeEntity?.nodes).toEqual(defaultRenderTree('About Us', 'about').nodes);

    const relId = await findRenderTreeIdFor(fx.relations, 't1', 'about');
    expect(relId).toBe(renderTreeEntityIdFor('about'));
  });

  it('produces deterministic render-tree bytes from the same input', async () => {
    const a = await buildRenderTree({
      pageId: 'p',
      tenantId: 't1',
      title: 'Hello',
      slug: 'hello',
      status: 'draft',
      createdAt: 'now',
      updatedAt: 'now',
    });
    const b = await buildRenderTree({
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
        fx.entities,
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
      fx.entities,
    );
    expect(envelope.eventType).toBe('ContentPages.PageUpdated');
    await fx.dispatch(envelope);

    const doc = await getPage(fx.queryDeps, 'home');
    expect(doc?.title).toBe('Welcome Home');

    const tree = await getRenderTree(fx.queryDeps, 'home');
    expect(tree).toEqual(defaultRenderTree('Welcome Home', 'home'));

    const pageEntity = await getPageEntity(fx.entities, 't1', 'home');
    expect(pageEntity?.title).toBe('Welcome Home');

    const treeEntity = await getRenderTreeEntity(fx.entities, 't1', 'home');
    expect(treeEntity?.nodes).toEqual(
      defaultRenderTree('Welcome Home', 'home').nodes,
    );

    const relId = await findRenderTreeIdFor(fx.relations, 't1', 'home');
    expect(relId).toBe(renderTreeEntityIdFor('home'));
  });

  it('preserves createdAt while bumping updatedAt', async () => {
    const before = (await getPage(fx.queryDeps, 'home')) as PageDocument;
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
      fx.entities,
    );
    await fx.dispatch(envelope);
    const after = (await getPage(fx.queryDeps, 'home')) as PageDocument;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.slug).toBe('home-2');

    const pageEntity = await getPageEntity(fx.entities, 't1', 'home');
    expect(pageEntity?.createdAt).toBe(before.createdAt);
    expect(pageEntity?.slug).toBe('home-2');

    const relId = await findRenderTreeIdFor(fx.relations, 't1', 'home');
    expect(relId).toBe(renderTreeEntityIdFor('home'));
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

  it('emits a PageDeleted event and removes entity + relation', async () => {
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
    expect(await listPages(fx.queryDeps)).toEqual([]);

    expect(await getPageEntity(fx.entities, 't1', 'gone')).toBeNull();
    expect(await getRenderTreeEntity(fx.entities, 't1', 'gone')).toBeNull();
    expect(await findRenderTreeIdFor(fx.relations, 't1', 'gone')).toBeNull();
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
    expect(fx.entities.rows.size).toBe(0);
    expect(fx.relations.rows.size).toBe(0);
  });
});

void contentPagesErrorCodes;
