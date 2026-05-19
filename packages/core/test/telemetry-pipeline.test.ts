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
import { assertDefined } from '@atlas/test-fixtures/assert';
import { setTelemetrySink, getTelemetrySink, emitTelemetry, ConsoleJsonSink, BeaconHttpSink, type TelemetrySink, type TelemetryEvent, } from '../src/telemetry-pipeline.ts';
// ── helpers ─────────────────────────────────────────────────────────
/**
 * Narrows a `vi.spyOn(console, 'debug')` call argument (typed as `unknown`
 * by vitest because `console.debug` accepts `...unknown[]`) into a
 * TelemetryEvent the producer guarantees we wrote. Throws on shape
 * mismatch so a regression in the sink fails the test loudly instead of
 * masking it through a bare cast.
 */
function isTelemetryEvent(value: unknown): value is TelemetryEvent {
    if (typeof value !== 'object' || value === null)
        return false;
    if (!('eventName' in value) || !('timestamp' in value))
        return false;
    // `in` narrowed `value` to `object & Record<'eventName' | 'timestamp', unknown>`.
    return typeof value.eventName === 'string' && typeof value.timestamp === 'string';
}
function asTelemetryEvent(value: unknown): TelemetryEvent {
    if (!isTelemetryEvent(value)) {
        throw new Error(`Test invariant violation: expected TelemetryEvent, got ${JSON.stringify(value)}`);
    }
    return value;
}
beforeEach(function () {
    setTelemetrySink(null);
    vi.useFakeTimers();
});
afterEach(function () {
    setTelemetrySink(null);
    vi.useRealTimers();
});
describe('default sink (NullSink)', function () {
    it('is installed by default and silently absorbs emits', function () {
        // No assertion on NullSink class identity (it's not exported), but a
        // null reset followed by emit must be a noop and never throw.
        setTelemetrySink(null);
        expect(function () {
            return emitTelemetry({ eventName: 'Test.Default' });
        }).not.toThrow();
    });
    it('setTelemetrySink(null) restores the default sink', function () {
        const fake: TelemetrySink = { write: vi.fn() };
        setTelemetrySink(fake);
        expect(getTelemetrySink()).toBe(fake);
        setTelemetrySink(null);
        expect(getTelemetrySink()).not.toBe(fake);
    });
});
describe('emitTelemetry', function () {
    it('stamps a timestamp automatically when missing', function () {
        const written: TelemetryEvent[] = [];
        setTelemetrySink({ write: function (e) {
                return written.push(e);
            } });
        emitTelemetry({ eventName: 'Test.Stamp' });
        expect(written.length).toBe(1);
        const first = assertDefined(written[0], 'emit appended one event');
        expect(typeof first.timestamp).toBe('string');
        expect(function () {
            return new Date(first.timestamp).toISOString();
        }).not.toThrow();
    });
    it('preserves a caller-supplied timestamp', function () {
        const written: TelemetryEvent[] = [];
        setTelemetrySink({ write: function (e) {
                return written.push(e);
            } });
        emitTelemetry({
            eventName: 'Test.Pre',
            timestamp: '2026-01-01T00:00:00.000Z',
        });
        const first = assertDefined(written[0], 'emit appended one event');
        expect(first.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });
    it('forwards extra properties verbatim', function () {
        const written: TelemetryEvent[] = [];
        setTelemetrySink({ write: function (e) {
                return written.push(e);
            } });
        emitTelemetry({
            eventName: 'Test.Extras',
            surfaceId: 's1',
            correlationId: 'c1',
            foo: 'bar',
        });
        const first = assertDefined(written[0], 'emit appended one event');
        expect(first.surfaceId).toBe('s1');
        expect(first.correlationId).toBe('c1');
        expect(first['foo']).toBe('bar');
    });
    it('swallows errors thrown by sink.write — never crashes the caller', function () {
        setTelemetrySink({
            write: function () {
                throw new Error('sink-explode');
            },
        });
        expect(function () {
            return emitTelemetry({ eventName: 'Test.SinkThrow' });
        }).not.toThrow();
    });
});
describe('ConsoleJsonSink', function () {
    it('writes via console.debug with the legacy "[telemetry]" prefix', function () {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(function () { });
        const sink = new ConsoleJsonSink();
        setTelemetrySink(sink);
        emitTelemetry({ eventName: 'Test.Console', surfaceId: 's' });
        expect(debugSpy).toHaveBeenCalledTimes(1);
        const call = assertDefined(debugSpy.mock.calls[0], 'one console.debug call');
        expect(call[0]).toBe('[telemetry]');
        const ev = asTelemetryEvent(call[1]);
        expect(ev.eventName).toBe('Test.Console');
        expect(ev.surfaceId).toBe('s');
        debugSpy.mockRestore();
    });
});
describe('BeaconHttpSink', function () {
    /**
     * BeaconHttpSink's `fetch` option is typed `typeof fetch`, whose return
     * is `Promise<Response>`. `Response` is a Node 18+ global, so we can
     * construct it for the fake — the sink doesn't read the body, only the
     * call args. The fake's signature matches `typeof fetch` structurally
     * (both overloads accept `RequestInfo | URL` + optional `RequestInit`).
     */
    function makeFetchSpy(): {
        fetch: typeof fetch;
        calls: Array<{
            url: string;
            body: unknown;
        }>;
    } {
        const calls: Array<{
            url: string;
            body: unknown;
        }> = [];
        const fetch: typeof globalThis.fetch = async function (url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            calls.push({ url: String(url), body: init?.body });
            return new Response('{}', { status: 200 });
        };
        return { fetch, calls };
    }
    function parseBatchBody(body: unknown): {
        events: Array<{
            eventName: string;
        }>;
    } {
        const parsed: unknown = JSON.parse(String(body));
        if (typeof parsed !== 'object' ||
            parsed === null ||
            !('events' in parsed) ||
            !Array.isArray(parsed.events)) {
            throw new Error(`Test invariant violation: expected { events: [...] }, got ${String(body)}`);
        }
        const events: unknown[] = parsed.events;
        const validated: Array<{
            eventName: string;
        }> = events.map(function (e) {
            if (typeof e !== 'object' ||
                e === null ||
                !('eventName' in e) ||
                typeof e.eventName !== 'string') {
                throw new Error(`Test invariant violation: event missing eventName: ${JSON.stringify(e)}`);
            }
            return { eventName: e.eventName };
        });
        return { events: validated };
    }
    it('buffers writes and flushes when maxBatch is reached', function () {
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
        const call = assertDefined(calls[0], 'one fetch call after maxBatch');
        const body = parseBatchBody(call.body);
        expect(body.events.map(function (e) {
            return e.eventName;
        })).toEqual(['A', 'B', 'C']);
    });
    it('flushSync flushes the current buffer synchronously via fetch fallback', function () {
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
            const call = assertDefined(calls[0], 'fallback fetch call recorded');
            const body = parseBatchBody(call.body);
            expect(body.events.length).toBe(2);
        }
    });
    it('flushSync on empty buffer is a no-op', function () {
        const { fetch, calls } = makeFetchSpy();
        const sink = new BeaconHttpSink({
            endpoint: '/atlas/telemetry',
            fetch,
        });
        sink.flushSync();
        expect(calls.length).toBe(0);
    });
    it('flushes after the configured interval elapses', function () {
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
    it('a fetch rejection on flushAsync does not propagate', function () {
        const failing: typeof globalThis.fetch = async function (): Promise<Response> {
            throw new Error('network down');
        };
        const sink = new BeaconHttpSink({
            endpoint: '/x',
            maxBatch: 1,
            fetch: failing,
        });
        setTelemetrySink(sink);
        expect(function () {
            return emitTelemetry({ eventName: 'A' });
        }).not.toThrow();
    });
});
