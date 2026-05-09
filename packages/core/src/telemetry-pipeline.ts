/**
 * Frontend telemetry pipeline for AtlasElement.emit, surface-state
 * transitions, and render-error reporting.
 *
 * Design goals:
 * - Default sink is a no-op so tests and Node imports don't allocate.
 * - Dev (Vite `import.meta.env.DEV`) gets a `ConsoleJsonSink` that preserves
 *   the legacy `console.debug('[telemetry]', obj)` shape so existing
 *   `telemetrySpy` Playwright fixtures keep working.
 * - Prod opts in via `setTelemetrySink(new BeaconHttpSink({ endpoint }))`
 *   from app boot — not done in core, since core has no env knowledge.
 *
 * The pipeline is a process-global. Apps replace it once at boot via
 * `setTelemetrySink(...)`. There's no DI here on purpose: AtlasElement.emit
 * has 140+ call sites and we will not thread a context through every one.
 */

export interface TelemetryEvent {
  /** Dotted event name, e.g. `Surface.State.loading.success`. */
  eventName: string;
  /** ISO-8601 timestamp the pipeline stamped on accept. */
  timestamp: string;
  /** Surface id when an AtlasSurface ancestor is in scope. */
  surfaceId?: string;
  /** Optional correlation id; surfaces can set this on themselves. */
  correlationId?: string;
  /** Optional tenant id; not yet plumbed end-to-end on the FE. */
  tenantId?: string;
  /**
   * Anything else the caller passed to emit() or the framework added. Typed
   * as `unknown` because telemetry payloads are heterogeneous; sinks treat
   * extra fields as opaque JSON.
   */
  [key: string]: unknown;
}

export interface TelemetrySink {
  write(event: TelemetryEvent): void;
  /** Synchronous best-effort flush. Called on pagehide / beforeunload. */
  flushSync?(): void;
}

class NullSink implements TelemetrySink {
  write(): void {}
}

/**
 * Dev-only sink that mirrors the legacy `console.debug('[telemetry]', obj)`
 * shape so existing Playwright `telemetrySpy` fixtures keep working.
 *
 * Not safe for prod: console writes are sync, format-stripped by ad blockers,
 * and not shipped anywhere.
 */
export class ConsoleJsonSink implements TelemetrySink {
  write(event: TelemetryEvent): void {
    // eslint-disable-next-line no-console -- dev-only sink; see file header
    console.debug('[telemetry]', event);
  }
}

export interface BeaconHttpSinkOptions {
  /** POST target. Typically `/atlas/telemetry` on apps/server. */
  endpoint: string;
  /** Max events buffered before forced flush. Default 32. */
  maxBatch?: number;
  /** Max ms an event sits in the buffer before flush. Default 2000. */
  flushIntervalMs?: number;
  /** Override fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

/**
 * Production sink: buffers events and POSTs them in batches. Falls back to
 * `navigator.sendBeacon` on pagehide so the last batch survives a tab close.
 *
 * Apps wire this at boot once they have an ingestion endpoint:
 *   setTelemetrySink(new BeaconHttpSink({ endpoint: '/atlas/telemetry' }));
 */
export class BeaconHttpSink implements TelemetrySink {
  private readonly endpoint: string;
  private readonly maxBatch: number;
  private readonly flushIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private buffer: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: BeaconHttpSinkOptions) {
    this.endpoint = opts.endpoint;
    this.maxBatch = opts.maxBatch ?? 32;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.fetchImpl =
      opts.fetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (() => {
            throw new Error('BeaconHttpSink: no fetch available');
          }) as unknown as typeof fetch);

    if (typeof window !== 'undefined') {
      // pagehide is the reliable terminal event on mobile + desktop.
      window.addEventListener('pagehide', () => this.flushSync());
    }
  }

  write(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBatch) {
      this.flushAsync();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flushAsync(), this.flushIntervalMs);
    }
  }

  flushSync(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.clearTimer();

    const body = JSON.stringify({ events: batch });
    // sendBeacon is the only way to reliably ship on pagehide.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(this.endpoint, blob);
        return;
      } catch {
        // fall through to fetch
      }
    }
    // Best-effort fetch; we can't await on a sync flush path.
    try {
      void this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    } catch {
      // swallow — we cannot let telemetry break the page.
    }
  }

  private flushAsync(): void {
    if (this.buffer.length === 0) {
      this.clearTimer();
      return;
    }
    const batch = this.buffer;
    this.buffer = [];
    this.clearTimer();

    void this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => {
      // swallow — telemetry must never throw on the hot path.
    });
  }

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// Vite folds `import.meta.env.DEV` to a boolean literal; this expression
// becomes `false` in prod bundles. The outer guard keeps the module
// importable from plain Node tools where `import.meta.env` is undefined.
const metaEnv: ImportMetaEnv | undefined = (import.meta as { env?: ImportMetaEnv }).env;
const DEV_MODE: boolean = !!(metaEnv && metaEnv.DEV === true);

let _sink: TelemetrySink = DEV_MODE ? new ConsoleJsonSink() : new NullSink();

/**
 * Replace the active telemetry sink. Call once at app boot.
 * Pass `null` to reset to the no-op sink.
 */
export function setTelemetrySink(sink: TelemetrySink | null): void {
  _sink = sink ?? new NullSink();
}

/** Current sink — exposed mainly for tests. */
export function getTelemetrySink(): TelemetrySink {
  return _sink;
}

/**
 * Emit a telemetry event. Stamps `timestamp` if missing and forwards to the
 * active sink. Never throws — telemetry must not break the page.
 */
export function emitTelemetry(event: Omit<TelemetryEvent, 'timestamp'> & { timestamp?: string }): void {
  const stamped: TelemetryEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  } as TelemetryEvent;
  try {
    _sink.write(stamped);
  } catch {
    // A broken sink must not crash the caller.
  }
}

/** True iff running in a Vite dev build. Used to decide rethrow vs. swallow. */
export function isDevMode(): boolean {
  return DEV_MODE;
}
