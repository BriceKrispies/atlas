/**
 * Read the chart color palette from CSS custom properties.
 *
 * Falls back to a hard-coded 8-color default if the host element has no
 * tokens attached (common during unit tests in Node/linkedom).
 */

const DEFAULTS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#9333ea', '#0891b2', '#ca8a04', '#64748b',
];

/**
 * @param {Element | null | undefined} el — element whose computed style is
 *   queried (inherits from ancestors). If null, the document root is used.
 * @param {number} [count=8]
 * @returns {string[]}
 */
export function paletteColors(el, count = 8) {
  const root = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const styles = root && typeof getComputedStyle === 'function'
    ? getComputedStyle(root)
    : null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const fromVar = styles?.getPropertyValue(`--atlas-chart-color-${i + 1}`).trim();
    out.push(fromVar || DEFAULTS[i % DEFAULTS.length]);
  }
  return out;
}

/** Convenience: fetch a single color by 1-based index. */
export function paletteColor(el, index) {
  return paletteColors(el, Math.max(8, index))[index - 1];
}

export function gridColor(el) {
  const styles = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return styles?.getPropertyValue('--atlas-chart-grid').trim() || '#e5e7eb';
}

export function axisColor(el) {
  const styles = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return styles?.getPropertyValue('--atlas-chart-axis').trim() || '#6b7280';
}
