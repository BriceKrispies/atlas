import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore, StoredEvent } from '@atlas/ports';
import type { EventRow, IdbDb } from './db.ts';

/**
 * IDB-backed `EventStore`.
 *
 * Stores events with a synthesized per-tenant `seq` (a monotonic number
 * incremented on each append). The IDB schema's `by_tenant_seq` index
 * supports keyset pagination for the worker.
 *
 * Bigint <-> number conversion happens at this boundary: `EventEnvelope`
 * exposes `seq: bigint` (consistent with Postgres BIGSERIAL semantics),
 * but IDB stores `seq: number` (IDB indexes don't accept bigint keys).
 * JS numbers are safe up to 2^53 — far above any realistic event count.
 *
 * On successful append, posts to `BroadcastChannel('atlas:events:<tenantId>')`
 * so the IDB `WorkerSource` (and any other listener — e.g., the Web Worker
 * mirror in `apps/sim`) wakes immediately rather than relying on the 250ms
 * poll fallback. Channel post is best-effort: if `BroadcastChannel` is
 * unavailable (older browsers, some test environments), we silently skip
 * — the worker's polling fallback still picks up the event.
 */
export class IdbEventStore implements EventStore {
  constructor(private readonly db: IdbDb) {}

  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const idx = store.index('by_tenant_idempotency_key');
    const existing = await idx.get([envelope.tenantId, envelope.idempotencyKey]);
    if (existing) {
      await tx.done;
      return rowToEnvelope(existing);
    }
    // Synthesize next seq for this tenant. The `by_tenant_seq` index is
    // ordered by `[tenantId, seq]` ascending — `openCursor(..., 'prev')`
    // yields the highest existing seq for the tenant.
    const seqIdx = store.index('by_tenant_seq');
    const range = IDBKeyRange.bound(
      [envelope.tenantId, -Infinity],
      [envelope.tenantId, +Infinity],
    );
    const cursor = await seqIdx.openCursor(range, 'prev');
    const nextSeq = cursor ? cursor.value.seq + 1 : 1;
    const row: EventRow = {
      ...envelope,
      seq: nextSeq,
      // Strip the (optional) bigint seq from the input — we own the canonical seq.
    };
    await store.add(row);
    await tx.done;
    postWake(envelope.tenantId, nextSeq);
    return rowToEnvelope(row);
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    const v = await this.db.get('events', eventId);
    return v ? rowToEnvelope(v) : null;
  }

  async readEvents(tenantId: string): Promise<EventEnvelope[]> {
    // Tenant scoping is mandatory (Invariant I7). The port signature is
    // `tenantId: string`; there is no cross-tenant escape hatch.
    //
    // Order by `(tenantId, seq)` — seq is monotonic per tenant, so this
    // is also chronological ordering (events are seq'd at append time).
    const range = IDBKeyRange.bound(
      [tenantId, -Infinity],
      [tenantId, +Infinity],
    );
    const all = await this.db.getAllFromIndex('events', 'by_tenant_seq', range);
    return all.map(rowToEnvelope);
  }
}

function rowToEnvelope(row: EventRow): StoredEvent {
  return {
    ...row,
    seq: BigInt(row.seq),
  };
}

function postWake(tenantId: string, seq: number): void {
  // Best-effort wake for `IdbWorkerSource` and Web-Worker mirrors. Older
  // browsers and some test environments lack `BroadcastChannel`; skip
  // silently in that case — the worker's poll fallback still picks the
  // event up.
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(`atlas:events:${tenantId}`);
    ch.postMessage({ seq });
    ch.close();
  } catch {
    // Swallow — wake is non-essential.
  }
}
