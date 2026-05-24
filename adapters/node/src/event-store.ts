/**
 * PostgresEventStore — Postgres-backed `EventStore` adapter.
 *
 * Schema is installed by the bundled migration
 * `migrations/tenant/20260428000001_events.sql` (run via the @atlas/adapter-node
 * migration runner). This adapter no longer creates tables on the fly.
 *
 * Idempotency is **tenant-scoped** — `(tenant_id, idempotency_key)` is the
 * unique key. Replay across tenants therefore stores both events. Replay
 * within a tenant returns the original event id.
 *
 * `readEvents(tenantId)` returns events ordered ascending by `occurred_at`,
 * with `event_id` as a deterministic tiebreaker.
 */

import { IngressError, type EventEnvelope } from '@atlas/platform-core';
import type { EventStore, StoredEvent } from '@atlas/ports';
import type postgres from 'postgres';

import { jsonParam } from './seeds/sql-json.ts';

interface EventRow {
  event_id: string;
  event_type: string;
  schema_id: string;
  schema_version: number;
  tenant_id: string;
  idempotency_key: string;
  occurred_at: Date | string;
  correlation_id: string;
  causation_id: string | null;
  principal_id: string | null;
  user_id: string | null;
  payload: unknown;
  cache_invalidation_tags: string[] | null;
  // BIGSERIAL — postgres.js returns int8 as string by default; we coerce to bigint.
  seq: string | number | bigint;
}

function toBigInt(v: string | number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function rowToEnvelope(row: EventRow): StoredEvent {
  const occurred =
    row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : new Date(row.occurred_at).toISOString();
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    schemaId: row.schema_id,
    schemaVersion: row.schema_version,
    occurredAt: occurred,
    tenantId: row.tenant_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    causationId: row.causation_id,
    principalId: row.principal_id,
    userId: row.user_id,
    cacheInvalidationTags: row.cache_invalidation_tags,
    payload: row.payload,
    seq: toBigInt(row.seq),
  };
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly sql: postgres.Sql) {}

  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    const tags = envelope.cacheInvalidationTags ?? null;
    // Insert; on (tenant_id, idempotency_key) conflict, do nothing and
    // return no row. Then SELECT the existing record for that key.
    // BIGSERIAL `seq` is assigned by Postgres on insert; returned to
    // populate the envelope's seq field for the worker pipeline.
    const inserted = await this.sql<{ event_id: string; seq: string | number | bigint }[]>`
      INSERT INTO events (
        event_id, event_type, schema_id, schema_version, tenant_id,
        idempotency_key, occurred_at, correlation_id, causation_id,
        principal_id, user_id, payload, cache_invalidation_tags
      ) VALUES (
        ${envelope.eventId},
        ${envelope.eventType},
        ${envelope.schemaId},
        ${envelope.schemaVersion},
        ${envelope.tenantId},
        ${envelope.idempotencyKey},
        ${envelope.occurredAt},
        ${envelope.correlationId},
        ${envelope.causationId ?? null},
        ${envelope.principalId ?? null},
        ${envelope.userId ?? null},
        ${jsonParam(this.sql, envelope.payload)},
        ${tags === null ? this.sql`NULL` : this.sql`${tags}::text[]`}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING event_id, seq
    `;
    const insertedRow = inserted[0];
    if (insertedRow) {
      return {
        ...envelope,
        eventId: insertedRow.event_id,
        seq: toBigInt(insertedRow.seq),
      };
    }
    // Idempotency hit — return the existing record with full row data.
    const existing = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags, seq
      FROM events
      WHERE tenant_id = ${envelope.tenantId}
        AND idempotency_key = ${envelope.idempotencyKey}
      LIMIT 1
    `;
    const existingRow = existing[0];
    if (!existingRow) {
      // Rare race: INSERT was a no-op (someone else won the conflict) but
      // the follow-up SELECT also returned nothing. Surface as the
      // canonical `STORAGE_FAILED` so the boundary middleware in
      // `apps/server` maps it to a 500 with a stable error code.
      throw new IngressError(
        'STORAGE_FAILED',
        `EventStore.append: storage race — insert was a no-op but no existing row found for (${envelope.tenantId}, ${envelope.idempotencyKey})`,
        500,
        '',
      );
    }
    return rowToEnvelope(existingRow);
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<EventEnvelope | null> {
    const rows = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags, seq
      FROM events
      WHERE tenant_id = ${tenantId}
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToEnvelope(row) : null;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    const rows = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags, seq
      FROM events
      WHERE event_id = ${eventId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToEnvelope(row) : null;
  }

  async readEvents(tenantId: string): Promise<EventEnvelope[]> {
    // Order by seq (per-tenant monotonic) — BIGSERIAL is assigned in
    // insertion order, so this is also chronological. Tiebreaker
    // unnecessary because seq is unique.
    const rows = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags, seq
      FROM events
      WHERE tenant_id = ${tenantId}
      ORDER BY seq ASC
    `;
    return rows.map(rowToEnvelope);
  }
}
