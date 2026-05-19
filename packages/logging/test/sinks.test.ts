import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { CollectorSink, ConsoleJsonSink, MemoryRingBufferSink, } from '../src/index.ts';
import type { LogEvent, LogLevel } from '../src/index.ts';
class CapturingStream extends Writable {
    public chunks: string[] = [];
    override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
        this.chunks.push(chunk.toString());
        cb();
    }
    text(): string {
        return this.chunks.join('');
    }
}
function makeEvent(level: LogLevel, msg: string, correlationId = 'c'): LogEvent {
    return {
        timestamp: new Date().toISOString(),
        level,
        message: msg,
        tenantId: 't',
        principalId: 'p',
        correlationId,
        traceId: correlationId,
        spanId: 's',
    };
}
describe('CollectorSink', function () {
    it('collects every event in order, no drops', function () {
        const sink = new CollectorSink();
        for (let i = 0; i < 100; i++)
            sink.write(makeEvent('debug', `d${i}`));
        expect(sink.events).toHaveLength(100);
        expect(assertDefined(sink.events[0], 'events[0] exists (length asserted 100)').message).toBe('d0');
        expect(assertDefined(sink.events[99], 'events[99] exists (length asserted 100)').message).toBe('d99');
    });
    it('reset() empties the collector', function () {
        const sink = new CollectorSink();
        sink.write(makeEvent('info', 'x'));
        expect(sink.events).toHaveLength(1);
        sink.reset();
        expect(sink.events).toHaveLength(0);
    });
});
describe('MemoryRingBufferSink', function () {
    it('respects capacity; oldest are overwritten by newest', function () {
        const sink = new MemoryRingBufferSink({ capacity: 3 });
        sink.write(makeEvent('info', 'a'));
        sink.write(makeEvent('info', 'b'));
        sink.write(makeEvent('info', 'c'));
        sink.write(makeEvent('info', 'd')); // overwrites 'a'
        sink.write(makeEvent('info', 'e')); // overwrites 'b'
        const recent = sink.recent();
        expect(recent.map(function (e) {
            return e.message;
        })).toEqual(['e', 'd', 'c']);
    });
    it('recent() respects limit', function () {
        const sink = new MemoryRingBufferSink({ capacity: 100 });
        for (let i = 0; i < 10; i++)
            sink.write(makeEvent('info', `i${i}`));
        expect(sink.recent(3).map(function (e) {
            return e.message;
        })).toEqual(['i9', 'i8', 'i7']);
    });
    it('getByCorrelationId filters by correlationId', function () {
        const sink = new MemoryRingBufferSink({ capacity: 100 });
        sink.write(makeEvent('info', 'one', 'corr-A'));
        sink.write(makeEvent('info', 'two', 'corr-B'));
        sink.write(makeEvent('info', 'three', 'corr-A'));
        sink.write(makeEvent('info', 'four', 'corr-A'));
        const matchA = sink.getByCorrelationId('corr-A');
        expect(matchA.map(function (e) {
            return e.message;
        })).toEqual(['four', 'three', 'one']);
        const matchB = sink.getByCorrelationId('corr-B');
        expect(matchB.map(function (e) {
            return e.message;
        })).toEqual(['two']);
    });
    it('size() reflects current population', function () {
        const sink = new MemoryRingBufferSink({ capacity: 5 });
        expect(sink.size()).toBe(0);
        sink.write(makeEvent('info', 'a'));
        sink.write(makeEvent('info', 'b'));
        expect(sink.size()).toBe(2);
        for (let i = 0; i < 10; i++)
            sink.write(makeEvent('info', `x${i}`));
        expect(sink.size()).toBe(5); // capped
    });
    it('clear() empties the buffer', function () {
        const sink = new MemoryRingBufferSink({ capacity: 5 });
        sink.write(makeEvent('info', 'a'));
        sink.clear();
        expect(sink.size()).toBe(0);
        expect(sink.recent()).toHaveLength(0);
    });
    it('rejects capacity <= 0', function () {
        expect(function () {
            return new MemoryRingBufferSink({ capacity: 0 });
        }).toThrow();
        expect(function () {
            return new MemoryRingBufferSink({ capacity: -1 });
        }).toThrow();
    });
});
describe('ConsoleJsonSink format', function () {
    it('emits one JSON object per line, valid JSON', async function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream });
        sink.write(makeEvent('info', 'one'));
        sink.write(makeEvent('info', 'two'));
        await new Promise<void>(function (r) {
            return setImmediate(r);
        });
        const lines = stream.text().split('\n').filter(function (l) {
            return l.length > 0;
        });
        expect(lines).toHaveLength(2);
        for (const line of lines) {
            expect(function () {
                // Discarding the parse result; this scenario only asserts that
                // the on-the-wire form is syntactically valid JSON.
                JSON.parse(line);
            }).not.toThrow();
        }
    });
    it('batches multiple writes into one stream.write call', async function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream });
        for (let i = 0; i < 50; i++)
            sink.write(makeEvent('info', `i${i}`));
        expect(stream.chunks).toHaveLength(0); // nothing yet
        await new Promise<void>(function (r) {
            return setImmediate(r);
        });
        // 50 events but ONE chunk — that's the batching guarantee.
        expect(stream.chunks).toHaveLength(1);
        const chunk = assertDefined(stream.chunks[0], 'chunks[0] exists (length asserted 1)');
        const lines = chunk.split('\n').filter(function (l) {
            return l.length > 0;
        });
        expect(lines).toHaveLength(50);
    });
});
