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
export type LayoutValidationResult = {
    ok: true;
} | {
    ok: false;
    errors: LayoutValidationError[];
};
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/**
 * Type-guard narrowing an unknown to an indexable record. The validator
 * uses this at every nested object layer so we never reach for `as` casts
 * mid-validation. Arrays return false because we treat them separately.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}
/**
 * Validate a layout document.
 */
export function validateLayoutDocument(doc: unknown): LayoutValidationResult {
    const errors: LayoutValidationError[] = [];
    const push = function (path: string, message: string): void {
        errors.push({ path, message });
    };
    if (!isRecord(doc)) {
        return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
    }
    const d = doc;
    const layoutId = d['layoutId'];
    if (typeof layoutId !== 'string' || layoutId.length === 0) {
        push('layoutId', 'must be a non-empty string');
    }
    const version = d['version'];
    if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
        push('version', 'must match MAJOR.MINOR.PATCH');
    }
    const displayName = d['displayName'];
    if (displayName != null && typeof displayName !== 'string') {
        push('displayName', 'must be a string when present');
    }
    const description = d['description'];
    if (description != null && typeof description !== 'string') {
        push('description', 'must be a string when present');
    }
    // Grid
    const grid = d['grid'];
    let gridColumns: number | undefined;
    if (!isRecord(grid)) {
        push('grid', 'must be an object');
    }
    else {
        const g = grid;
        const columns = g['columns'];
        if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1) {
            push('grid.columns', 'must be an integer >= 1');
        }
        else {
            gridColumns = columns;
        }
        const rowHeight = g['rowHeight'];
        if (typeof rowHeight !== 'number' || !(rowHeight > 0)) {
            push('grid.rowHeight', 'must be a positive number');
        }
        const gap = g['gap'];
        if (typeof gap !== 'number' || gap < 0) {
            push('grid.gap', 'must be a number >= 0');
        }
    }
    // Slots
    const slots = d['slots'];
    if (!Array.isArray(slots)) {
        push('slots', 'must be an array');
    }
    else {
        const seen = new Set<string>();
        for (let i = 0; i < slots.length; i++) {
            const s: unknown = slots[i];
            const base = `slots[${i}]`;
            if (!isRecord(s)) {
                push(base, 'must be an object');
                continue;
            }
            const slot = s;
            const name = slot['name'];
            if (typeof name !== 'string' || !SLOT_NAME_RE.test(name)) {
                push(`${base}.name`, 'must match /^[a-zA-Z][a-zA-Z0-9_-]*$/');
            }
            else if (seen.has(name)) {
                push(`${base}.name`, `duplicate slot name "${name}"`);
            }
            else {
                seen.add(name);
            }
            const col = slot['col'];
            if (typeof col !== 'number' || !Number.isInteger(col) || col < 1) {
                push(`${base}.col`, 'must be an integer >= 1');
            }
            const row = slot['row'];
            if (typeof row !== 'number' || !Number.isInteger(row) || row < 1) {
                push(`${base}.row`, 'must be an integer >= 1');
            }
            const colSpan = slot['colSpan'];
            if (typeof colSpan !== 'number' || !Number.isInteger(colSpan) || colSpan < 1) {
                push(`${base}.colSpan`, 'must be an integer >= 1');
            }
            const rowSpan = slot['rowSpan'];
            if (typeof rowSpan !== 'number' || !Number.isInteger(rowSpan) || rowSpan < 1) {
                push(`${base}.rowSpan`, 'must be an integer >= 1');
            }
            if (typeof gridColumns === 'number' &&
                typeof col === 'number' &&
                Number.isInteger(col) &&
                typeof colSpan === 'number' &&
                Number.isInteger(colSpan) &&
                col + colSpan - 1 > gridColumns) {
                push(`${base}`, `extends beyond grid.columns (col=${col}, colSpan=${colSpan}, columns=${gridColumns})`);
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
export function emptyLayoutDocument({ layoutId, displayName, }: EmptyLayoutDocumentArgs): LayoutDocument {
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
        if (r.col < s.col + s.colSpan &&
            r.col + r.colSpan > s.col &&
            r.row < s.row + s.rowSpan &&
            r.row + r.rowSpan > s.row) {
            return true;
        }
    }
    return false;
}
