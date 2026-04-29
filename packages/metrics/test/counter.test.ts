import { describe, test, expect } from 'vitest';
import { Counter, MetricsLabelError } from '@atlas/metrics';

describe('Counter', () => {
  test('inc() with no args increments the no-label series by 1', () => {
    const c = new Counter({ name: 'noargs', help: 'h' });
    c.inc();
    c.inc();
    expect(c.get()).toBe(2);
  });

  test('inc(n) adds n', () => {
    const c = new Counter({ name: 'with_n', help: 'h' });
    c.inc(5);
    c.inc(2);
    expect(c.get()).toBe(7);
  });

  test('inc rejects negative n', () => {
    const c = new Counter({ name: 'neg', help: 'h' });
    expect(() => c.inc(-1)).toThrow(/non-negative/);
  });

  test('inc rejects non-finite n', () => {
    const c = new Counter({ name: 'nan', help: 'h' });
    expect(() => c.inc(Number.NaN)).toThrow();
    expect(() => c.inc(Number.POSITIVE_INFINITY)).toThrow();
  });

  test('per-label-combination storage', () => {
    const c = new Counter({
      name: 'labelled',
      help: 'h',
      labelNames: ['a', 'b'],
    });
    c.inc({ a: 'x', b: 'y' });
    c.inc({ a: 'x', b: 'y' });
    c.inc({ a: 'x', b: 'z' });
    expect(c.get({ a: 'x', b: 'y' })).toBe(2);
    expect(c.get({ a: 'x', b: 'z' })).toBe(1);
    expect(c.get({ a: 'q', b: 'r' })).toBe(0); // never observed
  });

  test('rejects unknown label keys', () => {
    const c = new Counter({
      name: 'strict',
      help: 'h',
      labelNames: ['decision'],
    });
    expect(() => c.inc({ decision: 'permit', typo: 'x' })).toThrow(MetricsLabelError);
  });

  test('rejects missing label keys', () => {
    const c = new Counter({
      name: 'missing',
      help: 'h',
      labelNames: ['action', 'decision'],
    });
    expect(() => c.inc({ action: 'x' })).toThrow(MetricsLabelError);
  });

  test('rejects label values when none declared', () => {
    const c = new Counter({ name: 'no_labels', help: 'h' });
    expect(() => c.inc({ x: 'y' })).toThrow(MetricsLabelError);
  });

  test('render emits one line per label combo', () => {
    const c = new Counter({
      name: 'render_test',
      help: 'h',
      labelNames: ['action'],
    });
    c.inc({ action: 'submit' });
    c.inc(2, { action: 'archive' });
    const out = c.render();
    expect(out).toContain('render_test{action="submit"} 1');
    expect(out).toContain('render_test{action="archive"} 2');
  });

  test('render emits zero baseline for label-less counters', () => {
    const c = new Counter({ name: 'baseline', help: 'h' });
    expect(c.render()).toBe('baseline 0');
  });
});
