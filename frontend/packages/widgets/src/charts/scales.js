/**
 * Minimal chart scales. All pure functions — no DOM, no side effects.
 *
 *   linearScale({ domain: [min, max], range: [from, to] })
 *     → { scale(value), ticks(count?), domain, range }
 *
 *   bandScale({ domain: ['a', 'b', ...], range: [from, to], padding?: 0..1 })
 *     → { scale(value), bandwidth, ticks(), domain, range }
 *
 *   timeScale({ domain: [dateMin, dateMax], range: [from, to] })
 *     → same shape as linearScale but `scale(x)` accepts Date|number|string
 *
 * Scales are cheap to construct; rebuild on each render rather than mutate.
 */

/**
 * @param {{ domain: [number, number], range: [number, number] }} config
 */
export function linearScale({ domain, range }) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const ratio = (r1 - r0) / span;

  function scale(v) {
    return r0 + (Number(v) - d0) * ratio;
  }
  function invert(r) {
    return d0 + (r - r0) / ratio;
  }
  function ticks(count = 5) {
    return niceLinearTicks(d0, d1, count);
  }
  return { scale, invert, ticks, domain, range, kind: 'linear' };
}

/**
 * @param {{ domain: Array<string|number>, range: [number, number], padding?: number }} config
 */
export function bandScale({ domain, range, padding = 0.2 }) {
  const [r0, r1] = range;
  const n = Math.max(1, domain.length);
  const step = (r1 - r0) / n;
  const band = step * (1 - clamp01(padding));
  const offset = (step - band) / 2;
  const index = new Map(domain.map((d, i) => [d, i]));

  function scale(v) {
    const i = index.get(v);
    if (i == null) return r0;
    return r0 + i * step + offset;
  }
  function ticks() {
    return domain.slice();
  }
  return { scale, ticks, domain, range, bandwidth: band, step, kind: 'band' };
}

/**
 * @param {{ domain: [Date|number|string, Date|number|string], range: [number, number] }} config
 */
export function timeScale({ domain, range }) {
  const d0 = toMs(domain[0]);
  const d1 = toMs(domain[1]);
  const inner = linearScale({ domain: [d0, d1], range });
  function scale(v) { return inner.scale(toMs(v)); }
  function invert(r) { return new Date(inner.invert(r)); }
  function ticks(count = 5) {
    return niceTimeTicks(d0, d1, count);
  }
  return { scale, invert, ticks, domain, range, kind: 'time' };
}

// ── helpers ───────────────────────────────────────────────────────

export function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const d = new Date(v);
  return d.getTime();
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function niceLinearTicks(d0, d1, count) {
  if (d0 === d1) return [d0];
  const step = niceStep((d1 - d0) / Math.max(1, count));
  const start = Math.ceil(d0 / step) * step;
  const ticks = [];
  for (let v = start; v <= d1 + 1e-9; v += step) ticks.push(round(v, step));
  return ticks;
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const frac = raw / pow;
  let nice;
  if (frac < 1.5) nice = 1;
  else if (frac < 3) nice = 2;
  else if (frac < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

function round(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(v.toFixed(decimals));
}

function niceTimeTicks(d0, d1, count) {
  const span = d1 - d0;
  const day = 86_400_000;
  const stepMs = span > 365 * day * count ? 365 * day
    : span > 30 * day * count ? 30 * day
    : span > 7 * day * count  ? 7 * day
    : span > day * count      ? day
    : 3_600_000;
  const ticks = [];
  let t = Math.ceil(d0 / stepMs) * stepMs;
  while (t <= d1 + 1) {
    ticks.push(new Date(t));
    t += stepMs;
    if (ticks.length > 1000) break; // defensive
  }
  return ticks;
}
