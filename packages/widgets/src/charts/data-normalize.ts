/**
 * Normalize user-provided chart data into a canonical shape:
 *   series charts: { series: [{ name, values: [{x, y}, ...] }, ...] }
 *   radial charts: { slices: [{ label, value }, ...] }
 */

export type PointX = number | Date | string;
export interface Point {
  x: PointX;
  y: number;
}

export interface Series {
  name: string;
  values: Point[];
  id?: string;
  color?: string;
}

export interface Slice {
  label: string;
  value: number;
  color?: string;
}

export type XKind = 'time' | 'band' | 'linear';

export interface NormalizedSeriesData {
  series: Series[];
  xKind: XKind;
}

export interface NormalizedSlicesData {
  slices: Slice[];
}

export type NormalizedData = NormalizedSeriesData | NormalizedSlicesData;

export function normalize(input: unknown, expected: 'slices'): NormalizedSlicesData;
export function normalize(input: unknown, expected: 'series'): NormalizedSeriesData;
export function normalize(input: unknown, expected: 'series' | 'slices'): NormalizedData;
export function normalize(input: unknown, expected: 'series' | 'slices'): NormalizedData {
  if (expected === 'slices') return normalizeSlices(input);
  return normalizeSeries(input);
}

function normalizeSlices(input: unknown): NormalizedSlicesData {
  if (!input) return { slices: [] };
  const inputObj = input as { slices?: unknown; data?: unknown };
  const slices: unknown[] = Array.isArray(input) ? input
    : Array.isArray(inputObj.slices) ? inputObj.slices
    : Array.isArray(inputObj.data) ? inputObj.data
    : [];
  return {
    slices: slices
      .map((s, i) => {
        const obj = s as Record<string, unknown> | null | undefined;
        return {
          label: (obj?.['label'] as string | undefined)
            ?? (obj?.['name'] as string | undefined)
            ?? String(obj?.['key'] ?? `Slice ${i + 1}`),
          value: Number(obj?.['value'] ?? obj?.['y'] ?? 0),
        };
      })
      .filter((s) => Number.isFinite(s.value)),
  };
}

function normalizeSeries(input: unknown): NormalizedSeriesData {
  if (!input) return emptySeries();

  const inputObj = input as Record<string, unknown>;
  const rawSeries: unknown[] = Array.isArray(input)
    ? [{ name: 'Series', values: input }]
    : Array.isArray(inputObj['series'])
      ? (inputObj['series'] as unknown[])
      : inputObj['values']
        ? [{ name: inputObj['name'] ?? 'Series', values: inputObj['values'] }]
        : inputObj['data']
          ? [{ name: inputObj['name'] ?? 'Series', values: inputObj['data'] }]
          : [];

  const series: Series[] = rawSeries.map((s, i) => {
    const obj = s as Record<string, unknown> | null | undefined;
    return {
      name: (obj?.['name'] as string | undefined) ?? `Series ${i + 1}`,
      values: normalizePoints(obj?.['values'] ?? obj?.['data'] ?? []),
    };
  });
  return { series, xKind: detectXKind(series) };
}

function emptySeries(): NormalizedSeriesData {
  return { series: [], xKind: 'linear' };
}

function normalizePoints(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  const points: Point[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry == null) continue;
    if (Array.isArray(entry)) {
      points.push({ x: normalizeX(entry[0] ?? i), y: Number(entry[1]) });
    } else if (typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      points.push({
        x: normalizeX(obj['x'] ?? obj['t'] ?? obj['label'] ?? i),
        y: Number(obj['y'] ?? obj['value'] ?? 0),
      });
    } else {
      points.push({ x: i, y: Number(entry) });
    }
  }
  return points.filter((p) => Number.isFinite(p.y));
}

function normalizeX(x: unknown): PointX {
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
  return x as PointX;
}

function detectXKind(series: Series[]): XKind {
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
