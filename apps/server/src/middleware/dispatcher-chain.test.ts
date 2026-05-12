/**
 * Dispatcher-chain contract test (Layer 2, Identity Module Test Pass).
 *
 * Exercises identity events through the full production dispatcher
 * composition (catalog → content-pages → identity → repository →
 * cache-tag → policy-cache → server-events) and asserts on the
 * downstream effects no per-handler unit test reaches:
 *
 *   - cacheTagDispatcher purges the right tags per identity event.
 *   - policyCacheDispatcher invalidates the Cedar bundle cache for
 *     events that affect authz (UserCreated, MembershipRolesChanged,
 *     IdentityProviderActivated, ApiKeyCreated, ServicePrincipalScopesChanged,
 *     ImpersonationStarted, BreakGlassApproved).
 *   - serverEventDispatcher emits `cache.invalidated` SSE for every
 *     event with a non-empty `cacheInvalidationTags`.
 *   - Per-tenant isolation: tenant A events do not affect tenant B's
 *     cache state, do not invalidate tenant B's policy bundle, and do
 *     not surface as tenant-B-tagged SSE events.
 *
 * Architectural placement: this test lives in `apps/server/src/middleware/`
 * because it imports `serverEventDispatcher` (an `apps/server` event
 * adapter) and the cross-module dispatcher factories (catalog /
 * content-pages / identity / repository) — both forbidden inside
 * `/modules` (modules cannot import apps; cross-module imports go
 * through `src/public/` only). The plan's original location at
 * `modules/identity/test/contract/` would not have been able to
 * compile.
 *
 * The composition assembled here mirrors `state.ts` order; if the
 * composition diverges in production, this test should be updated in
 * lockstep. (No "shared composition factory" exists today; the
 * structural assertion is "compositions match" and is enforced by
 * code review for now.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  composeDispatchers,
  cacheTagDispatcher,
  type Cache,
  type CatalogStateStore,
  type ProjectionStore,
  type SearchEngine,
  type RepositoryStore,
  type RepositoryRevisionStore,
  type EventDispatcher,
  type EntityStore,
  type RelationStore,
  type Entity,
  type EntityListOptions,
  type EntityQueryOptions,
  type EntityStatus,
  type EntityWriteInput,
  type Relation,
  type RelationWriteInput,
} from '@atlas/ports';
import type { CacheSetOptions, EventEnvelope, ServerEvent } from '@atlas/platform-core';
import { catalogDispatcher } from '@atlas/catalog';
import { contentPagesDispatcher } from '@atlas/content-pages';
import { identityDispatcher } from '@atlas/identity';
import { repositoryDispatcher } from '@atlas/repository';
import {
  policyCacheDispatcher,
  type CedarBundleCache,
} from '@atlas/adapter-policy-cedar';
import { ServerEventBroadcast } from '../events/broadcast.ts';
import { serverEventDispatcher } from '../events/dispatcher.ts';

// ---------------------------------------------------------------------
// In-memory adapters — minimum needed for the chain to run identity events.
// ---------------------------------------------------------------------

class InMemoryCache implements Cache {
  store = new Map<string, { value: unknown; tags: ReadonlyArray<string> }>();
  invalidatedTagBatches: ReadonlyArray<string>[] = [];
  async get(key: string): Promise<unknown | null> {
    return this.store.get(key)?.value ?? null;
  }
  async set(key: string, value: unknown, opts: CacheSetOptions): Promise<void> {
    this.store.set(key, { value, tags: opts.tags });
  }
  async invalidateByKey(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  async invalidateByTags(tags: ReadonlyArray<string>): Promise<number> {
    this.invalidatedTagBatches.push(tags);
    let purged = 0;
    for (const [k, entry] of this.store.entries()) {
      if (entry.tags.some((t) => tags.includes(t))) {
        this.store.delete(k);
        purged += 1;
      }
    }
    return purged;
  }
}

class InMemoryEntityStore implements EntityStore {
  rows = new Map<string, Entity<unknown>>();
  private k(t: string, ty: string, id: string): string {
    return `${t}::${ty}::${id}`;
  }
  async get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null> {
    const row = this.rows.get(this.k(tenantId, entityType, entityId));
    if (!row || row.status === 'deleted') return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: in-memory EntityStore shim; row was stored as Entity<unknown> and the caller's TAttrs is contract-pinned by the entity type used at put-time. Mirrors PostgresEntityStore and modules/identity/test/lib/fixtures.ts.
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
  async delete(t: string, ty: string, id: string): Promise<void> {
    const key = this.k(t, ty, id);
    const e = this.rows.get(key);
    if (e) this.rows.set(key, { ...e, status: 'deleted' });
  }
  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]> {
    const desired: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    const filtered = Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.entityType === entityType)
      .filter((r) => (desired === null ? true : r.status === desired));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: in-memory EntityStore shim; rows are Entity<unknown>, caller's TAttrs is contract-pinned by the entity type used at put-time. Mirrors PostgresEntityStore.list.
    return filtered as Entity<TAttrs>[];
  }
  async query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]> {
    const base = await this.list<TAttrs>(tenantId, entityType, opts);
    if (!opts.attrsEqual) return base;
    const preds = Object.entries(opts.attrsEqual);
    return base.filter((r) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: entity.attrs is typed as the caller's TAttrs; accessed here as a Record for predicate-equality filtering. Mirrors PostgresEntityStore.query.
      const a = r.attrs as Record<string, unknown>;
      return preds.every(([k, v]) => a?.[k] === v);
    });
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<TAttrs> = {
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(key, row as Relation<unknown>);
    return row;
  }
  async remove(t: string, e: string, f: string, to: string): Promise<void> {
    this.rows.delete(this.k(t, e, f, to));
  }
  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    const out = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.fromId === fromId,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: in-memory RelationStore shim; rows are Relation<unknown>, caller's TAttrs is contract-pinned by the edge type used at add-time. Mirrors PostgresRelationStore.outgoing.
    return out as Relation<TAttrs>[];
  }
  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    const out = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.toId === toId,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: in-memory RelationStore shim; see RelationStore.outgoing.
    return out as Relation<TAttrs>[];
  }
}

// Recording test-double for the Cedar bundle cache.
class RecordingCedarCache implements CedarBundleCache {
  invalidatedTenants: string[] = [];
  invalidateAllCount = 0;
  invalidate(tenantId: string): void {
    this.invalidatedTenants.push(tenantId);
  }
  invalidateAll(): void {
    this.invalidateAllCount += 1;
  }
}

// Stubs for adapters the catalog / content-pages / repository
// dispatchers reference structurally but never call for identity
// events (their dispatcher entry-points return early on event-type
// mismatch). Throw-on-access guards: if a future change to a non-
// identity dispatcher accidentally reaches into its context for an
// identity event, the test fails loudly instead of silently.
function throwingProxy<T extends object>(name: string): T {
  // Proxy<T> only constrains T to `object`, and `Object.create(null)` returns
  // `any`. Going through a typed empty-object literal keeps the cast off the
  // hot path and routes the unsafety through a single, named boundary.
  const target: object = {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      throw new Error(
        `${name}.${String(prop)} accessed during identity-event dispatch — ` +
          `non-identity dispatcher should have returned early before reaching its context`,
      );
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: throw-on-access proxy stands in for a structural port type; every member access throws, so the type is descriptive only (used by composeDispatchers to type-check its inputs).
  return proxy as T;
}

const stubCatalogState = throwingProxy<CatalogStateStore>('CatalogStateStore');
const stubProjections = throwingProxy<ProjectionStore>('ProjectionStore');
const stubSearch = throwingProxy<SearchEngine>('SearchEngine');
const stubRepositories = throwingProxy<RepositoryStore>('RepositoryStore');
const stubRevisions = throwingProxy<RepositoryRevisionStore>(
  'RepositoryRevisionStore',
);

// ---------------------------------------------------------------------
// Composition factory — same shape as state.ts inlineDispatch.
// ---------------------------------------------------------------------

interface ChainHarness {
  dispatch: EventDispatcher;
  cache: InMemoryCache;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  cedarCache: RecordingCedarCache;
  broadcast: ServerEventBroadcast;
  /** Subscriber that records every server event for assertions. */
  serverEvents: ServerEvent[];
}

function buildChain(): ChainHarness {
  const cache = new InMemoryCache();
  const entities = new InMemoryEntityStore();
  const relations = new InMemoryRelationStore();
  const cedarCache = new RecordingCedarCache();
  const broadcast = new ServerEventBroadcast(1024);
  const serverEvents: ServerEvent[] = [];

  // Subscribe before dispatching so we capture events.
  const { events, unsubscribe: _unsub } = broadcast.subscribe();
  void (async () => {
    try {
      for await (const ev of events) {
        serverEvents.push(ev);
      }
    } catch {
      // Iterator closed — ignore.
    }
  })();

  const dispatch = composeDispatchers(
    catalogDispatcher({
      catalogState: stubCatalogState,
      projections: stubProjections,
      search: stubSearch,
      cache,
    }),
    contentPagesDispatcher({ entities, relations, cache }),
    identityDispatcher({ entities, relations, cache }),
    repositoryDispatcher({
      repositories: stubRepositories,
      revisions: stubRevisions,
      cache,
    }),
    cacheTagDispatcher(cache),
    policyCacheDispatcher(cedarCache),
    serverEventDispatcher(broadcast),
  );

  return { dispatch, cache, entities, relations, cedarCache, broadcast, serverEvents };
}

// Sleep one microtask tick so subscribed-events callbacks run before
// assertions. ServerEventBroadcast pushes synchronously into a queue
// but the subscriber's async iterator pulls on next tick.
async function settle(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

// Builders — minimal envelopes for identity events.
function envelope(
  eventType: string,
  tenantId: string,
  cacheInvalidationTags: string[],
  payload: unknown = {},
): EventEnvelope {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
    eventType,
    schemaId: `${eventType.toLowerCase()}.v1`,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    correlationId: `corr-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
    causationId: null,
    principalId: 'admin',
    userId: 'admin',
    cacheInvalidationTags,
    payload,
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('dispatcher chain — identity events flow through without error', () => {
  let h: ChainHarness;
  beforeEach(() => {
    h = buildChain();
  });

  const IDENTITY_EVENTS_WITH_TAGS: ReadonlyArray<{
    eventType: string;
    tags: string[];
  }> = [
    {
      eventType: 'Identity.UserCreated',
      tags: ['Tenant:t1', 'User:user-1'],
    },
    {
      eventType: 'Identity.MembershipCreated',
      tags: ['Tenant:t1', 'User:user-1', 'Membership:t1:user-1'],
    },
    {
      eventType: 'Identity.MembershipRolesChanged',
      tags: ['Tenant:t1', 'User:user-1', 'Membership:t1:user-1'],
    },
    {
      eventType: 'Identity.SessionIssued',
      tags: ['Tenant:t1', 'User:user-1', 'Session:sess-1'],
    },
    {
      eventType: 'Identity.SessionEnded',
      tags: ['Tenant:t1', 'User:user-1', 'Session:sess-1'],
    },
    {
      eventType: 'Identity.ApiKeyCreated',
      tags: ['Tenant:t1', 'ApiKey:apk-1'],
    },
    {
      eventType: 'Identity.ServicePrincipalCreated',
      tags: ['Tenant:t1', 'ServicePrincipal:sp-1'],
    },
    {
      eventType: 'Identity.IdentityProviderActivated',
      tags: ['Tenant:t1', 'IdentityProvider:idp-1'],
    },
    {
      eventType: 'Authorization.ImpersonationStarted',
      tags: ['Tenant:t1', 'User:user-1', 'Impersonation:imp-1'],
    },
    {
      eventType: 'Authorization.BreakGlassApproved',
      tags: ['Tenant:t1', 'Principal:user-1', 'BreakGlassGrant:bgg-1'],
    },
  ];

  it.each(IDENTITY_EVENTS_WITH_TAGS)(
    '$eventType propagates through the chain without throwing',
    async ({ eventType, tags }) => {
      await expect(
        h.dispatch(
          envelope(eventType, 't1', tags, { document: { tenantId: 't1' } }),
        ),
      ).resolves.toBeUndefined();
    },
  );
});

describe('cacheTagDispatcher — purges by exact tags', () => {
  it('Identity.SessionIssued purges the per-session cache key', async () => {
    const h = buildChain();
    // Pre-seed a cache entry tagged with the session.
    await h.cache.set(
      'render:t1:home',
      { greeting: 'hi' },
      { ttlSeconds: 0, tags: ['Tenant:t1', 'Session:sess-1'] },
    );
    expect(h.cache.store.has('render:t1:home')).toBe(true);

    await h.dispatch(
      envelope(
        'Identity.SessionIssued',
        't1',
        ['Tenant:t1', 'User:user-1', 'Session:sess-1'],
        { document: {} },
      ),
    );
    expect(h.cache.store.has('render:t1:home')).toBe(false);
    expect(h.cache.invalidatedTagBatches.at(-1)).toEqual([
      'Tenant:t1',
      'User:user-1',
      'Session:sess-1',
    ]);
  });

  it('events with empty cacheInvalidationTags do not call invalidateByTags', async () => {
    const h = buildChain();
    await h.dispatch(envelope('Identity.UserCreated', 't1', [], { document: {} }));
    expect(h.cache.invalidatedTagBatches).toEqual([]);
  });
});

describe('policyCacheDispatcher — invalidates Cedar bundle cache by tenant tag', () => {
  it('invalidates the bundle cache for the tenant in `Tenant:<id>` tag', async () => {
    const h = buildChain();
    await h.dispatch(
      envelope(
        'Identity.MembershipRolesChanged',
        't1',
        ['Tenant:t1', 'User:user-1', 'Membership:t1:user-1'],
        { document: {} },
      ),
    );
    expect(h.cedarCache.invalidatedTenants).toEqual(['t1']);
    expect(h.cedarCache.invalidateAllCount).toBe(0);
  });

  it.each([
    'Identity.UserCreated',
    'Identity.IdentityProviderActivated',
    'Identity.ApiKeyCreated',
    'Identity.ServicePrincipalScopesChanged',
    'Authorization.ImpersonationStarted',
    'Authorization.BreakGlassApproved',
  ])('invalidates Cedar cache for tenant on %s', async (eventType) => {
    const h = buildChain();
    await h.dispatch(
      envelope(eventType, 't1', ['Tenant:t1', 'Principal:user-1'], {
        document: { tenantId: 't1' },
      }),
    );
    expect(h.cedarCache.invalidatedTenants).toContain('t1');
  });

  it('does NOT invalidate Cedar cache when the envelope has no Tenant: tag', async () => {
    const h = buildChain();
    await h.dispatch(envelope('Identity.UserCreated', 't1', [], { document: {} }));
    expect(h.cedarCache.invalidatedTenants).toEqual([]);
  });
});

describe('serverEventDispatcher — emits cache.invalidated SSE for tagged identity events', () => {
  it('publishes one cache.invalidated server event per tagged envelope', async () => {
    const h = buildChain();
    await h.dispatch(
      envelope(
        'Identity.SessionIssued',
        't1',
        ['Tenant:t1', 'User:user-1', 'Session:sess-1'],
        { document: {} },
      ),
    );
    await settle();
    const invalidatedEvents = h.serverEvents.filter(
      (e) => e.eventType === 'cache.invalidated',
    );
    expect(invalidatedEvents).toHaveLength(1);
    expect(invalidatedEvents[0]?.tenantId).toBe('t1');
    expect(invalidatedEvents[0]?.tags).toEqual([
      'Tenant:t1',
      'User:user-1',
      'Session:sess-1',
    ]);
  });

  it('does not publish a cache.invalidated event when cacheInvalidationTags is empty', async () => {
    const h = buildChain();
    await h.dispatch(envelope('Identity.UserCreated', 't1', [], { document: {} }));
    await settle();
    const invalidatedEvents = h.serverEvents.filter(
      (e) => e.eventType === 'cache.invalidated',
    );
    expect(invalidatedEvents).toEqual([]);
  });
});

describe('per-tenant isolation', () => {
  it("dispatching a tenant-A event does not invalidate tenant B's cache key", async () => {
    const h = buildChain();
    // Pre-seed cache entries for both tenants.
    await h.cache.set(
      'render:tenant-a:home',
      'a',
      { ttlSeconds: 0, tags: ['Tenant:tenant-a'] },
    );
    await h.cache.set(
      'render:tenant-b:home',
      'b',
      { ttlSeconds: 0, tags: ['Tenant:tenant-b'] },
    );
    await h.dispatch(
      envelope(
        'Identity.SessionIssued',
        'tenant-a',
        ['Tenant:tenant-a', 'User:user-1', 'Session:sess-1'],
        { document: {} },
      ),
    );
    expect(h.cache.store.has('render:tenant-a:home')).toBe(false);
    expect(h.cache.store.has('render:tenant-b:home')).toBe(true);
  });

  it("does not invalidate tenant B's Cedar bundle when a tenant-A event fires", async () => {
    const h = buildChain();
    await h.dispatch(
      envelope(
        'Identity.MembershipRolesChanged',
        'tenant-a',
        ['Tenant:tenant-a', 'User:user-1'],
        { document: {} },
      ),
    );
    expect(h.cedarCache.invalidatedTenants).toEqual(['tenant-a']);
    expect(h.cedarCache.invalidatedTenants).not.toContain('tenant-b');
  });

  it('SSE cache.invalidated carries the originating tenant only', async () => {
    const h = buildChain();
    await h.dispatch(
      envelope(
        'Identity.SessionIssued',
        'tenant-a',
        ['Tenant:tenant-a', 'User:user-1', 'Session:sess-1'],
        { document: {} },
      ),
    );
    await settle();
    const invalidated = h.serverEvents.filter(
      (e) => e.eventType === 'cache.invalidated',
    );
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.tenantId).toBe('tenant-a');
    // No tenant-b leakage in the tags.
    expect(
      (invalidated[0]?.tags ?? []).every((t) => !t.includes('tenant-b')),
    ).toBe(true);
  });
});

describe('error semantics — composeDispatchers runs all dispatchers even on partial failure', () => {
  it('cacheTag + policy-cache + server-events all fire even when an upstream module dispatcher throws', async () => {
    // Build a chain where the identity dispatcher throws on a specific
    // event type. The cross-cutting dispatchers downstream MUST still
    // run (per `composeDispatchers` error contract).
    const cache = new InMemoryCache();
    const cedarCache = new RecordingCedarCache();
    const broadcast = new ServerEventBroadcast(1024);
    const serverEvents: ServerEvent[] = [];
    const { events, unsubscribe: _unsub } = broadcast.subscribe();
    void (async () => {
      try {
        for await (const ev of events) serverEvents.push(ev);
      } catch {
        /* iterator closed */
      }
    })();

    const throwingIdentity: EventDispatcher = async () => {
      throw new Error('synthetic projection failure');
    };

    const dispatch = composeDispatchers(
      throwingIdentity,
      cacheTagDispatcher(cache),
      policyCacheDispatcher(cedarCache),
      serverEventDispatcher(broadcast),
    );

    const env = envelope(
      'Identity.UserCreated',
      't1',
      ['Tenant:t1', 'User:user-1'],
      {},
    );

    // Composer re-throws the first error after running every dispatcher.
    await expect(dispatch(env)).rejects.toThrow('synthetic projection failure');
    await settle();

    // But cache-tag, policy-cache, and SSE all ran.
    expect(cache.invalidatedTagBatches).toEqual([
      ['Tenant:t1', 'User:user-1'],
    ]);
    expect(cedarCache.invalidatedTenants).toEqual(['t1']);
    expect(serverEvents.some((e) => e.eventType === 'cache.invalidated')).toBe(
      true,
    );
  });
});
