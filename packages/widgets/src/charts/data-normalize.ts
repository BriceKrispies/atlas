/**
 * Normalize user-provided chart data into a canonical shape:
 *   series charts: { series: [{ name, values: [{x, y}, ...] }, ...] }
 *   radial charts: { slices: [{ label, value }, ...] }
 *
 * This file lives at the user-data → chart boundary. Inputs are `unknown`
 * (chart consumers can pass arrays, single-series objects, multi-series
 * objects, or whatever shape they had lying around) so every read goes
 * through one of the narrowing helpers below — there are no structural
 * casts at the call sites.
 */
// ----------------------------------------------------------------------
// Type guards / narrowing helpers
// ----------------------------------------------------------------------
/** True for plain JSON objects (non-null, non-array). */
function isJsonObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Read a known field as a string, or fall through. */
function readString(o: Record<string, unknown>, key: string): string | undefined {
    const raw = o[key];
    return typeof raw === 'string' ? raw : undefined;
}
/**
 * Read a known field as an array; returns `[]` if absent / wrong shape.
 * The resulting array's elements stay `unknown` — every member access
 * narrows further before use.
 */
function readArray(o: Record<string, unknown>, key: string): unknown[] {
    const raw = o[key];
    return Array.isArray(raw) ? raw : [];
}
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
    if (expected === 'slices')
        return normalizeSlices(input);
    return normalizeSeries(input);
}
function normalizeSlices(input: unknown): NormalizedSlicesData {
    if (input == null)
        return { slices: [] };
    // Pick the source array. Accepts a bare array, `{ slices: [...] }`, or
    // `{ data: [...] }` — the three shapes chart consumers actually use.
    let raw: unknown[];
    if (Array.isArray(input)) {
        raw = input;
    }
    else if (isJsonObject(input)) {
        raw = Array.isArray(input['slices'])
            ? input['slices']
            : Array.isArray(input['data'])
                ? input['data']
                : [];
    }
    else {
        raw = [];
    }
    return {
        slices: raw
            .map(function (s, i) {
            // Every entry is `unknown` until proven object — that closes the
            // "input was a primitive in an array" path.
            const obj = isJsonObject(s) ? s : {};
            const label = readString(obj, 'label') ??
                readString(obj, 'name') ??
                String(obj['key'] ?? `Slice ${i + 1}`);
            return {
                label,
                value: Number(obj['value'] ?? obj['y'] ?? 0),
            };
        })
            .filter(function (s) {
            return Number.isFinite(s.value);
        }),
    };
}
function normalizeSeries(input: unknown): NormalizedSeriesData {
    if (input == null)
        return emptySeries();
    // Walk the four legal shapes: bare array, `{ series: [...] }`,
    // `{ values: [...] }`, `{ data: [...] }`. Everything else collapses
    // to empty.
    let rawSeries: unknown[];
    if (Array.isArray(input)) {
        rawSeries = [{ name: 'Series', values: input }];
    }
    else if (isJsonObject(input)) {
        if (Array.isArray(input['series'])) {
            rawSeries = input['series'];
        }
        else if (input['values'] !== undefined) {
            rawSeries = [
                { name: readString(input, 'name') ?? 'Series', values: input['values'] },
            ];
        }
        else if (input['data'] !== undefined) {
            rawSeries = [
                { name: readString(input, 'name') ?? 'Series', values: input['data'] },
            ];
        }
        else {
            rawSeries = [];
        }
    }
    else {
        rawSeries = [];
    }
    const series: Series[] = rawSeries.map(function (s, i) {
        const obj = isJsonObject(s) ? s : {};
        return {
            name: readString(obj, 'name') ?? `Series ${i + 1}`,
            values: normalizePoints(obj['values'] ?? obj['data'] ?? []),
        };
    });
    return { series, xKind: detectXKind(series) };
}
function emptySeries(): NormalizedSeriesData {
    return { series: [], xKind: 'linear' };
}
function normalizePoints(raw: unknown): Point[] {
    if (!Array.isArray(raw))
        return [];
    // `Array.isArray` widens to `any[]`; pin the typed view back to
    // `unknown[]` so each member access has to narrow before use.
    const items: unknown[] = raw;
    const points: Point[] = [];
    for (let i = 0; i < items.length; i++) {
        const entry: unknown = items[i];
        if (entry == null)
            continue;
        if (Array.isArray(entry)) {
            const tuple: unknown[] = entry;
            points.push({ x: normalizeX(tuple[0] ?? i), y: Number(tuple[1]) });
        }
        else if (isJsonObject(entry)) {
            points.push({
                x: normalizeX(entry['x'] ?? entry['t'] ?? entry['label'] ?? i),
                y: Number(entry['y'] ?? entry['value'] ?? 0),
            });
        }
        else {
            points.push({ x: i, y: Number(entry) });
        }
    }
    return points.filter(function (p) {
        return Number.isFinite(p.y);
    });
}
function normalizeX(x: unknown): PointX {
    if (x instanceof Date)
        return x;
    if (typeof x === 'number')
        return x;
    if (typeof x === 'string') {
        // Pure numeric strings stay as numbers; ISO-ish strings become Dates; otherwise keep as category.
        const asNum = Number(x);
        if (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(x))
            return asNum;
        const asDate = Date.parse(x);
        if (!Number.isNaN(asDate) && /\d{4}-\d{2}-\d{2}/.test(x))
            return new Date(asDate);
        return x;
    }
    // Last-resort fallback for non-string/number/Date inputs (booleans,
    // objects). Stringify so the chart axis has something to render — the
    // bool/object cases shouldn't appear in real inputs but the chart code
    // upstream expects a defined PointX.
    return String(x);
}
function detectXKind(series: Series[]): XKind {
    let sawDate = false;
    let sawString = false;
    for (const s of series) {
        for (const p of s.values) {
            if (p.x instanceof Date)
                sawDate = true;
            else if (typeof p.x === 'string')
                sawString = true;
        }
    }
    if (sawDate)
        return 'time';
    if (sawString)
        return 'band';
    return 'linear';
}
