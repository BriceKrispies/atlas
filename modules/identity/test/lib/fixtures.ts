/**
 * Shared test fixtures for identity unit tests under `test/unit/`.
 *
 * These in-memory implementations of `EventStore`, `EntityStore`, and
 * `RelationStore` exist so per-handler unit tests can exercise the real
 * handler + dispatcher logic without booting Postgres or IDB. Each test
 * file in `test/unit/` imports `newFixture` and `dispatchAll` from here
 * instead of redefining the stores inline.
 *
 * Existing scenario-shaped tests (`handlers.test.ts`, `session.test.ts`,
 * `acceptance.test.ts`, `a2-a7-acceptance.test.ts`, etc.) currently
 * duplicate these implementations inline; deduplication is a separate
 * refactor and not in this slice's scope.
 */

import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStatus,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
  SecretStore,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { dispatchIdentityEvent } from '../../src/index.ts';

export class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 0n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    this.nextSeq += 1n;
    const stored: StoredEvent = { ...envelope, seq: this.nextSeq };
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
  async readEvents(): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

export class InMemoryEntityStore implements PortEntityStore {
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
    const existing = this.rows.get(key);
    if (existing) {
      this.rows.set(key, { ...existing, status: 'deleted' });
    }
  }
  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]> {
    const desiredStatus: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.entityType === entityType)
      .filter((r) => (desiredStatus === null ? true : r.status === desiredStatus))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)) as Entity<TAttrs>[];
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

export class InMemoryRelationStore implements RelationStore {
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
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.fromId === fromId,
    ) as Relation<TAttrs>[];
  }
  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.toId === toId,
    ) as Relation<TAttrs>[];
  }
}

export interface Fixture {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  secrets: SecretStore;
  tenantId: string;
}

/**
 * In-memory `SecretStore` for tests. Pre-seeded with the
 * `IDENTITY_ENCRYPTION_KEY` that identity's TOTP/SAML crypto reads —
 * tests don't need to set it explicitly.
 */
export class TestSecretStore implements SecretStore {
  private readonly snapshot: Map<string, string>;
  constructor(values: Readonly<Record<string, string>> = {}) {
    this.snapshot = new Map(Object.entries(values));
  }
  get(name: string): string | null {
    return this.snapshot.get(name) ?? null;
  }
}

/**
 * Build a fresh fixture. Default `tenantId` is `'t1'`; pass an override
 * for tests that need explicit tenant scoping (e.g. cross-tenant
 * assertions where `t1` and `t2` coexist in one fixture).
 */
export function newFixture(tenantId = 't1'): Fixture {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    secrets: new TestSecretStore({
      IDENTITY_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }),
    tenantId,
  };
}

/**
 * Run every event in the fixture's event log through `dispatchIdentityEvent`.
 * Idempotent — dispatching the same event twice is the dispatcher's contract;
 * tests may call this multiple times to assert post-replay state.
 */
export async function dispatchAll(fx: Fixture): Promise<void> {
  for (const e of fx.events.events) {
    await dispatchIdentityEvent(e, {
      entities: fx.entities,
      relations: fx.relations,
    });
  }
}

/**
 * Assert an emitted event envelope carries every expected cache-invalidation
 * tag. This is the I10 mechanical check — a handler that forgets to tag its
 * event silently leaves stale cache state (Invariant I10 violation).
 *
 * Conventions enforced:
 *   - The set of `expectedTags` MUST be a subset of `envelope.cacheInvalidationTags`.
 *     We do NOT require equality so handlers can carry additional, more-specific
 *     resource tags without test churn.
 *   - The order of tags is NOT enforced — `cacheTagDispatcher` uses set
 *     semantics for invalidation.
 *   - At minimum, every envelope MUST carry `Tenant:${tenantId}` (this helper
 *     does not add it implicitly; pass it in `expectedTags` so the assertion
 *     is explicit at the call site).
 *
 * Rationale: per-handler unit tests already assert exact tag arrays in many
 * places. This helper exists for acceptance / scenario tests where the focus
 * is the post-state, not the envelope wire-shape — yet the audit found those
 * scenarios verify state but skip the I10 metadata. One-line per emit fixes
 * the gap.
 *
 * Usage:
 *
 *   import { assertEventTags } from './lib/fixtures.ts';
 *   const result = await handleUserCreate(cmd, fx.events);
 *   assertEventTags(result.envelope, [`Tenant:${fx.tenantId}`, `User:${result.document.userId}`]);
 */
export function assertEventTags(
  envelope: EventEnvelope,
  expectedTags: readonly string[],
): void {
  if (!Array.isArray(envelope.cacheInvalidationTags)) {
    throw new Error(
      `assertEventTags: envelope ${envelope.eventType} (${envelope.eventId}) ` +
        `has no cacheInvalidationTags array (I10 violation)`,
    );
  }
  const have = new Set(envelope.cacheInvalidationTags);
  const missing = expectedTags.filter((t) => !have.has(t));
  if (missing.length > 0) {
    throw new Error(
      `assertEventTags: envelope ${envelope.eventType} (${envelope.eventId}) ` +
        `missing expected tag(s): [${missing.join(', ')}]; ` +
        `actual tags: [${envelope.cacheInvalidationTags.join(', ')}]`,
    );
  }
}
