/**
 * layout-document.js — shape + validator for layout documents.
 *
 * A layout document describes a page layout as a grid of named slots.
 * Each slot is a rectangle (col, row, colSpan, rowSpan) in a fixed
 * column grid with a fixed row height and gap. The slot's `name` is
 * the stable identifier that widget entries bind to in page documents.
 *
 * Layouts are data, not code: they can be created, saved, edited, and
 * versioned independently of the content (widgets) that fills them. A
 * `<content-page>` that references a `layoutId` resolves the doc from
 * a `LayoutStore`, renders via `<atlas-layout>`, and a `<widget-host>`
 * populates each section.
 *
 * Validation is intentionally exhaustive — the editor builds docs
 * interactively, so a clear rejection reason is worth the code.
 *
 * @typedef {{
 *   columns: number,     // integer, >= 1
 *   rowHeight: number,   // pixels, > 0
 *   gap: number,         // pixels, >= 0
 * }} LayoutGrid
 *
 * @typedef {{
 *   name: string,        // non-empty, unique within the layout
 *   col: number,         // 1-based, >= 1
 *   row: number,         // 1-based, >= 1
 *   colSpan: number,     // >= 1
 *   rowSpan: number,     // >= 1
 * }} LayoutSlot
 *
 * @typedef {{
 *   layoutId: string,
 *   version: string,                 // 'MAJOR.MINOR.PATCH'
 *   displayName?: string,
 *   description?: string,
 *   grid: LayoutGrid,
 *   slots: LayoutSlot[],
 * }} LayoutDocument
 */

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Validate a layout document.
 *
 * @param {unknown} doc
 * @returns {{ ok: true } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function validateLayoutDocument(doc) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });

  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
  }
  /** @type {any} */
  const d = doc;

  if (typeof d.layoutId !== 'string' || d.layoutId.length === 0) {
    push('layoutId', 'must be a non-empty string');
  }
  if (typeof d.version !== 'string' || !SEMVER_RE.test(d.version)) {
    push('version', 'must match MAJOR.MINOR.PATCH');
  }
  if (d.displayName != null && typeof d.displayName !== 'string') {
    push('displayName', 'must be a string when present');
  }
  if (d.description != null && typeof d.description !== 'string') {
    push('description', 'must be a string when present');
  }

  // Grid
  if (d.grid == null || typeof d.grid !== 'object') {
    push('grid', 'must be an object');
  } else {
    const g = d.grid;
    if (!Number.isInteger(g.columns) || g.columns < 1) {
      push('grid.columns', 'must be an integer >= 1');
    }
    if (typeof g.rowHeight !== 'number' || !(g.rowHeight > 0)) {
      push('grid.rowHeight', 'must be a positive number');
    }
    if (typeof g.gap !== 'number' || g.gap < 0) {
      push('grid.gap', 'must be a number >= 0');
    }
  }

  // Slots
  if (!Array.isArray(d.slots)) {
    push('slots', 'must be an array');
  } else {
    const seen = new Set();
    const columns = d.grid?.columns;
    for (let i = 0; i < d.slots.length; i++) {
      const s = d.slots[i];
      const base = `slots[${i}]`;
      if (s == null || typeof s !== 'object') {
        push(base, 'must be an object');
        continue;
      }
      if (typeof s.name !== 'string' || !SLOT_NAME_RE.test(s.name)) {
        push(`${base}.name`, 'must match /^[a-zA-Z][a-zA-Z0-9_-]*$/');
      } else if (seen.has(s.name)) {
        push(`${base}.name`, `duplicate slot name "${s.name}"`);
      } else {
        seen.add(s.name);
      }
      if (!Number.isInteger(s.col) || s.col < 1) {
        push(`${base}.col`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(s.row) || s.row < 1) {
        push(`${base}.row`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(s.colSpan) || s.colSpan < 1) {
        push(`${base}.colSpan`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(s.rowSpan) || s.rowSpan < 1) {
        push(`${base}.rowSpan`, 'must be an integer >= 1');
      }
      if (
        Number.isInteger(columns) &&
        Number.isInteger(s.col) &&
        Number.isInteger(s.colSpan) &&
        s.col + s.colSpan - 1 > columns
      ) {
        push(
          `${base}`,
          `extends beyond grid.columns (col=${s.col}, colSpan=${s.colSpan}, columns=${columns})`,
        );
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Structural clone of a layout document. Useful for the editor to mutate
 * a working copy without touching the stored original.
 *
 * @param {LayoutDocument} doc
 * @returns {LayoutDocument}
 */
export function cloneLayoutDocument(doc) {
  return structuredClone(doc);
}

/**
 * Produce an empty layout document with sensible defaults. Handy for the
 * editor's "New layout" entry point and for tests.
 *
 * @param {{ layoutId: string, displayName?: string }} args
 * @returns {LayoutDocument}
 */
export function emptyLayoutDocument({ layoutId, displayName }) {
  return {
    layoutId,
    version: '0.1.0',
    displayName: displayName ?? layoutId,
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [],
  };
}

/**
 * Find the first column/row position where a slot of (colSpan, rowSpan)
 * fits without overlapping any existing slot. Used by the editor when
 * adding a new slot so the user doesn't have to hand-pick coordinates.
 *
 * @param {LayoutDocument} doc
 * @param {{ colSpan?: number, rowSpan?: number }} [size]
 * @returns {{ col: number, row: number, colSpan: number, rowSpan: number }}
 */
export function nextFreeRect(doc, size) {
  const colSpan = Math.max(1, size?.colSpan ?? 4);
  const rowSpan = Math.max(1, size?.rowSpan ?? 2);
  const columns = doc.grid.columns;
  for (let row = 1; row < 1000; row++) {
    for (let col = 1; col + colSpan - 1 <= columns; col++) {
      if (!_rectOverlapsAny(doc.slots, { col, row, colSpan, rowSpan })) {
        return { col, row, colSpan, rowSpan };
      }
    }
  }
  // Should never happen in practice; fall back to row 1.
  return { col: 1, row: 1, colSpan, rowSpan };
}

function _rectOverlapsAny(slots, r) {
  for (const s of slots) {
    if (
      r.col < s.col + s.colSpan &&
      r.col + r.colSpan > s.col &&
      r.row < s.row + s.rowSpan &&
      r.row + r.rowSpan > s.row
    ) {
      return true;
    }
  }
  return false;
}
