import type { EventEnvelope } from '@atlas/platform-core';

/**
 * An EventEnvelope after persistence — `seq` is guaranteed populated.
 * `EventStore.append` returns this shape; callers can assign
 * `envelope.seq = stored.seq` without an `undefined` check.
 */
export type StoredEvent = EventEnvelope & { seq: bigint };

export interface EventStore {
  /**
   * Append an event. The store assigns a per-tenant monotonic `seq` and
   * returns the appended envelope (with `seq` populated). The returned
   * envelope is the canonical record — callers that need the seq should
   * use this rather than the input.
   *
   * Postgres backing assigns via BIGSERIAL; IDB synthesizes a per-tenant
   * counter. Idempotency is per-(tenant, idempotencyKey) — re-appending
   * with the same key returns the existing record.
   */
  append(envelope: EventEnvelope): Promise<StoredEvent>;

  getEvent(eventId: string): Promise<EventEnvelope | null>;

  /**
   * Read all events for a tenant in seq order. Used by tooling and
   * projection rebuild paths. The projection worker uses `WorkerSource`
   * for live streaming rather than this method.
   */
  readEvents(tenantId: string): Promise<EventEnvelope[]>;
}
