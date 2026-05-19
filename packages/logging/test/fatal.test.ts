import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { ConsoleJsonSink, InMemoryLevelController, LogPipeline, createRootContext, } from '../src/index.ts';
import type { LogEvent } from '../src/index.ts';
class CapturingStream extends Writable {
    public chunks: string[] = [];
    override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
        this.chunks.push(chunk.toString());
        cb();
    }
    text(): string {
        return this.chunks.join('');
    }
    records(): LogEvent[] {
        return this.text()
            .split('\n')
            .filter(function (l) {
            return l.length > 0;
        })
            .map(function (l) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: test-only JSON line reader; each line is produced by ConsoleJsonSink which writes a serialized LogEvent shape (its on-the-wire format is the very contract under test here).
            return JSON.parse(l) as LogEvent;
        });
    }
}
describe('ctx.logger.fatal', function () {
    it('flushes any buffered events synchronously before returning', function () {
        const stream = new CapturingStream();
        const pipeline = new LogPipeline([new ConsoleJsonSink({ stream })], new InMemoryLevelController('debug'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 't',
            principalId: 'p',
            environment: 'test',
            incomingCorrelationId: 'corr-fatal-1',
        });
        ctx.logger.info('a');
        ctx.logger.info('b');
        ctx.logger.info('c');
        expect(stream.chunks).toHaveLength(0); // nothing flushed yet
        ctx.logger.fatal('boom');
        // After fatal returns synchronously, all four events are on the wire.
        const records = stream.records();
        expect(records.map(function (r) {
            return r.message;
        })).toEqual(['a', 'b', 'c', 'boom']);
        expect(assertDefined(records[3], 'records[3] after 4 emits').level).toBe('fatal');
    });
    it('bypasses level filtering — emits even when level controller is at fatal', function () {
        const stream = new CapturingStream();
        const pipeline = new LogPipeline([new ConsoleJsonSink({ stream })], new InMemoryLevelController('fatal'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 't',
            principalId: 'p',
            environment: 'test',
        });
        ctx.logger.error('error — dropped at this level');
        ctx.logger.fatal('emitted');
        const records = stream.records();
        expect(records.map(function (r) {
            return r.level;
        })).toEqual(['fatal']);
    });
    it('emitted fatal record carries correlationId and ctx fields', function () {
        const stream = new CapturingStream();
        const pipeline = new LogPipeline([new ConsoleJsonSink({ stream })], new InMemoryLevelController('debug'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 'acme',
            principalId: 'u-1',
            environment: 'test',
            incomingCorrelationId: 'corr-fatal-stamp',
        }).withModule('boot');
        ctx.logger.fatal('control plane unreachable', {
            error: { code: 'BOOT_FAILED', message: 'connect ECONNREFUSED' },
        });
        const r = assertDefined(stream.records()[0], 'records[0] after fatal emit');
        expect(r.tenantId).toBe('acme');
        expect(r.principalId).toBe('u-1');
        expect(r.correlationId).toBe('corr-fatal-stamp');
        expect(r.moduleId).toBe('boot');
        expect(r.error).toEqual({ code: 'BOOT_FAILED', message: 'connect ECONNREFUSED' });
    });
});
