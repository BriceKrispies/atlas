import { describe, it, expect } from 'vitest';
import { linearScale, bandScale, timeScale, toMs } from '../src/charts/scales.ts';

describe('scales', () => {
  it('linearScale maps domain to range', () => {
    const s = linearScale({ domain: [0, 100], range: [0, 200] });
    expect(s.scale(0)).toBe(0);
    expect(s.scale(50)).toBe(100);
    expect(s.scale(100)).toBe(200);
  });

  it('linearScale invert round-trips', () => {
    const s = linearScale({ domain: [10, 20], range: [0, 100] });
    expect(s.invert(s.scale(15))).toBe(15);
  });

  it('linearScale ticks produces nice round values', () => {
    const s = linearScale({ domain: [0, 100], range: [0, 500] });
    const ticks = s.ticks(5);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('linearScale ticks handles negative ranges', () => {
    const s = linearScale({ domain: [-10, 10], range: [0, 100] });
    const ticks = s.ticks(4);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[0]!).toBeLessThanOrEqual(-10 + 5);
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(10 - 5);
  });

  it('bandScale produces evenly spaced bands with padding', () => {
    const s = bandScale({ domain: ['a', 'b', 'c'], range: [0, 300], padding: 0 });
    expect(s.scale('a')).toBe(0);
    expect(s.scale('b')).toBe(100);
    expect(s.scale('c')).toBe(200);
    expect(s.bandwidth).toBe(100);
  });

  it('bandScale honours padding', () => {
    const s = bandScale({ domain: ['a', 'b'], range: [0, 100], padding: 0.2 });
    // step = 50, bandwidth = 40, offset = 5
    expect(s.scale('a')).toBe(5);
    expect(s.bandwidth).toBe(40);
  });

  it('bandScale unknown key falls back to range[0]', () => {
    const s = bandScale({ domain: ['a', 'b'], range: [10, 20] });
    expect(s.scale('missing')).toBe(10);
  });

  it('timeScale normalizes Date|string|number', () => {
    const d0 = new Date('2026-01-01');
    const d1 = new Date('2026-01-31');
    const s = timeScale({ domain: [d0, d1], range: [0, 300] });
    expect(s.scale(d0)).toBe(0);
    expect(s.scale(d1)).toBe(300);
    // midpoint (same millis as Date)
    const mid = new Date((d0.getTime() + d1.getTime()) / 2);
    expect(Math.abs(s.scale(mid) - 150)).toBeLessThan(1);
  });

  it('timeScale invert returns Date', () => {
    const s = timeScale({
      domain: [new Date('2026-01-01'), new Date('2026-01-31')],
      range: [0, 100],
    });
    const mid = s.invert(50);
    expect(mid instanceof Date).toBe(true);
  });

  it('toMs handles all accepted formats', () => {
    const d = new Date('2026-01-01');
    expect(toMs(d)).toBe(d.getTime());
    expect(toMs(d.getTime())).toBe(d.getTime());
    expect(typeof toMs('2026-01-01')).toBe('number');
  });
});
