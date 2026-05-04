import type { EventEnvelope } from '@atlas/platform-core';

/**
 * Feed of new events for the projection worker. The worker reads events
 * past a per-(module, tenant) cursor, runs the dispatcher chain, and acks
 * the cursor on success.
 *
 * The port is intentionally backend-agnostic: the Postgres adapter uses
 * `LISTEN/NOTIFY` to wake on new events; the IDB adapter uses
 * `BroadcastChannel`; future Redis Streams / NATS / Kafka adapters wake on
 * their native primitives. The worker code does not know which.
 *
 * Spec: `specs/worker.md`.
 */
export interface WorkerSource {
  /**
   * Subscribe to events for one tenant past `afterSeq`. Resolves a
   * subscription that yields events in seq order via `events()`. The
   * generator stays open indefinitely; events arrive as they're appended.
   *
   * `afterSeq` is exclusive — events with `seq > afterSeq` are yielded.
   * Pass `0n` to start from the beginning of the stream for this tenant.
   *
   * Caller MUST call `ack(seq)` after successfully processing each event.
   * The cursor for that (tenant, module) advances on ack — on reconnect
   * after a crash, the worker resumes from the last acked seq.
   *
   * Caller MUST call `close()` when done to release backend resources
   * (Postgres LISTEN connection, IDB BroadcastChannel, etc.).
   */
  subscribe(tenantId: string, afterSeq: bigint): WorkerSubscription;
}

export interface WorkerSubscription {
  /**
   * Async iterable of events for the subscribed tenant, in seq order
   * (strictly ascending). Yields as events become available; suspends
   * when the feed is empty.
   *
   * The iterable terminates when `close()` is called.
   */
  events(): AsyncIterable<EventEnvelope>;

  /**
   * Mark the cursor for the (caller-provided) module advanced past `seq`.
   * Implementations persist the cursor durably so a restart resumes from
   * here. Idempotent — acking a seq <= current cursor is a no-op.
   *
   * The module identifier is implicit in the caller — typically the
   * worker holds one subscription per (module, tenant) pair, and the
   * subscription's adapter knows which cursor row to update. If a single
   * subscription serves multiple modules (Phase 6 deferred), the
   * subscription factory must take a module id.
   */
  ack(seq: bigint): Promise<void>;

  /**
   * Stop yielding events and release backend resources. Safe to call
   * multiple times. After close, `events()` terminates and `ack()`
   * rejects.
   */
  close(): Promise<void>;
}
