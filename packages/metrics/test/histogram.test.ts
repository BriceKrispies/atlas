import { describe, test, expect } from 'vitest';
import { Histogram, MetricsLabelError } from '@atlas/metrics';

describe('Histogram', () => {
  test('rejects empty buckets', () => {
    expect(
      () =>
        new Histogram({
          name: 'h',
          help: 'h',
          buckets: [],
        }),
    ).toThrow(/non-empty/);
  });

  test('rejects non-monotonic buckets', () => {
    expect(
      () =>
        new Histogram({
          name: 'h',
          help: 'h',
          buckets: [1, 1, 2],
        }),
    ).toThrow(/strictly increasing/);
    expect(
      () =>
        new Histogram({
          name: 'h2',
          help: 'h',
          buckets: [1, 0.5],
        }),
    ).toThrow();
  });

  test('observe places values in cumulative buckets', () => {
    const h = new Histogram({
      name: 'd',
      help: 'h',
      labelNames: ['action'],
      buckets: [0.1, 0.5, 1.0],
    });
    h.observe(0.05, { action: 'a' });
    h.observe(0.3, { action: 'a' });
    h.observe(0.8, { action: 'a' });
    h.observe(2.0, { action: 'a' });
    const out = h.render();
    expect(out).toContain('d_bucket{action="a",le="0.1"} 1');
    expect(out).toContain('d_bucket{action="a",le="0.5"} 2');
    expect(out).toContain('d_bucket{action="a",le="1"} 3');
    expect(out).toContain('d_bucket{action="a",le="+Inf"} 4');
    expect(out).toContain('d_count{action="a"} 4');
    // Sum: 0.05 + 0.3 + 0.8 + 2.0 = 3.15 (floating point allowed)
    expect(out).toMatch(/d_sum\{action="a"\} 3\.15/);
  });

  test('observe with no labels works', () => {
    const h = new Histogram({
      name: 'no_labels',
      help: 'h',
      buckets: [1, 2],
    });
    h.observe(0.5);
    h.observe(1.5);
    const out = h.render();
    expect(out).toContain('no_labels_bucket{le="1"} 1');
    expect(out).toContain('no_labels_bucket{le="2"} 2');
    expect(out).toContain('no_labels_bucket{le="+Inf"} 2');
    expect(out).toContain('no_labels_count 2');
    expect(out).toContain('no_labels_sum 2');
  });

  test('observe rejects unknown labels', () => {
    const h = new Histogram({
      name: 'rl',
      help: 'h',
      labelNames: ['a'],
      buckets: [1],
    });
    expect(() => h.observe(0.5, { a: 'x', extra: 'nope' })).toThrow(MetricsLabelError);
  });

  test('observe rejects non-finite', () => {
    const h = new Histogram({
      name: 'nf',
      help: 'h',
      buckets: [1],
    });
    expect(() => h.observe(Number.NaN)).toThrow();
    expect(() => h.observe(Number.POSITIVE_INFINITY)).toThrow();
  });

  test('empty histogram renders nothing', () => {
    const h = new Histogram({
      name: 'empty',
      help: 'h',
      buckets: [1],
    });
    expect(h.render()).toBe('');
  });
});
