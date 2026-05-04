/**
 * In-memory server-event broadcast channel.
 *
 * Mirrors the Rust ingress's `tokio::sync::broadcast::Sender<ServerEvent>`
 * (see `crates/ingress/src/main.rs` AppState + `crates/ingress/src/sse.rs`).
 * The Rust side uses tokio's bounded broadcast (capacity 256) which drops
 * old messages for slow subscribers — we mirror that semantic with a
 * per-subscriber bounded queue: when a subscriber's queue fills it gets
 * "lagged" (oldest events are dropped), matching the Rust SSE handler's
 * `BroadcastStreamRecvError::Lagged` branch.
 *
 * Architecture note: TS ingress is in-request dispatch — there is no
 * background worker loop polling the event store like the Rust binary
 * has. Events are published synchronously from inside the request flow
 * (see `serverEventDispatcher`) once the event has been appended +
 * dispatched. The broadcast channel is in-memory, per Node process; for
 * multi-replica deployments this needs replacing with Redis pub/sub or
 * similar, but that is out of scope here (mirrors the Rust state of
 * affairs).
 *
 * Subscribers receive events asynchronously via the returned
 * `AsyncIterableIterator`. Closing the iterator (return / break / throw)
 * unsubscribes — the SSE handler hooks this to the request abort signal.
 */

import type { ServerEvent } from '@atlas/platform-core';

/** Per-subscriber capacity — same as Rust's `broadcast::channel::<ServerEvent>(256)`. */
const DEFAULT_CAPACITY = 256;

interface Subscriber {
  /** Pending events, bounded by `capacity`. */
  queue: ServerEvent[];
  /** Resolves the next `pull()` when an event arrives. */
  notify: (() => void) | null;
  /** Set when `unsubscribe()` is called; the iterator exits on next pull. */
  closed: boolean;
  capacity: number;
}

/**
 * Multi-subscriber, in-memory broadcast channel for `ServerEvent`s.
 *
 * Every call to `subscribe()` returns an independent async iterator that
 * receives every subsequently-published event. Capacity is per-subscriber:
 * a slow consumer cannot block other consumers, but its own queue tail
 * will drop events once full ("lag" semantics).
 */
export class ServerEventBroadcast {
  private readonly subscribers = new Set<Subscriber>();
  private readonly defaultCapacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.defaultCapacity = capacity;
  }

  /** Number of currently-connected subscribers. Visible for tests / metrics. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Publish an event to every subscriber. Non-blocking: subscribers whose
   * queues are full have their oldest event dropped (FIFO eviction).
   * Errors are never thrown from publish — a slow client must not break
   * the producer side.
   */
  publish(event: ServerEvent): void {
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      if (sub.queue.length >= sub.capacity) {
        // Drop oldest — lag-tolerant semantics matching Rust's
        // `BroadcastStream` "Lagged" branch (the SSE handler logs and
        // continues there too).
        sub.queue.shift();
      }
      sub.queue.push(event);
      const notify = sub.notify;
      if (notify) {
        sub.notify = null;
        notify();
      }
    }
  }

  /**
   * Subscribe to the channel. Returns an async iterator + an explicit
   * unsubscribe() function. The iterator yields `ServerEvent`s until
   * `unsubscribe()` is called (typically from the request-abort handler
   * in the SSE route).
   *
   * Pattern:
   *   const { events, unsubscribe } = broadcast.subscribe();
   *   try {
   *     for await (const ev of events) { ... }
   *   } finally {
   *     unsubscribe();
   *   }
   */
  subscribe(capacity?: number): {
    events: AsyncIterableIterator<ServerEvent>;
    unsubscribe: () => void;
  } {
    const sub: Subscriber = {
      queue: [],
      notify: null,
      closed: false,
      capacity: capacity ?? this.defaultCapacity,
    };
    this.subscribers.add(sub);

    const unsubscribe = (): void => {
      if (sub.closed) return;
      sub.closed = true;
      this.subscribers.delete(sub);
      const notify = sub.notify;
      if (notify) {
        sub.notify = null;
        notify();
      }
    };

    const pull = async (): Promise<IteratorResult<ServerEvent>> => {
      // Drain any buffered events first.
      const next = sub.queue.shift();
      if (next !== undefined) {
        return { value: next, done: false };
      }
      if (sub.closed) {
        return { value: undefined, done: true };
      }
      // Wait for either a publish or an unsubscribe to wake us.
      await new Promise<void>((resolve) => {
        sub.notify = resolve;
      });
      const after = sub.queue.shift();
      if (after !== undefined) {
        return { value: after, done: false };
      }
      // Woken by unsubscribe.
      return { value: undefined, done: true };
    };

    const events: AsyncIterableIterator<ServerEvent> = {
      next: pull,
      return: async (): Promise<IteratorResult<ServerEvent>> => {
        unsubscribe();
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<ServerEvent> {
        return this;
      },
    };

    return { events, unsubscribe };
  }
}
