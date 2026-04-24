import { describe, it, expect } from 'vitest';
import { normalize } from '../src/charts/data-normalize.ts';

describe('data-normalize', () => {
  it('normalize array of numbers → single series with index x', () => {
    const out = normalize([1, 2, 3], 'series');
    expect(out.series.length).toBe(1);
    expect(out.series[0]!.values.map((p) => p.y)).toEqual([1, 2, 3]);
    expect(out.series[0]!.values.map((p) => p.x)).toEqual([0, 1, 2]);
    expect(out.xKind).toBe('linear');
  });

  it('normalize array of [x, y] tuples', () => {
    const out = normalize([[1, 10], [2, 20]], 'series');
    expect(out.series[0]!.values[0]!.x).toBe(1);
    expect(out.series[0]!.values[0]!.y).toBe(10);
  });

  it('normalize array of {x, y} objects', () => {
    const out = normalize([{ x: 'a', y: 1 }, { x: 'b', y: 2 }], 'series');
    expect(out.xKind).toBe('band');
  });

  it('normalize canonical {series:[…]}', () => {
    const input = { series: [{ name: 'Alpha', values: [{ x: 1, y: 2 }] }] };
    const out = normalize(input, 'series');
    expect(out.series[0]!.name).toBe('Alpha');
    expect(out.series[0]!.values[0]!.y).toBe(2);
  });

  it('normalize detects time xKind on Date values', () => {
    const out = normalize({ series: [{ values: [{ x: new Date('2026-01-01'), y: 1 }] }] }, 'series');
    expect(out.xKind).toBe('time');
  });

  it('normalize detects time xKind on ISO date strings', () => {
    const out = normalize({ series: [{ values: [{ x: '2026-01-01', y: 1 }] }] }, 'series');
    expect(out.xKind).toBe('time');
  });

  it('normalize slices from array', () => {
    const out = normalize([{ label: 'A', value: 1 }, { label: 'B', value: 2 }], 'slices');
    expect(out.slices.length).toBe(2);
    expect(out.slices[0]!.label).toBe('A');
  });

  it('normalize slices from {slices: [...]}', () => {
    const out = normalize({ slices: [{ label: 'X', value: 10 }] }, 'slices');
    expect(out.slices[0]!.value).toBe(10);
  });

  it('normalize slices filters out non-finite values', () => {
    const out = normalize([{ label: 'A', value: NaN }, { label: 'B', value: 5 }], 'slices');
    expect(out.slices.length).toBe(1);
    expect(out.slices[0]!.label).toBe('B');
  });

  it('normalize empty input returns empty series', () => {
    const out = normalize(null, 'series');
    expect(out.series).toEqual([]);
  });
});
