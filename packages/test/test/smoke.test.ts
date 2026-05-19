import { describe, expect, it, vi } from '@atlas/test';

describe('@atlas/test smoke', () => {
  it('expect runs basic matchers', () => {
    expect(1 + 1).toBe(2);
    expect({ a: 1 }).toEqual({ a: 1 });
    expect([1, 2, 3]).toContain(2);
  });

  it('vi.fn records calls', () => {
    const fn = vi.fn();
    fn(1);
    fn(2);
    expect(fn.mock.calls).toEqual([[1], [2]]);
    expect(fn.mock.calls.length).toBe(2);
  });

  it('vi.fn with implementation returns values', () => {
    const fn = vi.fn((x: number) => x * 2);
    expect(fn(5)).toBe(10);
  });

  it('expect.toThrow works', () => {
    expect(() => {
      throw new Error('boom');
    }).toThrow(/boom/);
  });
});
