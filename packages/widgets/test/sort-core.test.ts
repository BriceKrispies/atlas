import { describe, it, expect } from '@atlas/test';
import { sortRows, nextSortDir, defaultCompare } from '../src/data-table/sort-core.ts';
describe('sort-core', function () {
    it('sortRows asc numeric', function () {
        const out = sortRows([{ v: 3 }, { v: 1 }, { v: 2 }], { sortBy: 'v', sortDir: 'asc' });
        expect(out.map(function (r) {
            return r['v'];
        })).toEqual([1, 2, 3]);
    });
    it('sortRows desc numeric', function () {
        const out = sortRows([{ v: 1 }, { v: 3 }, { v: 2 }], { sortBy: 'v', sortDir: 'desc' });
        expect(out.map(function (r) {
            return r['v'];
        })).toEqual([3, 2, 1]);
    });
    it('sortRows is stable on ties (preserves input order)', function () {
        const rows = [
            { id: 1, v: 'a' },
            { id: 2, v: 'a' },
            { id: 3, v: 'a' },
        ];
        const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc' });
        expect(out.map(function (r) {
            return r.id;
        })).toEqual([1, 2, 3]);
    });
    it('sortRows tiebreak key restores deterministic order', function () {
        const rows = [
            { id: 3, v: 'a' },
            { id: 1, v: 'a' },
            { id: 2, v: 'a' },
        ];
        const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc', tiebreak: 'id' });
        expect(out.map(function (r) {
            return r.id;
        })).toEqual([1, 2, 3]);
    });
    it('sortRows no-op when sortBy or sortDir is null', function () {
        const rows = [{ v: 2 }, { v: 1 }];
        const a = sortRows(rows, { sortBy: null, sortDir: 'asc' });
        const b = sortRows(rows, { sortBy: 'v', sortDir: null });
        expect(a.map(function (r) {
            return r['v'];
        })).toEqual([2, 1]);
        expect(b.map(function (r) {
            return r['v'];
        })).toEqual([2, 1]);
    });
    it('sortRows supports function sortBy', function () {
        const rows = [{ a: { b: 3 } }, { a: { b: 1 } }];
        const out = sortRows(rows, { sortBy: function (r) {
                return (r['a'] as {
                    b: number;
                }).b;
            }, sortDir: 'asc' });
        expect(out.map(function (r) {
            return (r['a'] as {
                b: number;
            }).b;
        })).toEqual([1, 3]);
    });
    it('sortRows null values sort last in asc', function () {
        const out = sortRows([{ v: null }, { v: 1 }, { v: 2 }], { sortBy: 'v', sortDir: 'asc' });
        expect(out.map(function (r) {
            return r['v'];
        })).toEqual([1, 2, null]);
    });
    it('sortRows returns a new array', function () {
        const rows = [{ v: 1 }];
        const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc' });
        expect(out).not.toBe(rows);
    });
    it('nextSortDir cycles none → asc → desc → none', function () {
        expect(nextSortDir(null)).toBe('asc');
        expect(nextSortDir('asc')).toBe('desc');
        expect(nextSortDir('desc')).toBe(null);
    });
    it('defaultCompare uses numeric semantics for numeric strings', function () {
        expect(defaultCompare('10', '9')).toBeGreaterThan(0);
        expect(defaultCompare('aa', 'ab')).toBeLessThan(0);
    });
});
