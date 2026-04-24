/**
 * Read the chart color palette from CSS custom properties.
 *
 * Falls back to a hard-coded 8-color default if the host element has no
 * tokens attached (common during unit tests in Node/linkedom).
 */

const DEFAULTS: readonly string[] = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#9333ea', '#0891b2', '#ca8a04', '#64748b',
];

/**
 * Read palette colors from CSS custom properties (--atlas-chart-color-1..N).
 * If the host element has no tokens attached (common in linkedom tests),
 * fall back to the default 8-color palette.
 */
export function paletteColors(el: Element | null | undefined, count: number = 8): string[] {
  const root = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const styles = root && typeof getComputedStyle === 'function'
    ? getComputedStyle(root)
    : null;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const fromVar = styles?.getPropertyValue(`--atlas-chart-color-${i + 1}`).trim();
    out.push(fromVar || (DEFAULTS[i % DEFAULTS.length] as string));
  }
  return out;
}

/** Convenience: fetch a single color by 1-based index. */
export function paletteColor(el: Element | null | undefined, index: number): string {
  return paletteColors(el, Math.max(8, index))[index - 1] as string;
}

export function gridColor(el: Element | null | undefined): string {
  const styles = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return styles?.getPropertyValue('--atlas-chart-grid').trim() || '#e5e7eb';
}

export function axisColor(el: Element | null | undefined): string {
  const styles = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return styles?.getPropertyValue('--atlas-chart-axis').trim() || '#6b7280';
}
