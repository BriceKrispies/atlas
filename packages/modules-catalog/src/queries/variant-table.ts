import type { ProjectionStore } from '@atlas/ports';
import type { VariantTableParams, VariantTableResponse, FilterValue } from '@atlas/platform-core';
import { projectionKey } from '../projections/variant-matrix.ts';

interface VariantRow {
  variantId: string;
  variantKey: string;
  name: string;
  revision: number;
  values: Record<string, { raw: unknown; normalized: unknown; display: string | null }>;
}

function variantMatches(row: VariantRow, filters: Record<string, FilterValue>): boolean {
  for (const [attr, fv] of Object.entries(filters)) {
    const entry = row.values[attr];
    if (!entry) return false;
    const raw = entry.raw;
    if (fv.kind === 'equals') {
      const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (rawStr !== fv.value) return false;
    } else {
      const n = typeof raw === 'number' ? raw : Number.NaN;
      if (fv.gte !== undefined && !(n >= fv.gte)) return false;
      if (fv.lte !== undefined && !(n <= fv.lte)) return false;
    }
  }
  return true;
}

function parseSortSpec(s: string): { attr: string; dir: 'asc' | 'desc' } {
  const idx = s.lastIndexOf('.');
  if (idx === -1) return { attr: s, dir: 'asc' };
  const attr = s.slice(0, idx);
  const dirStr = s.slice(idx + 1);
  return { attr, dir: dirStr === 'desc' ? 'desc' : 'asc' };
}

function compareVariants(a: VariantRow, b: VariantRow, attr: string): number {
  const av = a.values[attr]?.normalized;
  const bv = b.values[attr]?.normalized;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  const as_ = typeof av === 'string' ? av : '';
  const bs_ = typeof bv === 'string' ? bv : '';
  return as_.localeCompare(bs_);
}

export async function queryVariantTable(
  tenantId: string,
  familyKey: string,
  params: VariantTableParams,
  projections: ProjectionStore,
): Promise<VariantTableResponse | null> {
  const stored = (await projections.get(projectionKey(familyKey, tenantId))) as
    | VariantTableResponse
    | null;
  if (!stored) return null;

  const allRows = (stored.rows as unknown as VariantRow[]) ?? [];
  const filters = params.filters ?? {};
  let filtered = allRows.filter((r) => variantMatches(r, filters));

  if (params.sort) {
    const { attr, dir } = parseSortSpec(params.sort);
    filtered = [...filtered].sort((a, b) => {
      const ord = compareVariants(a, b, attr);
      return dir === 'asc' ? ord : -ord;
    });
  }

  if (params.pageSize !== undefined) {
    filtered = filtered.slice(0, params.pageSize);
  }

  return {
    ...stored,
    rows: filtered as unknown as Array<Record<string, unknown>>,
    rowCount: filtered.length,
  };
}

export function parseFilterQuery(raw: Record<string, string>): Record<string, FilterValue> {
  const out: Record<string, FilterValue> = {};
  const ranges: Record<string, { gte?: number; lte?: number }> = {};
  for (const [k, v] of Object.entries(raw)) {
    const stripped = k.startsWith('filters[') && k.endsWith(']') ? k.slice(8, -1) : null;
    if (stripped === null) continue;
    const opIdx = stripped.indexOf('][');
    if (opIdx >= 0) {
      const attr = stripped.slice(0, opIdx);
      const op = stripped.slice(opIdx + 2);
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const entry = ranges[attr] ?? {};
      if (op === 'gte') entry.gte = n;
      else if (op === 'lte') entry.lte = n;
      ranges[attr] = entry;
    } else {
      out[stripped] = { kind: 'equals', value: v };
    }
  }
  for (const [attr, r] of Object.entries(ranges)) {
    const fv: FilterValue = { kind: 'range' };
    if (r.gte !== undefined) fv.gte = r.gte;
    if (r.lte !== undefined) fv.lte = r.lte;
    out[attr] = fv;
  }
  return out;
}
