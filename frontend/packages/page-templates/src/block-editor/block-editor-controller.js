/**
 * BlockEditorController — pure state machine for block-based content
 * documents.
 *
 * The document is a flat ordered list of blocks:
 *   { blockId, type, content, config }
 *
 * Supported block types: 'text', 'heading', 'list', 'image-placeholder'.
 * The controller validates nothing about type payloads — the element
 * layer decides what to render.
 *
 * Every mutation records `lastCommit` in the shape documented in
 * `specs/frontend/interaction-contracts.md`:
 *   { surfaceId, intent, patch, at }
 *
 * The controller is deliberately framework-free: no DOM, no signals, no
 * async. The element layer adapts it.
 */

import { makeCommit } from '@atlas/test-state';

const SUPPORTED_TYPES = new Set(['text', 'heading', 'list', 'image-placeholder']);

export class BlockEditorController {
  /**
   * @param {{ surfaceId: string, document?: { blocks: Array<object> } }} opts
   */
  constructor({ surfaceId, document: doc } = {}) {
    this._surfaceId = surfaceId ?? 'editor:block';
    this._blocks = Array.isArray(doc?.blocks) ? structuredClone(doc.blocks) : [];
    this._selection = null;
    this._dirty = false;
    this._lastCommit = null;
    /** @type {Set<(snapshot: object) => void>} */
    this._listeners = new Set();
  }

  // ── accessors ───────────────────────────────────────────────────

  get surfaceId() { return this._surfaceId; }
  get document() { return { blocks: structuredClone(this._blocks) }; }
  get selection() { return this._selection; }
  get dirty() { return this._dirty; }
  get lastCommit() { return this._lastCommit; }

  getSnapshot() {
    return {
      surfaceId: this._surfaceId,
      document: { blocks: structuredClone(this._blocks) },
      selection: this._selection,
      dirty: this._dirty,
      lastCommit: this._lastCommit,
    };
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.getSnapshot());
    return () => this._listeners.delete(fn);
  }

  // ── commit entry point ──────────────────────────────────────────

  /**
   * Every user intent flows through this method. Returns the commit
   * record on success; `{ ok: false, reason }` on rejection.
   *
   * @param {string} intent
   * @param {object} patch
   */
  commit(intent, patch) {
    const result = this._apply(intent, patch);
    if (!result.ok) return result;
    this._lastCommit = makeCommit(this._surfaceId, intent, patch);
    if (!isReadOnlyIntent(intent)) this._dirty = true;
    this._notify();
    return { ok: true, commit: this._lastCommit };
  }

  markClean() {
    this._dirty = false;
    this._notify();
  }

  // ── intent handlers ─────────────────────────────────────────────

  _apply(intent, patch) {
    switch (intent) {
      case 'insertBlock': return this._insertBlock(patch);
      case 'removeBlock': return this._removeBlock(patch);
      case 'moveBlock':   return this._moveBlock(patch);
      case 'updateBlock': return this._updateBlock(patch);
      case 'setSelection': return this._setSelection(patch);
      case 'applyFormatting': return this._applyFormatting(patch);
      default: return { ok: false, reason: 'unknown-intent' };
    }
  }

  _insertBlock({ blockId, type, content, config, at } = {}) {
    if (!blockId) return { ok: false, reason: 'invalid-blockId' };
    if (!SUPPORTED_TYPES.has(type)) return { ok: false, reason: 'unsupported-type' };
    if (this._blocks.some((b) => b.blockId === blockId)) {
      return { ok: false, reason: 'duplicate-blockId' };
    }
    const index = Number.isFinite(at) ? clamp(at, 0, this._blocks.length) : this._blocks.length;
    this._blocks.splice(index, 0, {
      blockId,
      type,
      content: content ?? defaultContentFor(type),
      config: config ?? {},
    });
    return { ok: true };
  }

  _removeBlock({ blockId } = {}) {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    this._blocks.splice(idx, 1);
    if (this._selection === blockId) this._selection = null;
    return { ok: true };
  }

  _moveBlock({ blockId, to } = {}) {
    const from = this._indexOf(blockId);
    if (from < 0) return { ok: false, reason: 'block-not-found' };
    const targetRaw = Number.isFinite(to) ? to : this._blocks.length - 1;
    const target = clamp(targetRaw, 0, this._blocks.length - 1);
    if (from === target) return { ok: true };
    const [picked] = this._blocks.splice(from, 1);
    this._blocks.splice(target, 0, picked);
    return { ok: true };
  }

  _updateBlock({ blockId, patch } = {}) {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid-patch' };
    const current = this._blocks[idx];
    this._blocks[idx] = {
      ...current,
      content: patch.content ?? current.content,
      config: patch.config ? { ...current.config, ...patch.config } : current.config,
    };
    return { ok: true };
  }

  _setSelection({ blockId } = {}) {
    if (blockId === null || blockId === undefined) {
      this._selection = null;
      return { ok: true };
    }
    if (this._indexOf(blockId) < 0) return { ok: false, reason: 'block-not-found' };
    this._selection = blockId;
    return { ok: true };
  }

  _applyFormatting({ blockId, format } = {}) {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    const current = this._blocks[idx];
    const formats = new Set(current.config?.formats ?? []);
    if (formats.has(format)) formats.delete(format);
    else formats.add(format);
    this._blocks[idx] = {
      ...current,
      config: { ...current.config, formats: [...formats] },
    };
    return { ok: true };
  }

  // ── helpers ─────────────────────────────────────────────────────

  _indexOf(blockId) {
    return this._blocks.findIndex((b) => b.blockId === blockId);
  }

  _notify() {
    const snap = this.getSnapshot();
    for (const fn of this._listeners) {
      try { fn(snap); } catch { /* ignore */ }
    }
  }
}

function defaultContentFor(type) {
  switch (type) {
    case 'heading': return 'New heading';
    case 'list':    return ['Item 1', 'Item 2'];
    case 'image-placeholder': return { alt: '', src: '' };
    case 'text':
    default:        return 'New text block';
  }
}

function isReadOnlyIntent(intent) {
  return intent === 'setSelection';
}

function clamp(n, lo, hi) {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}
