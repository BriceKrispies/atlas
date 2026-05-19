/**
 * Typed test-double factories for the ingress unit tests.
 *
 * Replaces the previous in-file `{ ... } as unknown as <Port>` casts. Each
 * factory builds a `base` typed as the FULL port — TypeScript will fail
 * the build if a new method lands on the port and is not stubbed here. That
 * compile-time exhaustiveness is the whole point: silent-skip casts hide
 * port drift, typed factories surface it.
 *
 * Default stubs return a sensible empty value (null / [] / void). Callers
 * pass `Partial<Port>` overrides to swap specific methods. All stubs are
 * `vi.fn(...)` so consumers can spy on call counts / arguments without
 * re-wrapping.
 *
 * Mirrored at `apps/server/test/lib/factories.ts` (cross-package test-folder
 * imports aren't supported by the workspace exports map; the two files are
 * deliberately kept identical for the basic port factories).
 */
import { vi } from '@atlas/test';
import type { Cache, CatalogStateStore, Entity, EntityStore, EventStore, ProjectionStore, RelationStore, Relation, SearchEngine, StoredEvent, } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
// ── Cache ───────────────────────────────────────────────────────────
export function makeFakeCache(overrides: Partial<Cache> = {}): Cache {
    const base: Cache = {
        get: vi.fn(async function () {
            return null;
        }),
        set: vi.fn(async function () { }),
        invalidateByKey: vi.fn(async function () {
            return false;
        }),
        invalidateByTags: vi.fn(async function () {
            return 0;
        }),
    };
    return { ...base, ...overrides };
}
// ── ProjectionStore ─────────────────────────────────────────────────
export function makeFakeProjections(overrides: Partial<ProjectionStore> = {}): ProjectionStore {
    const base: ProjectionStore = {
        get: vi.fn(async function () {
            return null;
        }),
        set: vi.fn(async function () { }),
        delete: vi.fn(async function () {
            return false;
        }),
    };
    return { ...base, ...overrides };
}
// ── SearchEngine ────────────────────────────────────────────────────
export function makeFakeSearch(overrides: Partial<SearchEngine> = {}): SearchEngine {
    const base: SearchEngine = {
        index: vi.fn(async function () { }),
        deleteByDocument: vi.fn(async function () { }),
        search: vi.fn(async function () {
            return [];
        }),
    };
    return { ...base, ...overrides };
}
// ── CatalogStateStore ───────────────────────────────────────────────
export function makeFakeCatalogState(overrides: Partial<CatalogStateStore> = {}): CatalogStateStore {
    const base: CatalogStateStore = {
        get: vi.fn(async function () {
            return null;
        }),
        put: vi.fn(async function () { }),
    };
    return { ...base, ...overrides };
}
// ── EntityStore ─────────────────────────────────────────────────────
//
// EntityStore has per-method generics (`<TAttrs = unknown>`). vi.fn cannot
// produce a callable that satisfies a generic method signature without an
// `as` cast, so the base impls here are plain async functions; tests that
// need spy semantics for a specific method should pass a `vi.fn`-wrapped
// override.
export function makeFakeEntityStore(overrides: Partial<EntityStore> = {}): EntityStore {
    const base: EntityStore = {
        async get() {
            return null;
        },
        async put<TAttrs = unknown>(input: import('@atlas/ports').EntityWriteInput<TAttrs>): Promise<Entity<TAttrs>> {
            const now = new Date().toISOString();
            return {
                tenantId: input.tenantId,
                entityType: input.entityType,
                entityId: input.entityId,
                schemaVersion: input.schemaVersion ?? 1,
                attrs: input.attrs,
                status: input.status ?? 'active',
                createdAt: now,
                updatedAt: now,
            };
        },
        async delete() { },
        async list() {
            return [];
        },
        async query() {
            return [];
        },
    };
    return { ...base, ...overrides };
}
// ── RelationStore ───────────────────────────────────────────────────
export function makeFakeRelationStore(overrides: Partial<RelationStore> = {}): RelationStore {
    const base: RelationStore = {
        async add<TAttrs = unknown>(input: import('@atlas/ports').RelationWriteInput<TAttrs>): Promise<Relation<TAttrs>> {
            return {
                tenantId: input.tenantId,
                edgeType: input.edgeType,
                fromId: input.fromId,
                toId: input.toId,
                attrs: input.attrs ?? null,
                createdAt: new Date().toISOString(),
            };
        },
        async remove() { },
        async outgoing() {
            return [];
        },
        async incoming() {
            return [];
        },
    };
    return { ...base, ...overrides };
}
// ── EventStore (stateful) ───────────────────────────────────────────
//
// EventStore tests inspect the appended events + seed idempotency rows, so
// the factory exposes a *stateful* fake. Tests grab the returned `store`,
// pre-seed it with `seedIdempotent(...)`, then assert on `store.appended`
// after the action under test runs.
export interface StatefulEventStore extends EventStore {
    readonly appended: EventEnvelope[];
    /** Seed a prior event so the next `findByIdempotencyKey` returns it. */
    seedIdempotent(envelope: EventEnvelope): void;
}
export function makeFakeEventStore(overrides: Partial<EventStore> = {}): StatefulEventStore {
    const appended: EventEnvelope[] = [];
    const byIdemKey = new Map<string, EventEnvelope>();
    let nextSeq = 1n;
    const base: EventStore = {
        async append(envelope: EventEnvelope): Promise<StoredEvent> {
            const stored: StoredEvent = {
                ...envelope,
                eventId: envelope.eventId || `evt-${appended.length + 1}`,
                seq: nextSeq++,
            };
            appended.push(stored);
            if (envelope.idempotencyKey) {
                byIdemKey.set(`${envelope.tenantId}::${envelope.idempotencyKey}`, stored);
            }
            return stored;
        },
        async getEvent() {
            return null;
        },
        async findByIdempotencyKey(tenantId, idempotencyKey) {
            return byIdemKey.get(`${tenantId}::${idempotencyKey}`) ?? null;
        },
        async readEvents() {
            return [...appended];
        },
    };
    const merged = { ...base, ...overrides };
    return Object.assign(merged, {
        appended,
        seedIdempotent(envelope: EventEnvelope): void {
            if (!envelope.idempotencyKey) {
                throw new Error('seedIdempotent: envelope must have idempotencyKey');
            }
            byIdemKey.set(`${envelope.tenantId}::${envelope.idempotencyKey}`, envelope);
        },
    });
}
