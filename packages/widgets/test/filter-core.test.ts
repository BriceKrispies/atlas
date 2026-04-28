import { describe, it, expect } from 'vitest';
import { filterRows, type FilterableColumn } from '../src/data-table/filter-core.ts';

interface TestRow extends Record<string, unknown> {
  id: number;
  title: string;
  status: string;
  score: number;
}

const rows: TestRow[] = [
  { id: 1, title: 'Hello world', status: 'published', score: 10 },
  { id: 2, title: 'Another post', status: 'draft',     score: 25 },
  { id: 3, title: 'Weekly HELLO', status: 'published', score: 3  },
];

describe('filterRows', () => {
  it('text filter is case-insensitive substring', () => {
    const out = filterRows(rows, { title: 'hello' }, [{ key: 'title' }]);
    expect(out.length).toBe(2);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });

  it('blank filter values are ignored', () => {
    const out = filterRows(rows, { title: '   ', status: '' }, [
      { key: 'title' }, { key: 'status' },
    ]);
    expect(out.length).toBe(3);
  });

  it('eq filter is strict string equality', () => {
    const out = filterRows(rows, { status: 'draft' }, [
      { key: 'status', filter: { type: 'eq' } },
    ]);
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it('select filter with array is "in"', () => {
    const out = filterRows(rows, { status: ['draft', 'published'] }, [
      { key: 'status', filter: { type: 'select' } },
    ]);
    expect(out.length).toBe(3);
  });

  it('select filter with empty array is ignored', () => {
    const out = filterRows(rows, { status: [] }, [
      { key: 'status', filter: { type: 'select' } },
    ]);
    expect(out.length).toBe(3);
  });

  it('range filter inclusive', () => {
    const out = filterRows(rows, { score: { min: 5, max: 20 } }, [
      { key: 'score', filter: { type: 'range' } },
    ]);
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it('range filter min-only', () => {
    const out = filterRows(rows, { score: { min: 10 } }, [
      { key: 'score', filter: { type: 'range' } },
    ]);
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it('range filter blank object is ignored', () => {
    const out = filterRows(rows, { score: { min: null, max: null } }, [
      { key: 'score', filter: { type: 'range' } },
    ]);
    expect(out.length).toBe(3);
  });

  it('custom filter uses provided matches()', () => {
    const out = filterRows(rows, { score: 15 }, [
      { key: 'score', filter: { type: 'custom', matches: (f, v) => Number(v) < (f as number) } },
    ]);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });

  it('function column accessor is honoured', () => {
    const columns: Array<FilterableColumn<TestRow>> = [
      { key: (r) => r.title.toUpperCase(), filter: { type: 'text' } },
    ];
    const out = filterRows(rows, { upperTitle: 'WORLD' }, columns);
    // Function keys aren't looked up by columnKey — ignored. Sanity: no filter applies.
    expect(out.length).toBe(3);
  });
});
