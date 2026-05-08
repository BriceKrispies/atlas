import type { LogEvent } from '@atlas/platform-core';
import type { Sink } from './sink.ts';

/**
 * Synchronous, unbounded collector. Tests use this to capture every
 * event the pipeline dispatches without buffering or drop semantics
 * getting in the way.
 *
 * Not for production use.
 */
export class CollectorSink implements Sink {
  public readonly events: LogEvent[] = [];

  write(event: LogEvent): void {
    this.events.push(event);
  }

  flushSync(): void {
    // noop — already collected
  }

  reset(): void {
    this.events.length = 0;
  }
}
