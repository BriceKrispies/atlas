/**
 * Unit tests for `@atlas/core` signals — signal/computed/effect/batch.
 *
 * These tests cover the contract documented in `packages/core/CLAUDE.md` and
 * exercised throughout the design system: dependency tracking, lazy
 * recomputation of computed values, batched coalescing, and effect cleanup.
 */

import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch } from '../src/signals.ts';

describe('signal', () => {
  it('exposes the initial value and updates via .set', () => {
    const s = signal(7);
    expect(s.value).toBe(7);
    s.set(11);
    expect(s.value).toBe(11);
  });

  it('skips notifying when the value is identical (Object.is)', () => {
    const s = signal({ id: 1 });
    const ref = s.value;
    s.set(ref);
    // No structural way to observe directly; use an effect to assert.
    let runs = 0;
    const dispose = effect(() => {
      void s.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    s.set(ref); // identical reference: no notify
    expect(runs).toBe(1);
    s.set({ id: 1 }); // new reference even if shallow-equal: does notify
    expect(runs).toBe(2);
    dispose();
  });

  it('NaN equality follows Object.is (NaN === NaN suppresses notify)', () => {
    const s = signal<number>(NaN);
    let runs = 0;
    const dispose = effect(() => {
      void s.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    s.set(NaN);
    expect(runs).toBe(1);
    dispose();
  });

  it('subscribe is invoked synchronously with the initial value and on every change', () => {
    const s = signal(1);
    const seen: number[] = [];
    const off = s.subscribe((v) => seen.push(v));
    expect(seen).toEqual([1]);
    s.set(2);
    s.set(3);
    expect(seen).toEqual([1, 2, 3]);
    off();
    s.set(4);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('computed', () => {
  it('derives from signal dependencies and updates on change', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.value + b.value);
    expect(sum.value).toBe(5);
    a.set(10);
    expect(sum.value).toBe(13);
    b.set(7);
    expect(sum.value).toBe(17);
  });

  it('memoizes — does not re-run fn on repeated reads when deps unchanged', () => {
    const s = signal(1);
    const spy = vi.fn(() => s.value * 2);
    const c = computed(spy);
    expect(c.value).toBe(2);
    expect(c.value).toBe(2);
    expect(c.value).toBe(2);
    // First access compiled; subsequent reads are cached until a dep changes.
    expect(spy).toHaveBeenCalledTimes(1);
    s.set(5);
    expect(c.value).toBe(10);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('chains: computed-of-computed re-evaluates only the affected leg', () => {
    const a = signal(1);
    const doubled = computed(() => a.value * 2);
    const plusOne = computed(() => doubled.value + 1);
    expect(plusOne.value).toBe(3);
    a.set(4);
    expect(plusOne.value).toBe(9);
  });
});

describe('effect', () => {
  it('runs immediately and on every dependency change', () => {
    const s = signal('a');
    const seen: string[] = [];
    const dispose = effect(() => {
      seen.push(s.value);
    });
    expect(seen).toEqual(['a']);
    s.set('b');
    s.set('c');
    expect(seen).toEqual(['a', 'b', 'c']);
    dispose();
  });

  it('cleanup function runs before the next invocation and on dispose', () => {
    const s = signal(0);
    const cleanups: number[] = [];
    const dispose = effect(() => {
      const v = s.value;
      return () => cleanups.push(v);
    });
    s.set(1);
    s.set(2);
    expect(cleanups).toEqual([0, 1]);
    dispose();
    expect(cleanups).toEqual([0, 1, 2]);
  });

  it(
    'disposing detaches the effect — further writes do not re-run it',
    () => {
      const s = signal(0);
      const spy = vi.fn(() => {
        void s.value;
      });
      const dispose = effect(spy);
      expect(spy).toHaveBeenCalledTimes(1);
      s.set(1);
      expect(spy).toHaveBeenCalledTimes(2);
      dispose();
      s.set(2);
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );

  it('cleanup callback is invoked on dispose (current behavior)', () => {
    let cleanups = 0;
    const dispose = effect(() => {
      return () => {
        cleanups += 1;
      };
    });
    dispose();
    expect(cleanups).toBe(1);
  });
});

describe('batch', () => {
  it('coalesces multiple writes to the same signal into one effect run', () => {
    const s = signal(0);
    let runs = 0;
    let lastSeen = -1;
    const dispose = effect(() => {
      runs += 1;
      lastSeen = s.value;
    });
    expect(runs).toBe(1);
    batch(() => {
      s.set(1);
      s.set(2);
      s.set(3);
    });
    expect(runs).toBe(2);
    expect(lastSeen).toBe(3);
    dispose();
  });

  it('coalesces writes across multiple signals subscribed by one effect', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      void a.value;
      void b.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    batch(() => {
      a.set(1);
      b.set(1);
      a.set(2);
    });
    expect(runs).toBe(2);
    dispose();
  });

  it('flushes pending effects even when the batched fn throws', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      void s.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    expect(() =>
      batch(() => {
        s.set(1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(runs).toBe(2);
    dispose();
  });
});
