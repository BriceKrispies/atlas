import { describe, it, expect } from '@atlas/test';
import { Writable } from 'node:stream';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { ConsoleJsonSink } from '../src/index.ts';
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
    lines(): string[] {
        return this.text().split('\n').filter(function (l) {
            return l.length > 0;
        });
    }
    records(): LogEvent[] {
        return this.lines().map(function (l) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: test-only JSON line reader; each line is produced by ConsoleJsonSink which writes a serialized LogEvent shape (its on-the-wire format is the very contract under test here).
            return JSON.parse(l) as LogEvent;
        });
    }
    reset(): void {
        this.chunks = [];
    }
}
function makeEvent(level: LogLevel, msg: string): LogEvent {
    return {
        timestamp: new Date().toISOString(),
        level,
        message: msg,
        tenantId: 't',
        principalId: 'p',
        correlationId: 'c',
        traceId: 'c',
        spanId: 's',
    };
}
async function flushImmediates(): Promise<void> {
    await new Promise<void>(function (r) {
        return setImmediate(r);
    });
}
describe('ConsoleJsonSink overflow policy', function () {
    it('drops oldest debug first when soft cap is exceeded', async function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 4, hardCap: 6 });
        // Fill: 4 debugs (soft cap reached). 5th debug pushes over → evict oldest debug.
        for (let i = 0; i < 5; i++)
            sink.write(makeEvent('debug', `d${i}`));
        expect(sink.droppedCounts().debug).toBe(1);
        expect(sink.bufferedCount()).toBe(4);
        await flushImmediates();
        // 4 debugs survive (d1..d4); plus one overflow report meta-log (warn).
        const records = stream.records();
        const debugRecords = records.filter(function (r) {
            return r.level === 'debug';
        });
        expect(debugRecords.map(function (r) {
            return r.message;
        })).toEqual(['d1', 'd2', 'd3', 'd4']);
        const overflowRecords = records.filter(function (r) {
            return r.eventName === 'Logging.BufferOverflow.Dropped';
        });
        expect(overflowRecords).toHaveLength(1);
    });
    it('drops oldest info next when no debugs and past hard cap', async function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 3, hardCap: 5 });
        // Fill with infos. softCap=3, so the 4th + 5th + 6th calls each push the
        // buffer over softCap. With no debugs to evict, eviction only happens
        // once buffer >= hardCap (5).
        for (let i = 0; i < 7; i++)
            sink.write(makeEvent('info', `i${i}`));
        // Exactly the events above hardCap-1 should have evicted infos.
        expect(sink.droppedCounts().info).toBeGreaterThan(0);
        expect(sink.droppedCounts().debug).toBe(0);
    });
    it('never drops warn / error / fatal — buffer can grow past hardCap with them', function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 3, hardCap: 5 });
        for (let i = 0; i < 20; i++)
            sink.write(makeEvent('warn', `w${i}`));
        // Despite the cap, no warns were dropped.
        expect(sink.droppedCounts().warn).toBe(0);
        expect(sink.bufferedCount()).toBe(20);
    });
    it('emits an overflow report meta-log on next drain (warn level)', async function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 2, hardCap: 4 });
        sink.write(makeEvent('debug', 'd1'));
        sink.write(makeEvent('debug', 'd2'));
        sink.write(makeEvent('debug', 'd3')); // evicts d1
        await flushImmediates();
        const records = stream.records();
        const overflow = assertDefined(records.find(function (r) {
            return r.eventName === 'Logging.BufferOverflow.Dropped';
        }), 'overflow record must be present after the eviction sequence above');
        expect(overflow.level).toBe('warn');
        const props = assertDefined(overflow.properties, 'overflow record carries the droppedInWindow properties bag');
        expect(props['droppedInWindow']).toMatchObject({ debug: 1 });
    });
    it('flushSync flushes buffered events synchronously', function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 100, hardCap: 200 });
        sink.write(makeEvent('info', 'i1'));
        sink.write(makeEvent('info', 'i2'));
        expect(stream.chunks).toHaveLength(0); // not yet drained
        sink.flushSync();
        expect(stream.records()).toHaveLength(2);
    });
    it('fatal forces a sync flush + sync write of the fatal event', function () {
        const stream = new CapturingStream();
        const sink = new ConsoleJsonSink({ stream, softCap: 100, hardCap: 200 });
        sink.write(makeEvent('info', 'before'));
        expect(stream.chunks).toHaveLength(0);
        sink.write(makeEvent('fatal', 'kaboom'));
        // After the fatal call returns, both records are on the wire.
        const records = stream.records();
        expect(records.map(function (r) {
            return r.message;
        })).toEqual(['before', 'kaboom']);
    });
});
