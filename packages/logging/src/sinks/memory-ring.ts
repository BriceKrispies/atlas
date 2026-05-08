import type { LogEvent } from '@atlas/platform-core';
import type { Sink } from './sink.ts';

export interface MemoryRingBufferSinkOptions {
  /** Default 5000. */
  capacity?: number;
}

/**
 * Bounded ring buffer keeping the most recent N events in memory.
 * Used for inspection by correlationId (atlasctl logging inspect <id>)
 * and for tests that need to assert "this event was emitted."
 *
 * Synchronous on write — accepting an event is just a single array
 * assignment + counter bump. flushSync is a no-op (data is already
 * in memory). Process death loses the buffer; this is fine for the
 * "operational diagnostics" use case.
 */
export class MemoryRingBufferSink implements Sink {
  private readonly capacity: number;
  private readonly buffer: Array<LogEvent | undefined>;
  private head = 0;
  private len = 0;

  constructor(options: MemoryRingBufferSinkOptions = {}) {
    this.capacity = options.capacity ?? 5000;
    if (this.capacity <= 0) {
      throw new Error(`MemoryRingBufferSink capacity must be > 0, got ${this.capacity}`);
    }
    this.buffer = new Array<LogEvent | undefined>(this.capacity);
  }

  write(event: LogEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.len < this.capacity) this.len++;
  }

  flushSync(): void {
    // Nothing to flush — events are already in memory.
  }

  /** Most-recent-first. */
  recent(limit?: number): ReadonlyArray<LogEvent> {
    const max = Math.min(limit ?? this.len, this.len);
    const out: LogEvent[] = [];
    let cursor = this.head;
    for (let i = 0; i < max; i++) {
      cursor = (cursor - 1 + this.capacity) % this.capacity;
      const e = this.buffer[cursor];
      if (e !== undefined) out.push(e);
    }
    return out;
  }

  /** Most-recent-first events matching the given correlationId. */
  getByCorrelationId(correlationId: string, limit?: number): ReadonlyArray<LogEvent> {
    const max = limit ?? 200;
    const out: LogEvent[] = [];
    let cursor = this.head;
    for (let i = 0; i < this.len && out.length < max; i++) {
      cursor = (cursor - 1 + this.capacity) % this.capacity;
      const e = this.buffer[cursor];
      if (e !== undefined && e.correlationId === correlationId) out.push(e);
    }
    return out;
  }

  size(): number {
    return this.len;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.buffer[i] = undefined;
    this.head = 0;
    this.len = 0;
  }
}
