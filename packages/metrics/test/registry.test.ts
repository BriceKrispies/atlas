import { describe, test, expect, beforeEach } from 'vitest';
import { Counter, Histogram, Registry, resetRegistry, getRegistry } from '@atlas/metrics';

beforeEach(() => {
  resetRegistry();
});

describe('Registry', () => {
  test('register + get round-trips', () => {
    const r = new Registry();
    const c = new Counter({ name: 'a', help: 'A' });
    r.register(c);
    expect(r.get('a')).toBe(c);
  });

  test('rejects double-register', () => {
    const r = new Registry();
    r.register(new Counter({ name: 'dup', help: 'H' }));
    expect(() =>
      r.register(new Counter({ name: 'dup', help: 'H2' })),
    ).toThrow(/already registered/);
  });

  test('serialize emits HELP + TYPE lines', () => {
    const r = new Registry();
    const c = r.register(new Counter({ name: 'reqs', help: 'request count' }));
    c.inc(3);
    const out = r.serialize();
    expect(out).toContain('# HELP reqs request count');
    expect(out).toContain('# TYPE reqs counter');
    expect(out).toContain('reqs 3');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('serialize composes counter + histogram', () => {
    const r = new Registry();
    const c = r.register(new Counter({ name: 'c', help: 'C', labelNames: ['k'] }));
    const h = r.register(
      new Histogram({ name: 'h', help: 'H', labelNames: ['k'], buckets: [0.1, 1] }),
    );
    c.inc({ k: 'v' });
    h.observe(0.5, { k: 'v' });
    const out = r.serialize();
    expect(out).toContain('# TYPE c counter');
    expect(out).toContain('# TYPE h histogram');
    expect(out).toContain('c{k="v"} 1');
    expect(out).toContain('h_bucket{k="v",le="0.1"} 0');
    expect(out).toContain('h_bucket{k="v",le="1"} 1');
    expect(out).toContain('h_bucket{k="v",le="+Inf"} 1');
    expect(out).toContain('h_count{k="v"} 1');
  });

  test('singleton survives across getRegistry calls', () => {
    const r1 = getRegistry();
    r1.register(new Counter({ name: 'singleton', help: 'h' }));
    const r2 = getRegistry();
    expect(r2.get('singleton')).toBeDefined();
  });

  test('resetRegistry produces a fresh instance', () => {
    getRegistry().register(new Counter({ name: 'r1', help: 'h' }));
    resetRegistry();
    expect(getRegistry().get('r1')).toBeUndefined();
  });
});
