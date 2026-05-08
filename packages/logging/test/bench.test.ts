/**
 * Microbenchmarks with hard ns/op thresholds.
 *
 * Proves the context-first hot path is fast enough for production. The
 * full pipeline does: level resolve → buildLogEvent (object construct +
 * redaction walk on properties) → dispatch → CollectorSink push.
 *
 * Bench numbers print to stdout via process.stdout.write so they show up
 * in CI output. Hard threshold of 10 µs/op is generous enough to survive
 * on slow CI runners while still catching real regressions.
 */

import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import {
  CollectorSink,
  ConsoleJsonSink,
  InMemoryLevelController,
  LogPipeline,
  createRootContext,
} from '../src/index.ts';

const ITERATIONS = 100_000;
const WARMUP = 1_000;

function bench(fn: () => void): { ns_per_op: number; total_ms: number } {
  for (let i = 0; i < WARMUP; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const end = process.hrtime.bigint();
  const total_ns = Number(end - start);
  return {
    ns_per_op: total_ns / ITERATIONS,
    total_ms: total_ns / 1_000_000,
  };
}

class DevNullStream extends Writable {
  override _write(
    _chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    cb();
  }
}

describe('logger performance — hot path', () => {
  it('ctx.logger.info < 10 µs/op (hot path; CollectorSink, no JSON.stringify)', () => {
    const collector = new CollectorSink();
    const pipeline = new LogPipeline([collector], new InMemoryLevelController('debug'));
    const ctx = createRootContext({
      pipeline,
      tenantId: 't',
      principalId: 'p',
      environment: 'test',
    });

    const result = bench(() => {
      ctx.logger.info('bench', { event: 'Bench.Run', properties: { n: 1 } });
    });

    process.stdout.write(
      `${JSON.stringify({
        bench: '@atlas/logging — ctx.logger.info hot path (CollectorSink)',
        iterations: ITERATIONS,
        ns_per_op: Number(result.ns_per_op.toFixed(2)),
        total_ms: Number(result.total_ms.toFixed(2)),
      })}\n`,
    );

    expect(result.ns_per_op).toBeLessThan(10_000);
  });

  it('full pipeline including JSON.stringify < 25 µs/op (ConsoleJsonSink → /dev/null)', () => {
    const stream = new DevNullStream();
    // Caps bumped beyond the bench's iteration count so we measure the
    // steady-state happy path. Overflow eviction is O(n)-per-call by
    // design (splice-based) and has its own perf characteristics —
    // tested in overflow.test.ts.
    const pipeline = new LogPipeline(
      [new ConsoleJsonSink({ stream, softCap: 200_000, hardCap: 300_000 })],
      new InMemoryLevelController('debug'),
    );
    const ctx = createRootContext({
      pipeline,
      tenantId: 't',
      principalId: 'p',
      environment: 'test',
    });

    const result = bench(() => {
      ctx.logger.info('bench', { event: 'Bench.Run', properties: { n: 1 } });
    });

    process.stdout.write(
      `${JSON.stringify({
        bench: '@atlas/logging — ctx.logger.info full pipeline (ConsoleJsonSink → /dev/null)',
        iterations: ITERATIONS,
        ns_per_op: Number(result.ns_per_op.toFixed(2)),
        total_ms: Number(result.total_ms.toFixed(2)),
      })}\n`,
    );

    // Stringification adds cost; threshold accounts for that.
    expect(result.ns_per_op).toBeLessThan(25_000);
  });

  it('filtered call returns in under 1 µs (early-exit path)', () => {
    const collector = new CollectorSink();
    // Set level to fatal so debug/info/warn/error are all filtered.
    const pipeline = new LogPipeline([collector], new InMemoryLevelController('fatal'));
    const ctx = createRootContext({
      pipeline,
      tenantId: 't',
      principalId: 'p',
      environment: 'test',
    });

    const result = bench(() => {
      ctx.logger.info('filtered', { properties: { n: 1 } });
    });

    process.stdout.write(
      `${JSON.stringify({
        bench: '@atlas/logging — filtered (level=fatal)',
        iterations: ITERATIONS,
        ns_per_op: Number(result.ns_per_op.toFixed(2)),
      })}\n`,
    );

    expect(result.ns_per_op).toBeLessThan(1_000);
    expect(collector.events).toHaveLength(0);
  });
});
