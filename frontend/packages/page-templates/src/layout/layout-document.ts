/**
 * layout-document.ts — shape + validator for layout documents.
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
 */

export interface LayoutGrid {
  /** integer, >= 1 */
  columns: number;
  /** pixels, > 0 */
  rowHeight: number;
  /** pixels, >= 0 */
  gap: number;
}

export interface LayoutSlot {
  /** non-empty, unique within the layout */
  name: string;
  /** 1-based, >= 1 */
  col: number;
  /** 1-based, >= 1 */
  row: number;
  /** >= 1 */
  colSpan: number;
  /** >= 1 */
  rowSpan: number;
}

export interface LayoutDocument {
  layoutId: string;
  /** 'MAJOR.MINOR.PATCH' */
  version: string;
  displayName?: string;
  description?: string;
  grid: LayoutGrid;
  slots: LayoutSlot[];
}

export interface LayoutValidationError {
  path: string;
  message: string;
}

export type LayoutValidationResult =
  | { ok: true }
  | { ok: false; errors: LayoutValidationError[] };

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Validate a layout document.
 */
export function validateLayoutDocument(doc: unknown): LayoutValidationResult {
  const errors: LayoutValidationError[] = [];
  const push = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
  }
  const d = doc as Record<string, unknown>;

  if (typeof d['layoutId'] !== 'string' || (d['layoutId'] as string).length === 0) {
    push('layoutId', 'must be a non-empty string');
  }
  if (typeof d['version'] !== 'string' || !SEMVER_RE.test(d['version'] as string)) {
    push('version', 'must match MAJOR.MINOR.PATCH');
  }
  if (d['displayName'] != null && typeof d['displayName'] !== 'string') {
    push('displayName', 'must be a string when present');
  }
  if (d['description'] != null && typeof d['description'] !== 'string') {
    push('description', 'must be a string when present');
  }

  // Grid
  const grid = d['grid'];
  if (grid == null || typeof grid !== 'object') {
    push('grid', 'must be an object');
  } else {
    const g = grid as Record<string, unknown>;
    if (!Number.isInteger(g['columns']) || (g['columns'] as number) < 1) {
      push('grid.columns', 'must be an integer >= 1');
    }
    if (typeof g['rowHeight'] !== 'number' || !((g['rowHeight'] as number) > 0)) {
      push('grid.rowHeight', 'must be a positive number');
    }
    if (typeof g['gap'] !== 'number' || (g['gap'] as number) < 0) {
      push('grid.gap', 'must be a number >= 0');
    }
  }

  // Slots
  const slots = d['slots'];
  if (!Array.isArray(slots)) {
    push('slots', 'must be an array');
  } else {
    const seen = new Set<string>();
    const columns =
      grid && typeof grid === 'object'
        ? (grid as Record<string, unknown>)['columns']
        : undefined;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as unknown;
      const base = `slots[${i}]`;
      if (s == null || typeof s !== 'object') {
        push(base, 'must be an object');
        continue;
      }
      const slot = s as Record<string, unknown>;
      if (typeof slot['name'] !== 'string' || !SLOT_NAME_RE.test(slot['name'] as string)) {
        push(`${base}.name`, 'must match /^[a-zA-Z][a-zA-Z0-9_-]*$/');
      } else if (seen.has(slot['name'] as string)) {
        push(`${base}.name`, `duplicate slot name "${slot['name'] as string}"`);
      } else {
        seen.add(slot['name'] as string);
      }
      if (!Number.isInteger(slot['col']) || (slot['col'] as number) < 1) {
        push(`${base}.col`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(slot['row']) || (slot['row'] as number) < 1) {
        push(`${base}.row`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(slot['colSpan']) || (slot['colSpan'] as number) < 1) {
        push(`${base}.colSpan`, 'must be an integer >= 1');
      }
      if (!Number.isInteger(slot['rowSpan']) || (slot['rowSpan'] as number) < 1) {
        push(`${base}.rowSpan`, 'must be an integer >= 1');
      }
      if (
        Number.isInteger(columns) &&
        Number.isInteger(slot['col']) &&
        Number.isInteger(slot['colSpan']) &&
        (slot['col'] as number) + (slot['colSpan'] as number) - 1 > (columns as number)
      ) {
        push(
          `${base}`,
          `extends beyond grid.columns (col=${slot['col'] as number}, colSpan=${slot['colSpan'] as number}, columns=${columns as number})`,
        );
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Structural clone of a layout document. Useful for the editor to mutate
 * a working copy without touching the stored original.
 */
export function cloneLayoutDocument(doc: LayoutDocument): LayoutDocument {
  return structuredClone(doc);
}

export interface EmptyLayoutDocumentArgs {
  layoutId: string;
  displayName?: string;
}

/**
 * Produce an empty layout document with sensible defaults. Handy for the
 * editor's "New layout" entry point and for tests.
 */
export function emptyLayoutDocument({
  layoutId,
  displayName,
}: EmptyLayoutDocumentArgs): LayoutDocument {
  return {
    layoutId,
    version: '0.1.0',
    displayName: displayName ?? layoutId,
    grid: { columns: 12, rowHeight: 160, gap: 16 },
    slots: [],
  };
}

export interface RectSize {
  colSpan?: number;
  rowSpan?: number;
}

export interface FreeRect {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/**
 * Find the first column/row position where a slot of (colSpan, rowSpan)
 * fits without overlapping any existing slot. Used by the editor when
 * adding a new slot so the user doesn't have to hand-pick coordinates.
 */
export function nextFreeRect(doc: LayoutDocument, size?: RectSize): FreeRect {
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

function _rectOverlapsAny(slots: LayoutSlot[], r: FreeRect): boolean {
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
