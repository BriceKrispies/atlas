import type { LogEvent } from '@atlas/platform-core';

/**
 * Sink — the boundary between the logging pipeline and any output channel
 * (stdout, ring buffer, future remote ingest). Implementations decide their
 * own backpressure policy: buffered/dropping (ConsoleJsonSink), bounded
 * ring (MemoryRingBufferSink), unbounded collector (CollectorSink for tests).
 */
export interface Sink {
  /**
   * Accept an event for this sink. Implementations MUST return synchronously
   * and SHOULD NOT block on I/O — the caller is on the request path. Any
   * actual I/O is the sink's responsibility to schedule async (typically
   * via setImmediate batching).
   *
   * Exception: a sink MAY perform sync I/O when level === 'fatal', because
   * the caller is about to exit and cannot afford to lose the line.
   */
  write(event: LogEvent): void;

  /**
   * Synchronous flush. Called by exit handlers and by Logger.fatal. After
   * this returns, all events accepted before the call must be on the wire
   * (to whatever extent the sink can guarantee).
   */
  flushSync(): void;
}
