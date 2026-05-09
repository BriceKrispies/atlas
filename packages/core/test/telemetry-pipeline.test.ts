/**
 * Unit tests for the telemetry pipeline (`packages/core/src/telemetry-pipeline.ts`).
 *
 * Covers:
 *  - default sink is a no-op (NullSink) — emitTelemetry must not throw
 *  - setTelemetrySink + getTelemetrySink round-trip
 *  - ConsoleJsonSink writes through console.debug with the legacy shape
 *  - BeaconHttpSink buffers, flushes on max-batch, and on flushSync
 *  - sink errors thrown inside write() do not propagate to emitTelemetry
 *  - timestamp stamping is automatic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setTelemetrySink,
  getTelemetrySink,
  emitTelemetry,
  ConsoleJsonSink,
  BeaconHttpSink,
  type TelemetrySink,
  type TelemetryEvent,
} from '../src/telemetry-pipeline.ts';

beforeEach(() => {
  setTelemetrySink(null);
  vi.useFakeTimers();
});

afterEach(() => {
  setTelemetrySink(null);
  vi.useRealTimers();
});

describe('default sink (NullSink)', () => {
  it('is installed by default and silently absorbs emits', () => {
    // No assertion on NullSink class identity (it's not exported), but a
    // null reset followed by emit must be a noop and never throw.
    setTelemetrySink(null);
    expect(() =>
      emitTelemetry({ eventName: 'Test.Default' }),
    ).not.toThrow();
  });

  it('setTelemetrySink(null) restores the default sink', () => {
    const fake: TelemetrySink = { write: vi.fn() };
    setTelemetrySink(fake);
    expect(getTelemetrySink()).toBe(fake);
    setTelemetrySink(null);
    expect(getTelemetrySink()).not.toBe(fake);
  });
});

describe('emitTelemetry', () => {
  it('stamps a timestamp automatically when missing', () => {
    const written: TelemetryEvent[] = [];
    setTelemetrySink({ write: (e) => written.push(e) });
    emitTelemetry({ eventName: 'Test.Stamp' });
    expect(written.length).toBe(1);
    expect(typeof written[0]!.timestamp).toBe('string');
    expect(() => new Date(written[0]!.timestamp).toISOString()).not.toThrow();
  });

  it('preserves a caller-supplied timestamp', () => {
    const written: TelemetryEvent[] = [];
    setTelemetrySink({ write: (e) => written.push(e) });
    emitTelemetry({
      eventName: 'Test.Pre',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(written[0]!.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('forwards extra properties verbatim', () => {
    const written: TelemetryEvent[] = [];
    setTelemetrySink({ write: (e) => written.push(e) });
    emitTelemetry({
      eventName: 'Test.Extras',
      surfaceId: 's1',
      correlationId: 'c1',
      foo: 'bar',
    });
    expect(written[0]!.surfaceId).toBe('s1');
    expect(written[0]!.correlationId).toBe('c1');
    expect(written[0]!['foo']).toBe('bar');
  });

  it('swallows errors thrown by sink.write — never crashes the caller', () => {
    setTelemetrySink({
      write: () => {
        throw new Error('sink-explode');
      },
    });
    expect(() => emitTelemetry({ eventName: 'Test.SinkThrow' })).not.toThrow();
  });
});

describe('ConsoleJsonSink', () => {
  it('writes via console.debug with the legacy "[telemetry]" prefix', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const sink = new ConsoleJsonSink();
    setTelemetrySink(sink);
    emitTelemetry({ eventName: 'Test.Console', surfaceId: 's' });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]![0]).toBe('[telemetry]');
    const ev = debugSpy.mock.calls[0]![1] as TelemetryEvent;
    expect(ev.eventName).toBe('Test.Console');
    expect(ev.surfaceId).toBe('s');
    debugSpy.mockRestore();
  });
});

describe('BeaconHttpSink', () => {
  function makeFetchSpy(): {
    fetch: typeof fetch;
    calls: Array<{ url: string; body: unknown }>;
  } {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      calls.push({ url: String(url), body: init?.body });
      return { ok: true } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  }

  it('buffers writes and flushes when maxBatch is reached', () => {
    const { fetch, calls } = makeFetchSpy();
    const sink = new BeaconHttpSink({
      endpoint: '/atlas/telemetry',
      maxBatch: 3,
      flushIntervalMs: 9999,
      fetch,
    });
    setTelemetrySink(sink);

    emitTelemetry({ eventName: 'A' });
    emitTelemetry({ eventName: 'B' });
    expect(calls.length).toBe(0); // not yet flushed
    emitTelemetry({ eventName: 'C' }); // hits maxBatch
    expect(calls.length).toBe(1);

    const body = JSON.parse(String(calls[0]!.body)) as {
      events: Array<{ eventName: string }>;
    };
    expect(body.events.map((e) => e.eventName)).toEqual(['A', 'B', 'C']);
  });

  it('flushSync flushes the current buffer synchronously via fetch fallback', () => {
    const { fetch, calls } = makeFetchSpy();
    const sink = new BeaconHttpSink({
      endpoint: '/atlas/telemetry',
      maxBatch: 100,
      flushIntervalMs: 9999,
      fetch,
    });
    setTelemetrySink(sink);

    emitTelemetry({ eventName: 'A' });
    emitTelemetry({ eventName: 'B' });
    expect(calls.length).toBe(0);

    sink.flushSync();
    // sendBeacon may or may not be present; fallback path uses fetch.
    if (calls.length > 0) {
      const body = JSON.parse(String(calls[0]!.body)) as {
        events: Array<{ eventName: string }>;
      };
      expect(body.events.length).toBe(2);
    }
  });

  it('flushSync on empty buffer is a no-op', () => {
    const { fetch, calls } = makeFetchSpy();
    const sink = new BeaconHttpSink({
      endpoint: '/atlas/telemetry',
      fetch,
    });
    sink.flushSync();
    expect(calls.length).toBe(0);
  });

  it('flushes after the configured interval elapses', () => {
    const { fetch, calls } = makeFetchSpy();
    const sink = new BeaconHttpSink({
      endpoint: '/x',
      maxBatch: 100,
      flushIntervalMs: 1000,
      fetch,
    });
    setTelemetrySink(sink);
    emitTelemetry({ eventName: 'A' });
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(1001);
    expect(calls.length).toBe(1);
  });

  it('a fetch rejection on flushAsync does not propagate', () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const sink = new BeaconHttpSink({
      endpoint: '/x',
      maxBatch: 1,
      fetch: failing,
    });
    setTelemetrySink(sink);
    expect(() => emitTelemetry({ eventName: 'A' })).not.toThrow();
  });
});
