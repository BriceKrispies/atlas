/**
 * observeSize(element) — wrap ResizeObserver in a signal.
 *
 * Returns `{ size, dispose }` where `size` is a writable signal carrying
 * `{ width, height }` and `dispose()` stops observing. Consumers can
 * depend on `size.value` inside an `effect()` to re-render on resize.
 *
 * No polling; fully reactive. Complies with frontend rule C14.
 */

import { signal, type Signal } from '@atlas/core';

export interface ElementSize {
  width: number;
  height: number;
}

export interface SizeObservation {
  size: Signal<ElementSize>;
  dispose: () => void;
}

export function observeSize(element: Element): SizeObservation {
  const initial = readSize(element);
  const size = signal<ElementSize>(initial);
  let observer: ResizeObserver | null = null;

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      const entry = entries[0]!;
      const rect = entry.contentRect || readSize(element);
      size.set({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) });
    });
    try { observer.observe(element); } catch { /* element may not be observable yet */ }
  }

  return {
    size,
    dispose(): void {
      if (observer) observer.disconnect();
      observer = null;
    },
  };
}

function readSize(el: Element | null | undefined): ElementSize {
  if (!el) return { width: 0, height: 0 };
  const width = (el.clientWidth || el.getBoundingClientRect?.().width || 0) | 0;
  const height = (el.clientHeight || el.getBoundingClientRect?.().height || 0) | 0;
  return { width, height };
}
