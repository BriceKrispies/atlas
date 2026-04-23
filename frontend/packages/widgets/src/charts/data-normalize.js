/**
 * Normalize user-provided chart data into a canonical shape:
 *   series charts: { series: [{ name, values: [{x, y}, ...] }, ...] }
 *   radial charts: { slices: [{ label, value }, ...] }
 *
 * Accepted inputs:
 *   - already in canonical shape → returned (shallow cloned)
 *   - { series: [{ name?, data: [[x,y], ...] }] } → normalized
 *   - [y0, y1, y2]                  → single series with x=index
 *   - [[x,y], ...]                  → single series
 *   - [{x, y}, ...]                 → single series
 *   - { slices: [...] } / { data: [...] } for pie-types
 *
 * xKind detection: 'time' if any x is a Date or an ISO-ish string; 'linear'
 * if all x are numbers; 'band' otherwise (strings as categorical labels).
 */

/** @typedef {{ x: number|Date|string, y: number }} Point */

/**
 * @param {unknown} input
 * @param {'series'|'slices'} expected
 */
export function normalize(input, expected) {
  if (expected === 'slices') return normalizeSlices(input);
  return normalizeSeries(input);
}

function normalizeSlices(input) {
  if (!input) return { slices: [] };
  const slices = Array.isArray(input) ? input
    : Array.isArray(input.slices) ? input.slices
    : Array.isArray(input.data) ? input.data
    : [];
  return {
    slices: slices
      .map((s, i) => ({
        label: s?.label ?? s?.name ?? String(s?.key ?? `Slice ${i + 1}`),
        value: Number(s?.value ?? s?.y ?? 0),
      }))
      .filter((s) => Number.isFinite(s.value)),
  };
}

function normalizeSeries(input) {
  if (!input) return emptySeries();

  const rawSeries = Array.isArray(input)
    ? [{ name: 'Series', values: input }]
    : Array.isArray(input.series)
      ? input.series
      : input.values
        ? [{ name: input.name ?? 'Series', values: input.values }]
        : input.data
          ? [{ name: input.name ?? 'Series', values: input.data }]
          : [];

  /** @type {{ name: string, values: Point[] }[]} */
  const series = rawSeries.map((s, i) => ({
    name: s?.name ?? `Series ${i + 1}`,
    values: normalizePoints(s?.values ?? s?.data ?? []),
  }));
  return { series, xKind: detectXKind(series) };
}

function emptySeries() {
  return { series: [], xKind: 'linear' };
}

function normalizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Point[]} */
  const points = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry == null) continue;
    if (Array.isArray(entry)) {
      points.push({ x: normalizeX(entry[0] ?? i), y: Number(entry[1]) });
    } else if (typeof entry === 'object') {
      points.push({ x: normalizeX(entry.x ?? entry.t ?? entry.label ?? i), y: Number(entry.y ?? entry.value ?? 0) });
    } else {
      points.push({ x: i, y: Number(entry) });
    }
  }
  return points.filter((p) => Number.isFinite(p.y));
}

function normalizeX(x) {
  if (x instanceof Date) return x;
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    // Pure numeric strings stay as numbers; ISO-ish strings become Dates; otherwise keep as category.
    const asNum = Number(x);
    if (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(x)) return asNum;
    const asDate = Date.parse(x);
    if (!Number.isNaN(asDate) && /\d{4}-\d{2}-\d{2}/.test(x)) return new Date(asDate);
    return x;
  }
  return x;
}

function detectXKind(series) {
  let sawDate = false;
  let sawString = false;
  for (const s of series) {
    for (const p of s.values) {
      if (p.x instanceof Date) sawDate = true;
      else if (typeof p.x === 'string') sawString = true;
    }
  }
  if (sawDate) return 'time';
  if (sawString) return 'band';
  return 'linear';
}
