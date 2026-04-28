import { describe, it, expect } from 'vitest';
import { applyPatch, diff, keyOf } from '../src/data-source/patch.ts';
import type { RowPatch } from '../src/data-source/types.ts';

describe('patch helpers', () => {
  it('keyOf handles string field, function, and id fallback', () => {
    expect(keyOf({ id: 1 }, 'id')).toBe(1);
    expect(keyOf({ slug: 'x' }, 'slug')).toBe('x');
    expect(keyOf({ id: 'z' }, undefined)).toBe('z');
    expect(keyOf({ uuid: 'q' }, (r) => r['uuid'] as string)).toBe('q');
  });

  it('applyPatch upsert appends new rows', () => {
    const prev: Array<Record<string, unknown>> = [{ id: 1 }];
    const next = applyPatch(prev, { type: 'upsert', row: { id: 2, title: 'b' } }, 'id');
    expect(next).toEqual([{ id: 1 }, { id: 2, title: 'b' }]);
    expect(next).not.toBe(prev);
  });

  it('applyPatch upsert replaces existing rows by key', () => {
    const prev = [{ id: 1, title: 'a' }, { id: 2 }];
    const next = applyPatch(prev, { type: 'upsert', row: { id: 1, title: 'A' } }, 'id');
    expect(next).toEqual([{ id: 1, title: 'A' }, { id: 2 }]);
  });

  it('applyPatch remove drops the row', () => {
    const prev = [{ id: 1 }, { id: 2 }];
    const next = applyPatch(prev, { type: 'remove', rowKey: 2 }, 'id');
    expect(next).toEqual([{ id: 1 }]);
  });

  it('applyPatch remove is a no-op when key absent', () => {
    const prev = [{ id: 1 }];
    const next = applyPatch(prev, { type: 'remove', rowKey: 99 }, 'id');
    expect(next).toBe(prev);
  });

  it('applyPatch reload is a no-op', () => {
    const prev = [{ id: 1 }];
    const next = applyPatch(prev, { type: 'reload' }, 'id');
    expect(next).toBe(prev);
  });

  it('applyPatch ignores malformed patches', () => {
    const prev = [{ id: 1 }];
    expect(applyPatch(prev, null, 'id')).toBe(prev);
    // @ts-expect-error — deliberately malformed for runtime coverage.
    expect(applyPatch(prev, { type: 'upsert' }, 'id')).toBe(prev);
  });

  it('diff detects removed rows', () => {
    const patches = diff([{ id: 1 }, { id: 2 }], [{ id: 1 }], 'id');
    expect(patches.length).toBe(1);
    expect(patches[0]!.type).toBe('remove');
    expect((patches[0] as { type: 'remove'; rowKey: unknown }).rowKey).toBe(2);
  });

  it('diff detects added rows', () => {
    const patches = diff([{ id: 1 }], [{ id: 1 }, { id: 2 }], 'id');
    expect(patches.length).toBe(1);
    expect(patches[0]!.type).toBe('upsert');
    expect((patches[0] as { type: 'upsert'; row: unknown }).row).toEqual({ id: 2 });
  });

  it('diff detects updated rows via shallow equality', () => {
    const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'b' }], 'id');
    expect(patches.length).toBe(1);
    expect(patches[0]!.type).toBe('upsert');
  });

  it('diff is empty when rows are shallowly equal', () => {
    const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'a' }], 'id');
    expect(patches).toEqual([]);
  });

  it('diff round-trip via applyPatch reproduces next', () => {
    type Row = { id: number; t: string };
    const prev: Row[] = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
    const next: Row[] = [{ id: 2, t: 'b' }, { id: 3, t: 'c' }];
    const patches: RowPatch[] = diff(prev, next, 'id');
    const applied = patches.reduce<Row[]>(
      (rows, p) => applyPatch(rows, p, 'id') as Row[],
      prev,
    );
    // Order can differ because applyPatch appends; normalize before comparing.
    const sort = (rs: Row[]): Row[] => rs.slice().sort((a, b) => a.id - b.id);
    expect(sort(applied)).toEqual(sort(next));
  });
});
