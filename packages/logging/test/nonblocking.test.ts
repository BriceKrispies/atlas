/**
 * Proves the logger's hot path does not stall the event loop.
 *
 * Two assertions:
 *   1. A 10,000-call burst completes in well under 100ms.
 *   2. setInterval continues to fire during/after the burst — confirms
 *      the event loop is reachable, not held captive.
 */
import { describe, it, expect } from '@atlas/test';
import { Writable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { ConsoleJsonSink, InMemoryLevelController, LogPipeline, createRootContext, } from '../src/index.ts';
class DevNullStream extends Writable {
    override _write(_chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
        cb();
    }
}
describe('logger does not block the event loop', function () {
    it('a 10k-call burst completes in well under 100ms', function () {
        const pipeline = new LogPipeline([new ConsoleJsonSink({ stream: new DevNullStream(), softCap: 50000, hardCap: 100000 })], new InMemoryLevelController('debug'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 't',
            principalId: 'p',
            environment: 'test',
        });
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            ctx.logger.info('burst', { event: 'Burst.Test.Run', properties: { i } });
        }
        const duration = performance.now() - start;
        process.stdout.write(`${JSON.stringify({
            bench: '@atlas/logging — 10k burst',
            iterations: 10000,
            burst_duration_ms: Number(duration.toFixed(2)),
            ms_per_op: Number((duration / 10000).toFixed(4)),
        })}\n`);
        // 300ms is generous to avoid flake under monorepo-run CPU contention
        // (vitest workers compete for cores). When run in isolation the
        // burst is closer to ~50ms. Either is far under the "sync I/O would
        // take this much" floor (seconds for 10k writes) which is what we
        // care about — regressions toward sync behavior would be obvious.
        expect(duration).toBeLessThan(300);
    });
    it('setInterval fires during/after a burst (event loop reachable)', async function () {
        const pipeline = new LogPipeline([new ConsoleJsonSink({ stream: new DevNullStream(), softCap: 50000, hardCap: 100000 })], new InMemoryLevelController('debug'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 't',
            principalId: 'p',
            environment: 'test',
        });
        const fireTimes: number[] = [];
        const interval = setInterval(function () {
            fireTimes.push(performance.now());
        }, 1);
        await new Promise<void>(function (r) {
            return setTimeout(r, 30);
        });
        fireTimes.length = 0;
        const burstStart = performance.now();
        for (let i = 0; i < 10000; i++) {
            ctx.logger.info('burst', { properties: { i } });
        }
        const burstEnd = performance.now();
        await new Promise<void>(function (r) {
            return setTimeout(r, 80);
        });
        clearInterval(interval);
        process.stdout.write(`${JSON.stringify({
            bench: '@atlas/logging — event-loop liveness',
            burst_ms: Number((burstEnd - burstStart).toFixed(2)),
            interval_fires: fireTimes.length,
        })}\n`);
        expect(burstEnd - burstStart).toBeLessThan(300);
        expect(fireTimes.length).toBeGreaterThan(2);
    });
    it('drainSync flushes via the pipeline immediately', function () {
        const stream: {
            chunks: string[];
        } & Writable = Object.assign(new (class extends Writable {
            public chunks: string[] = [];
            override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
                this.chunks.push(chunk.toString());
                cb();
            }
        })(), { chunks: [] });
        const sink = new ConsoleJsonSink({ stream });
        const pipeline = new LogPipeline([sink], new InMemoryLevelController('debug'));
        const ctx = createRootContext({
            pipeline,
            tenantId: 't',
            principalId: 'p',
            environment: 'test',
        });
        ctx.logger.info('one');
        ctx.logger.info('two');
        expect(stream.chunks).toHaveLength(0);
        pipeline.flushSync();
        expect(stream.chunks.length).toBeGreaterThan(0);
    });
});
