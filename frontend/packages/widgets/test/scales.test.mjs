import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearScale, bandScale, timeScale, toMs } from '../src/charts/scales.js';

test('linearScale maps domain to range', () => {
  const s = linearScale({ domain: [0, 100], range: [0, 200] });
  assert.equal(s.scale(0), 0);
  assert.equal(s.scale(50), 100);
  assert.equal(s.scale(100), 200);
});

test('linearScale invert round-trips', () => {
  const s = linearScale({ domain: [10, 20], range: [0, 100] });
  assert.equal(s.invert(s.scale(15)), 15);
});

test('linearScale ticks produces nice round values', () => {
  const s = linearScale({ domain: [0, 100], range: [0, 500] });
  const ticks = s.ticks(5);
  assert.deepEqual(ticks, [0, 20, 40, 60, 80, 100]);
});

test('linearScale ticks handles negative ranges', () => {
  const s = linearScale({ domain: [-10, 10], range: [0, 100] });
  const ticks = s.ticks(4);
  assert.ok(ticks.length >= 4);
  assert.ok(ticks[0] <= -10 + 5);
  assert.ok(ticks.at(-1) >= 10 - 5);
});

test('bandScale produces evenly spaced bands with padding', () => {
  const s = bandScale({ domain: ['a', 'b', 'c'], range: [0, 300], padding: 0 });
  assert.equal(s.scale('a'), 0);
  assert.equal(s.scale('b'), 100);
  assert.equal(s.scale('c'), 200);
  assert.equal(s.bandwidth, 100);
});

test('bandScale honours padding', () => {
  const s = bandScale({ domain: ['a', 'b'], range: [0, 100], padding: 0.2 });
  // step = 50, bandwidth = 40, offset = 5
  assert.equal(s.scale('a'), 5);
  assert.equal(s.bandwidth, 40);
});

test('bandScale unknown key falls back to range[0]', () => {
  const s = bandScale({ domain: ['a', 'b'], range: [10, 20] });
  assert.equal(s.scale('missing'), 10);
});

test('timeScale normalizes Date|string|number', () => {
  const d0 = new Date('2026-01-01');
  const d1 = new Date('2026-01-31');
  const s = timeScale({ domain: [d0, d1], range: [0, 300] });
  assert.equal(s.scale(d0), 0);
  assert.equal(s.scale(d1), 300);
  // midpoint (same millis as Date)
  const mid = new Date((d0.getTime() + d1.getTime()) / 2);
  assert.ok(Math.abs(s.scale(mid) - 150) < 1);
});

test('timeScale invert returns Date', () => {
  const s = timeScale({
    domain: [new Date('2026-01-01'), new Date('2026-01-31')],
    range: [0, 100],
  });
  const mid = s.invert(50);
  assert.ok(mid instanceof Date);
});

test('toMs handles all accepted formats', () => {
  const d = new Date('2026-01-01');
  assert.equal(toMs(d), d.getTime());
  assert.equal(toMs(d.getTime()), d.getTime());
  assert.equal(typeof toMs('2026-01-01'), 'number');
});
