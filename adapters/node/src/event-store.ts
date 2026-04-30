/**
 * PostgresEventStore — Postgres-backed `EventStore` adapter.
 *
 * Schema is installed by the bundled migration
 * `migrations/tenant/20260428000001_events.sql` (run via the adapters-node
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
import type { EventStore } from '@atlas/ports';
import type postgres from 'postgres';

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
}

function rowToEnvelope(row: EventRow): EventEnvelope {
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
  };
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly sql: postgres.Sql) {}

  async append(envelope: EventEnvelope): Promise<string> {
    const tags = envelope.cacheInvalidationTags ?? null;
    // Insert; on (tenant_id, idempotency_key) conflict, do nothing and
    // return no row. Then SELECT the existing event_id for that key.
    const inserted = await this.sql<{ event_id: string }[]>`
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
        ${this.sql.json(envelope.payload as never)},
        ${tags as unknown as string[] | null}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING event_id
    `;
    if (inserted.length > 0) {
      return inserted[0]!.event_id;
    }
    const existing = await this.sql<{ event_id: string }[]>`
      SELECT event_id
      FROM events
      WHERE tenant_id = ${envelope.tenantId}
        AND idempotency_key = ${envelope.idempotencyKey}
      LIMIT 1
    `;
    if (existing.length === 0) {
      // Rare race: INSERT was a no-op (someone else won the conflict) but
      // the follow-up SELECT also returned nothing. Surface as the
      // canonical `STORAGE_FAILED` so the boundary middleware in
      // `apps/server` maps it to a 500 with a stable error code.
      // `correlationId` is the empty string — the middleware substitutes
      // its own correlation id when the adapter doesn't have one.
      throw new IngressError(
        'STORAGE_FAILED',
        `EventStore.append: storage race — insert was a no-op but no existing row found for (${envelope.tenantId}, ${envelope.idempotencyKey})`,
        500,
        '',
      );
    }
    return existing[0]!.event_id;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    const rows = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags
      FROM events
      WHERE event_id = ${eventId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToEnvelope(row) : null;
  }

  async readEvents(tenantId: string): Promise<EventEnvelope[]> {
    const rows = await this.sql<EventRow[]>`
      SELECT event_id, event_type, schema_id, schema_version, tenant_id,
             idempotency_key, occurred_at, correlation_id, causation_id,
             principal_id, user_id, payload, cache_invalidation_tags
      FROM events
      WHERE tenant_id = ${tenantId}
      ORDER BY occurred_at ASC, event_id ASC
    `;
    return rows.map(rowToEnvelope);
  }
}
