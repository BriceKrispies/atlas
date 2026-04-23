import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/charts/data-normalize.js';

test('normalize array of numbers → single series with index x', () => {
  const out = normalize([1, 2, 3], 'series');
  assert.equal(out.series.length, 1);
  assert.deepEqual(out.series[0].values.map((p) => p.y), [1, 2, 3]);
  assert.deepEqual(out.series[0].values.map((p) => p.x), [0, 1, 2]);
  assert.equal(out.xKind, 'linear');
});

test('normalize array of [x, y] tuples', () => {
  const out = normalize([[1, 10], [2, 20]], 'series');
  assert.equal(out.series[0].values[0].x, 1);
  assert.equal(out.series[0].values[0].y, 10);
});

test('normalize array of {x, y} objects', () => {
  const out = normalize([{ x: 'a', y: 1 }, { x: 'b', y: 2 }], 'series');
  assert.equal(out.xKind, 'band');
});

test('normalize canonical {series:[…]}', () => {
  const input = { series: [{ name: 'Alpha', values: [{ x: 1, y: 2 }] }] };
  const out = normalize(input, 'series');
  assert.equal(out.series[0].name, 'Alpha');
  assert.equal(out.series[0].values[0].y, 2);
});

test('normalize detects time xKind on Date values', () => {
  const out = normalize({ series: [{ values: [{ x: new Date('2026-01-01'), y: 1 }] }] }, 'series');
  assert.equal(out.xKind, 'time');
});

test('normalize detects time xKind on ISO date strings', () => {
  const out = normalize({ series: [{ values: [{ x: '2026-01-01', y: 1 }] }] }, 'series');
  assert.equal(out.xKind, 'time');
});

test('normalize slices from array', () => {
  const out = normalize([{ label: 'A', value: 1 }, { label: 'B', value: 2 }], 'slices');
  assert.equal(out.slices.length, 2);
  assert.equal(out.slices[0].label, 'A');
});

test('normalize slices from {slices: [...]}', () => {
  const out = normalize({ slices: [{ label: 'X', value: 10 }] }, 'slices');
  assert.equal(out.slices[0].value, 10);
});

test('normalize slices filters out non-finite values', () => {
  const out = normalize([{ label: 'A', value: NaN }, { label: 'B', value: 5 }], 'slices');
  assert.equal(out.slices.length, 1);
  assert.equal(out.slices[0].label, 'B');
});

test('normalize empty input returns empty series', () => {
  const out = normalize(null, 'series');
  assert.deepEqual(out.series, []);
});
