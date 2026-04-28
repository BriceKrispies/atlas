/**
 * Shared utilities for atlas design-system custom elements.
 *
 * These are the building blocks every element file imports. Keep the surface
 * small and ergonomic — changes here ripple to every component.
 *
 * Import path (preferred):
 *   import { uid, escapeAttr, escapeText, createSheet, adoptSheet } from '@atlas/design/util';
 *
 * Re-exported from the package barrel too (`@atlas/design`), but the dedicated
 * `/util` subpath keeps tree-shaking and author intent obvious.
 */

/**
 * Generate a collision-resistant unique id string.
 *
 * Uses `crypto.randomUUID()` when available and slices to 8 hex chars; falls
 * back to `Math.random()` base36. One call = one new id — nothing is memoized.
 *
 * @param prefix Human-readable prefix. The returned id is `${prefix}-${suffix}`.
 */
export function uid(prefix: string): string {
  let suffix: string;
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    suffix = cryptoObj.randomUUID().replace(/-/g, '').slice(0, 8);
  } else {
    suffix = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}-${suffix}`;
}

/**
 * Escape a value for safe interpolation inside a double-quoted HTML attribute
 * (`attr="…"`). Escapes `&`, `"`, `<`, `>`, `'`.
 *
 * Callers MUST wrap the result in double quotes. Single-quoted attributes are
 * unsupported by this escaper.
 */
export function escapeAttr(s: unknown): string {
  const str = s == null ? '' : String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a value for safe interpolation into HTML text content via innerHTML.
 * Escapes `&`, `<`, `>` only — quotes are legal in text nodes.
 */
export function escapeText(s: unknown): string {
  const str = s == null ? '' : String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Construct a `CSSStyleSheet` from CSS text. Intended to be called ONCE at
 * module scope per component file, then adopted by shadow roots via
 * {@link adoptSheet}.
 *
 * Replaces the legacy `<style>${cssText}</style>` interpolation pattern —
 * constructible stylesheets are shared across instances, skip re-parsing, and
 * don't bloat the shadow tree.
 */
export function createSheet(cssText: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  return sheet;
}

/**
 * Adopt `sheet` into `root.adoptedStyleSheets` without clobbering existing
 * entries. Idempotent: passing the same sheet twice is a no-op.
 */
export function adoptSheet(root: ShadowRoot, sheet: CSSStyleSheet): void {
  const current = root.adoptedStyleSheets;
  if (current.includes(sheet)) return;
  root.adoptedStyleSheets = [...current, sheet];
}
