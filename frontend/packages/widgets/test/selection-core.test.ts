import { describe, it, expect } from 'vitest';
import {
  selectRow,
  unselectRow,
  toggleRow,
  toggleAllOnPage,
  clearSelection,
  type SelectionKey,
} from '../src/data-table/selection-core.ts';

describe('selection-core', () => {
  it('selectRow none mode is a no-op', () => {
    const before = new Set<SelectionKey>();
    const after = selectRow('none', before, 1);
    expect(after).toBe(before);
  });

  it('selectRow single mode replaces the entry', () => {
    const after = selectRow('single', new Set<SelectionKey>([1]), 2);
    expect([...after]).toEqual([2]);
  });

  it('selectRow single mode is a no-op when already selected', () => {
    const before = new Set<SelectionKey>([1]);
    const after = selectRow('single', before, 1);
    expect(after).toBe(before);
  });

  it('selectRow multi mode adds to set', () => {
    const after = selectRow('multi', new Set<SelectionKey>([1]), 2);
    expect([...after].sort()).toEqual([1, 2]);
  });

  it('unselectRow removes entry in multi mode', () => {
    const after = unselectRow('multi', new Set<SelectionKey>([1, 2]), 1);
    expect([...after]).toEqual([2]);
  });

  it('toggleRow adds then removes', () => {
    const a = toggleRow('multi', new Set<SelectionKey>(), 1);
    expect([...a]).toEqual([1]);
    const b = toggleRow('multi', a, 1);
    expect(b.size).toBe(0);
  });

  it('toggleAllOnPage selects all when none selected', () => {
    const out = toggleAllOnPage('multi', new Set<SelectionKey>(), [1, 2, 3]);
    expect([...out].sort()).toEqual([1, 2, 3]);
  });

  it('toggleAllOnPage deselects all when all already selected', () => {
    const out = toggleAllOnPage('multi', new Set<SelectionKey>([1, 2, 3]), [1, 2, 3]);
    expect(out.size).toBe(0);
  });

  it('toggleAllOnPage partial selection selects remaining', () => {
    const out = toggleAllOnPage('multi', new Set<SelectionKey>([1]), [1, 2, 3]);
    expect([...out].sort()).toEqual([1, 2, 3]);
  });

  it('toggleAllOnPage no-op for single mode', () => {
    const before = new Set<SelectionKey>([1]);
    const after = toggleAllOnPage('single', before, [1, 2, 3]);
    expect(after).toBe(before);
  });

  it('clearSelection empties set and returns new reference', () => {
    const before = new Set<SelectionKey>([1, 2]);
    const after = clearSelection(before);
    expect(after.size).toBe(0);
    expect(after).not.toBe(before);
  });

  it('clearSelection returns same reference when already empty', () => {
    const before = new Set<SelectionKey>();
    const after = clearSelection(before);
    expect(after).toBe(before);
  });
});
