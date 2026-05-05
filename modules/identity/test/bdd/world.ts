/**
 * BDD world — the per-scenario state passed between steps.
 *
 * One World instance is constructed at the start of EACH scenario. Steps
 * mutate it as the scenario walks through Given/When/Then. After the
 * scenario, the World is discarded — no leakage between scenarios.
 *
 * The in-memory adapter shims here are duplicated from
 * `a5-acceptance.test.ts` so this BDD harness has no dependency on the
 * acceptance suite's internals. If they drift, the divergence shows up
 * as different test results — easy to spot.
 */

import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import type {
  InviteTokenDocument,
  UserDocument,
  IdentityError,
} from '@atlas/identity';
import { dispatchIdentityEvent } from '@atlas/identity';

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
    t: string,
    k: string,
  ): Promise<EventEnvelope | null> {
    return (
      this.events.find((e) => e.tenantId === t && e.idempotencyKey === k) ??
      null
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
  async get<T = unknown>(
    t: string,
    ty: string,
    id: string,
  ): Promise<Entity<T> | null> {
    const r = this.rows.get(this.k(t, ty, id));
    if (!r || r.status === 'deleted') return null;
    return r as Entity<T>;
  }
  async put<T = unknown>(input: EntityWriteInput<T>): Promise<Entity<T>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<T> = {
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
  async list<T = unknown>(
    t: string,
    ty: string,
    opts?: EntityListOptions,
  ): Promise<Entity<T>[]> {
    const desired = opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === t && r.entityType === ty)
      .filter((r) =>
        desired === null ? true : r.status === desired,
      ) as Entity<T>[];
  }
  async query<T = unknown>(
    t: string,
    ty: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<T>[]> {
    const all = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.entityType === ty,
    );
    if (!opts.attrsEqual) return all as Entity<T>[];
    const preds = Object.entries(opts.attrsEqual);
    return all.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return preds.every(([k, v]) => attrs?.[k] === v);
    }) as Entity<T>[];
  }
}

export class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<T = unknown>(input: RelationWriteInput<T>): Promise<Relation<T>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<T> = {
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
  async outgoing<T = unknown>(
    t: string,
    e: string,
    f: string,
  ): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.fromId === f,
    ) as Relation<T>[];
  }
  async incoming<T = unknown>(
    t: string,
    e: string,
    to: string,
  ): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.toId === to,
    ) as Relation<T>[];
  }
}

/**
 * Per-scenario state. Each step reads/writes through here. Properties
 * are intentionally optional — early steps populate them.
 */
export interface BddWorld {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  /** Tenant the scenario operates on. Set by the Background "a tenant ..." step. */
  tenantId: string;
  /** Plaintext invite token, surfaced once at issue, kept for redemption. */
  pendingInviteToken?: string;
  /** Persisted invite document, for asserting consumed-status etc. */
  pendingInvite?: InviteTokenDocument;
  /** User document mutated through the scenario. */
  user?: UserDocument;
  /** The IdentityError (if any) the most recent When-step produced. */
  lastError?: IdentityError;
  /** The most recent EventEnvelope a When-step emitted. */
  lastEnvelope?: EventEnvelope;
}

export function freshWorld(tenantId = 'smb'): BddWorld {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId,
  };
}

/**
 * Replay the world's emitted events through the identity dispatcher
 * to materialise entity-side state. Handlers emit; the dispatcher
 * persists. Call after any When-step that produces events whose
 * entity-side effects subsequent steps rely on.
 */
export async function dispatchAll(world: BddWorld): Promise<void> {
  for (const e of world.events.events) {
    await dispatchIdentityEvent(e, {
      entities: world.entities,
      relations: world.relations,
    });
  }
}
