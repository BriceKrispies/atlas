import type { EventEnvelope } from '@atlas/platform-core';
import type { StoredEvent, WorkerSource, WorkerSubscription } from '@atlas/ports';
import type { EventRow, IdbDb, WorkerCursorRow } from './db.ts';

/**
 * IDB-backed `WorkerSource`.
 *
 * Wakes on a `BroadcastChannel('atlas:events:<tenantId>')` message and falls
 * back to a 250ms poll. On each wake, drains the gap from the
 * `by_tenant_seq` index past the in-memory `afterSeq` cursor (up to 100
 * rows per drain) and yields events in seq order to the consumer of
 * `events()`.
 *
 * Cursor durability: `ack(seq)` writes a `worker_cursors` row keyed by
 * `${tenantId} ${moduleId}` (consistent with `RenderTreeRow`'s composite
 * key shape). Acks are monotonic — earlier seqs are ignored.
 *
 * Bigint <-> number conversion happens at this boundary, mirroring
 * `IdbEventStore`. The port surface is `bigint`; IDB stores `number`.
 *
 * TODO(worker-broadcast): `IdbEventStore.append` does NOT currently
 * `postMessage` to `atlas:events:<tenantId>` — the worker append flow
 * needs to start posting wake-ups so cross-tab/cross-Worker delivery is
 * snappy. Until that lands, this adapter stays correct via the 250ms
 * poll fallback (it just won't be as fast).
 */
export class IdbWorkerSource implements WorkerSource {
  constructor(
    private readonly db: IdbDb,
    private readonly moduleId: string,
  ) {}

  subscribe(tenantId: string, afterSeq: bigint): WorkerSubscription {
    return new IdbWorkerSubscription(this.db, this.moduleId, tenantId, afterSeq);
  }
}

const POLL_INTERVAL_MS = 250;
const DRAIN_BATCH = 100;

class IdbWorkerSubscription implements WorkerSubscription {
  private cursor: number;
  private readonly queue: StoredEvent[] = [];
  private readonly channel: BroadcastChannel;
  private pollTimer: ReturnType<typeof setInterval> | null;
  private waiter: (() => void) | null = null;
  private draining = false;
  private closed = false;
  private drainPending = false;

  constructor(
    private readonly db: IdbDb,
    private readonly moduleId: string,
    private readonly tenantId: string,
    afterSeq: bigint,
  ) {
    this.cursor = Number(afterSeq);
    this.channel = new BroadcastChannel(`atlas:events:${tenantId}`);
    this.channel.onmessage = () => {
      void this.scheduleDrain();
    };
    this.pollTimer = setInterval(() => {
      void this.scheduleDrain();
    }, POLL_INTERVAL_MS);
    // Kick an initial drain so consumers see any pre-existing gap.
    void this.scheduleDrain();
  }

  events(): AsyncIterable<EventEnvelope> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<EventEnvelope> {
        return {
          async next(): Promise<IteratorResult<EventEnvelope>> {
            while (true) {
              if (self.queue.length > 0) {
                const value = self.queue.shift() as StoredEvent;
                return { value, done: false };
              }
              if (self.closed) {
                return { value: undefined, done: true };
              }
              await self.waitForWake();
            }
          },
          async return(): Promise<IteratorResult<EventEnvelope>> {
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  async ack(seq: bigint): Promise<void> {
    if (this.closed) {
      throw new Error('worker subscription closed');
    }
    const cursorKey = `${this.tenantId} ${this.moduleId}`;
    const tx = this.db.transaction('worker_cursors', 'readwrite');
    const store = tx.objectStore('worker_cursors');
    const existing = await store.get(cursorKey);
    const newSeq = Number(seq);
    if (existing && existing.lastSeq >= newSeq) {
      await tx.done;
      return;
    }
    const row: WorkerCursorRow = {
      cursorKey,
      tenantId: this.tenantId,
      moduleId: this.moduleId,
      lastSeq: newSeq,
      updatedAt: Date.now(),
    };
    await store.put(row);
    await tx.done;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      this.channel.close();
    } catch {
      // BroadcastChannel.close is idempotent in spec; swallow runtime quirks.
    }
    this.wake();
  }

  private waitForWake(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }

  private wake(): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w();
    }
  }

  private async scheduleDrain(): Promise<void> {
    if (this.closed) return;
    if (this.draining) {
      // Coalesce — another wake arrived mid-drain. Re-run after.
      this.drainPending = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainPending = false;
        await this.drainOnce();
      } while (this.drainPending && !this.closed);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    if (this.closed) return;
    const lower = this.cursor + 1;
    if (lower > Number.MAX_SAFE_INTEGER) return;
    const range = IDBKeyRange.bound(
      [this.tenantId, lower],
      [this.tenantId, Number.MAX_SAFE_INTEGER],
    );
    const rows: EventRow[] = await this.db.getAllFromIndex(
      'events',
      'by_tenant_seq',
      range,
      DRAIN_BATCH,
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      this.queue.push({ ...row, seq: BigInt(row.seq) });
      if (row.seq > this.cursor) {
        this.cursor = row.seq;
      }
    }
    this.wake();
    // If we hit the batch cap, more may exist — request another pass.
    if (rows.length === DRAIN_BATCH) {
      this.drainPending = true;
    }
  }
}
