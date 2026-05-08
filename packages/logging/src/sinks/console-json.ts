import type { Writable } from 'node:stream';
import type { LogEvent, LogLevel } from '@atlas/platform-core';
import type { Sink } from './sink.ts';

const SOFT_CAP = 8000;
const HARD_CAP = 10_000;
const OVERFLOW_REPORT_THROTTLE_MS = 5000;

interface DropCounts {
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

function zeroCounts(): DropCounts {
  return { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
}

export interface ConsoleJsonSinkOptions {
  stream?: Writable;
  /** Override the soft cap (default 8000). Useful for tests. */
  softCap?: number;
  /** Override the hard cap (default 10000). Useful for tests. */
  hardCap?: number;
}

/**
 * Stdout JSON sink with buffered drain and overflow policy.
 *
 * Hot path:
 *   1. fatal events: sync flush of buffer + sync write of fatal event.
 *      The caller is exiting; we do not afford async.
 *   2. otherwise: push into buffer; if soft cap is exceeded, evict oldest
 *      debug entry (or oldest info if no debugs and we're past hard cap).
 *      Schedule a setImmediate drain if not already scheduled.
 *
 * Overflow report:
 *   - Drops are tracked per-level (lifetime + per-window).
 *   - On drain, if drops happened in the current window AND it's been
 *     >5s since the last report, prepend a meta-log line announcing them.
 */
export class ConsoleJsonSink implements Sink {
  private readonly stream: Writable;
  private readonly softCap: number;
  private readonly hardCap: number;
  private readonly buffer: LogEvent[] = [];
  private drainScheduled = false;
  private droppedLifetime: DropCounts = zeroCounts();
  private droppedSinceReport: DropCounts = zeroCounts();
  private lastReportAt = 0;

  constructor(options: ConsoleJsonSinkOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.softCap = options.softCap ?? SOFT_CAP;
    this.hardCap = options.hardCap ?? HARD_CAP;
  }

  write(event: LogEvent): void {
    if (event.level === 'fatal') {
      // Caller is exiting. Flush whatever is buffered, then write the
      // fatal record synchronously, before returning to the caller.
      this.flushBuffer();
      this.stream.write(`${JSON.stringify(event)}\n`);
      return;
    }

    if (this.buffer.length >= this.softCap) {
      this.evictForSpace();
    }
    this.buffer.push(event);
    if (!this.drainScheduled) {
      this.drainScheduled = true;
      setImmediate(this.boundDrain);
    }
  }

  private boundDrain = (): void => {
    this.drainScheduled = false;
    this.flushBuffer();
  };

  private flushBuffer(): void {
    const overflowReport = this.maybeBuildOverflowReport();
    if (this.buffer.length === 0 && overflowReport === null) return;

    let chunk = '';
    if (overflowReport !== null) chunk += `${JSON.stringify(overflowReport)}\n`;
    for (const e of this.buffer) chunk += `${JSON.stringify(e)}\n`;
    this.buffer.length = 0;
    this.stream.write(chunk);
  }

  private maybeBuildOverflowReport(): LogEvent | null {
    const total =
      this.droppedSinceReport.debug +
      this.droppedSinceReport.info +
      this.droppedSinceReport.warn +
      this.droppedSinceReport.error;
    if (total === 0) return null;
    const now = Date.now();
    if (now - this.lastReportAt < OVERFLOW_REPORT_THROTTLE_MS) return null;
    this.lastReportAt = now;
    const window = this.droppedSinceReport;
    this.droppedSinceReport = zeroCounts();
    return {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'log buffer overflow — dropped events',
      eventName: 'Logging.BufferOverflow.Dropped',
      tenantId: 'system',
      principalId: 'system',
      correlationId: 'logging-overflow',
      traceId: 'logging-overflow',
      spanId: 'logging-overflow',
      properties: {
        droppedInWindow: { ...window },
        droppedLifetime: { ...this.droppedLifetime },
      },
    };
  }

  private evictForSpace(): void {
    // Evict oldest debug. If none, and buffer is past hard cap, evict
    // oldest info. Never evict warn/error/fatal — those are too important
    // to lose. The buffer can grow past hard cap if it contains only
    // warn/error/fatal events; that's the intended semantics.
    let evicted = this.evictFirstByLevel('debug');
    if (!evicted && this.buffer.length >= this.hardCap) {
      evicted = this.evictFirstByLevel('info');
    }
    void evicted;
  }

  private evictFirstByLevel(level: LogLevel): boolean {
    for (let i = 0; i < this.buffer.length; i++) {
      const entry = this.buffer[i];
      if (entry !== undefined && entry.level === level) {
        this.buffer.splice(i, 1);
        this.droppedLifetime[level]++;
        this.droppedSinceReport[level]++;
        return true;
      }
    }
    return false;
  }

  flushSync(): void {
    this.flushBuffer();
  }

  /** For tests / inspection. */
  droppedCounts(): Readonly<DropCounts> {
    return { ...this.droppedLifetime };
  }

  /** For tests. */
  bufferedCount(): number {
    return this.buffer.length;
  }
}
