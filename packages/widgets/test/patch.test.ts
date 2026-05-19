import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { applyPatch, diff, keyOf } from '../src/data-source/patch.ts';
import type { RowPatch } from '../src/data-source/types.ts';
/**
 * Narrow a RowPatch to its `remove` branch. Throws if the patch isn't a
 * remove — used so callers can read `.rowKey` without an `as` cast.
 */
function asRemove<R extends Record<string, unknown>>(p: RowPatch<R>): Extract<RowPatch<R>, {
    type: 'remove';
}> {
    if (p.type !== 'remove')
        throw new Error(`expected RowPatch.type='remove', got '${p.type}'`);
    return p;
}
/**
 * Narrow a RowPatch to its `upsert` branch. Throws if the patch isn't an
 * upsert — used so callers can read `.row` without an `as` cast.
 */
function asUpsert<R extends Record<string, unknown>>(p: RowPatch<R>): Extract<RowPatch<R>, {
    type: 'upsert';
}> {
    if (p.type !== 'upsert')
        throw new Error(`expected RowPatch.type='upsert', got '${p.type}'`);
    return p;
}
describe('patch helpers', function () {
    it('keyOf handles string field, function, and id fallback', function () {
        expect(keyOf({ id: 1 }, 'id')).toBe(1);
        expect(keyOf({ slug: 'x' }, 'slug')).toBe('x');
        expect(keyOf({ id: 'z' }, undefined)).toBe('z');
        expect(keyOf({ uuid: 'q' }, function (r) {
            return r['uuid'] as string;
        })).toBe('q');
    });
    it('applyPatch upsert appends new rows', function () {
        const prev: Array<Record<string, unknown>> = [{ id: 1 }];
        const next = applyPatch(prev, { type: 'upsert', row: { id: 2, title: 'b' } }, 'id');
        expect(next).toEqual([{ id: 1 }, { id: 2, title: 'b' }]);
        expect(next).not.toBe(prev);
    });
    it('applyPatch upsert replaces existing rows by key', function () {
        const prev = [{ id: 1, title: 'a' }, { id: 2 }];
        const next = applyPatch(prev, { type: 'upsert', row: { id: 1, title: 'A' } }, 'id');
        expect(next).toEqual([{ id: 1, title: 'A' }, { id: 2 }]);
    });
    it('applyPatch remove drops the row', function () {
        const prev = [{ id: 1 }, { id: 2 }];
        const next = applyPatch(prev, { type: 'remove', rowKey: 2 }, 'id');
        expect(next).toEqual([{ id: 1 }]);
    });
    it('applyPatch remove is a no-op when key absent', function () {
        const prev = [{ id: 1 }];
        const next = applyPatch(prev, { type: 'remove', rowKey: 99 }, 'id');
        expect(next).toBe(prev);
    });
    it('applyPatch reload is a no-op', function () {
        const prev = [{ id: 1 }];
        const next = applyPatch(prev, { type: 'reload' }, 'id');
        expect(next).toBe(prev);
    });
    it('applyPatch ignores malformed patches', function () {
        const prev = [{ id: 1 }];
        expect(applyPatch(prev, null, 'id')).toBe(prev);
        // @ts-expect-error — deliberately malformed for runtime coverage.
        expect(applyPatch(prev, { type: 'upsert' }, 'id')).toBe(prev);
    });
    it('diff detects removed rows', function () {
        const patches = diff([{ id: 1 }, { id: 2 }], [{ id: 1 }], 'id');
        expect(patches.length).toBe(1);
        const first = assertDefined(patches[0], 'diff should emit one remove patch');
        expect(asRemove(first).rowKey).toBe(2);
    });
    it('diff detects added rows', function () {
        const patches = diff([{ id: 1 }], [{ id: 1 }, { id: 2 }], 'id');
        expect(patches.length).toBe(1);
        const first = assertDefined(patches[0], 'diff should emit one upsert patch');
        expect(asUpsert(first).row).toEqual({ id: 2 });
    });
    it('diff detects updated rows via shallow equality', function () {
        const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'b' }], 'id');
        expect(patches.length).toBe(1);
        const first = assertDefined(patches[0], 'diff should emit one upsert patch');
        expect(first.type).toBe('upsert');
    });
    it('diff is empty when rows are shallowly equal', function () {
        const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'a' }], 'id');
        expect(patches).toEqual([]);
    });
    it('diff round-trip via applyPatch reproduces next', function () {
        interface RoundTripRow extends Record<string, unknown> {
            id: number;
            t: string;
        }
        const prev: RoundTripRow[] = [
            { id: 1, t: 'a' },
            { id: 2, t: 'b' },
        ];
        const next: RoundTripRow[] = [
            { id: 2, t: 'b' },
            { id: 3, t: 'c' },
        ];
        const patches: RowPatch<RoundTripRow>[] = diff(prev, next, 'id');
        const applied = patches.reduce<RoundTripRow[]>(function (rows, p) {
            return applyPatch(rows, p, 'id');
        }, prev);
        // Order can differ because applyPatch appends; normalize before comparing.
        const sort = function (rs: RoundTripRow[]): RoundTripRow[] {
            return rs.slice().sort(function (a, b) {
                return a.id - b.id;
            });
        };
        expect(sort(applied)).toEqual(sort(next));
    });
});
