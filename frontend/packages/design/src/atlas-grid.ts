import { AtlasElement } from '@atlas/core';

/**
 * <atlas-grid> — CSS grid layout wrapper. Replaces raw `<div style="display:grid;…">`
 * in composed surfaces.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   columns — positive integer (1..12). Lays out `N` equal fraction
 *             columns. The default is "auto" (`grid-auto-flow: row`
 *             with `repeat(auto-fit, minmax(min-col, 1fr))`).
 *   min-col — minimum column width when `columns` is omitted (default
 *             `200px`).
 *   gap     — xs | sm | md (default) | lg | xl
 *   align   — start | center | end | stretch (default) — row-axis
 *             alignment for each cell.
 *   justify — start | center | end | stretch (default) — column-axis.
 */
export class AtlasGrid extends AtlasElement {}

AtlasElement.define('atlas-grid', AtlasGrid);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-grid': AtlasGrid;
  }
}
