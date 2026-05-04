/**
 * PostgresWorkerSource — Postgres-backed `WorkerSource` adapter.
 *
 * Wakes via Postgres `LISTEN/NOTIFY`. The companion migration
 * `migrations/tenant/20260503000001_events_seq_and_worker_cursors.sql`
 * installs the `events.seq BIGSERIAL` column, the `worker_cursors` cursor
 * table, and the `notify_event_appended` trigger that fires
 * `pg_notify('atlas_events_appended_<sanitized-tenant>', NEW.seq::text)`
 * on every insert.
 *
 * Subscriptions hold an open LISTEN reservation for the lifetime of the
 * subscription. On every wake (or initial subscribe), the subscription
 * drains "the gap" — selects events past the in-memory `afterSeq` in
 * batches of 100 — to be robust against:
 *   - events appended before the LISTEN was established
 *   - dropped notifications (postgres.js auto-reconnects after error)
 *   - bursts that NOTIFY can collapse (NOTIFY may coalesce duplicates)
 *
 * Cursor advancement (`ack`) is conditional — only updates `last_seq` when
 * the new value is strictly greater than the existing one, so out-of-order
 * acks (e.g. retried processing of a stale seq) cannot regress the cursor.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { StoredEvent, WorkerSource, WorkerSubscription } from '@atlas/ports';
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

/** Mirror of the SQL-side regex in `notify_event_appended()`. */
function sanitizeChannelTenant(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9_]/g, '_');
}

const DRAIN_BATCH_SIZE = 100;

class PostgresWorkerSubscription implements WorkerSubscription {
  /** Highest seq we've already yielded (or determined on startup as the floor). */
  private cursor: bigint;
  /** FIFO of events ready to be yielded. */
  private readonly queue: StoredEvent[] = [];
  /** Resolves when there is something to do (event arrived or close called). */
  private waker: Promise<void>;
  private wake: () => void;
  private closed = false;
  /** Postgres listen handle — owned for the lifetime of the subscription. */
  private listenHandle: { unlisten(): Promise<void> } | null = null;
  /** True while an in-flight drain is running, to coalesce concurrent wakes. */
  private draining = false;
  /** Set when a wake arrived during a drain — drain again on completion. */
  private drainPending = false;

  constructor(
    private readonly sql: postgres.Sql,
    private readonly tenantId: string,
    private readonly moduleId: string,
    afterSeq: bigint,
  ) {
    this.cursor = afterSeq;
    // Bootstrap waker; replaced on each consumer await.
    this.wake = () => {};
    this.waker = new Promise<void>((resolve) => {
      this.wake = resolve;
    });
    void this.start();
  }

  private resetWaker(): void {
    this.waker = new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }

  private signal(): void {
    const w = this.wake;
    // Replace before resolving so we don't lose a notification that lands
    // immediately after the await returns.
    this.resetWaker();
    w();
  }

  private async start(): Promise<void> {
    const channel = `atlas_events_appended_${sanitizeChannelTenant(this.tenantId)}`;
    try {
      const handle = await this.sql.listen(channel, () => {
        // Notification payload is the seq, but we don't trust it as the
        // sole source — drain by query for correctness.
        this.scheduleDrain();
      });
      if (this.closed) {
        // close() raced ahead — release immediately.
        await handle.unlisten().catch(() => {});
        return;
      }
      this.listenHandle = handle;
      // Drain anything that landed before LISTEN was established.
      this.scheduleDrain();
    } catch (err) {
      // If LISTEN setup fails, surface it by closing. Iterator consumers
      // will see termination; ack() will reject.
      this.closed = true;
      this.signal();
      // eslint-disable-next-line no-console
      console.error('PostgresWorkerSource: LISTEN setup failed', err);
    }
  }

  private scheduleDrain(): void {
    if (this.closed) return;
    if (this.draining) {
      this.drainPending = true;
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      // Loop until a query returns fewer than the batch size — i.e. the
      // gap is empty. Each iteration advances the in-memory cursor.
      // eslint-disable-next-line no-constant-condition
      while (!this.closed) {
        const after = this.cursor;
        const rows = await this.sql<EventRow[]>`
          SELECT event_id, event_type, schema_id, schema_version, tenant_id,
                 idempotency_key, occurred_at, correlation_id, causation_id,
                 principal_id, user_id, payload, cache_invalidation_tags, seq
          FROM events
          WHERE tenant_id = ${this.tenantId}
            AND seq > ${after.toString()}::bigint
          ORDER BY seq ASC
          LIMIT ${DRAIN_BATCH_SIZE}
        `;
        if (rows.length === 0) break;
        for (const row of rows) {
          const env = rowToEnvelope(row);
          this.queue.push(env);
          if (env.seq > this.cursor) this.cursor = env.seq;
        }
        this.signal();
        if (rows.length < DRAIN_BATCH_SIZE) break;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('PostgresWorkerSource: drain failed', err);
    } finally {
      this.draining = false;
      if (this.drainPending && !this.closed) {
        this.drainPending = false;
        void this.drain();
      }
    }
  }

  events(): AsyncIterable<EventEnvelope> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<EventEnvelope> {
        return {
          async next(): Promise<IteratorResult<EventEnvelope>> {
            // eslint-disable-next-line no-constant-condition
            while (true) {
              if (self.queue.length > 0) {
                const ev = self.queue.shift()!;
                return { value: ev, done: false };
              }
              if (self.closed) {
                return { value: undefined as unknown as EventEnvelope, done: true };
              }
              await self.waker;
            }
          },
          async return(): Promise<IteratorResult<EventEnvelope>> {
            await self.close();
            return { value: undefined as unknown as EventEnvelope, done: true };
          },
        };
      },
    };
  }

  async ack(seq: bigint): Promise<void> {
    if (this.closed) {
      throw new Error('PostgresWorkerSubscription.ack: subscription is closed');
    }
    // Conditional update guarantees monotonicity even under concurrent
    // ack from a parallel worker (Phase 6 multi-worker scenario).
    await this.sql`
      INSERT INTO worker_cursors (tenant_id, module_id, last_seq)
      VALUES (${this.tenantId}, ${this.moduleId}, ${seq.toString()}::bigint)
      ON CONFLICT (tenant_id, module_id) DO UPDATE
        SET last_seq = EXCLUDED.last_seq,
            updated_at = now()
        WHERE worker_cursors.last_seq < EXCLUDED.last_seq
    `;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Wake any pending event() iterator awaiter so it observes `closed`.
    this.signal();
    const handle = this.listenHandle;
    this.listenHandle = null;
    if (handle) {
      try {
        await handle.unlisten();
      } catch {
        // best-effort; subscription is being torn down anyway
      }
    }
  }
}

export class PostgresWorkerSource implements WorkerSource {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly moduleId: string,
  ) {}

  subscribe(tenantId: string, afterSeq: bigint): WorkerSubscription {
    return new PostgresWorkerSubscription(this.sql, tenantId, this.moduleId, afterSeq);
  }
}
