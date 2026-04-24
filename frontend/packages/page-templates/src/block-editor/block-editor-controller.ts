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
 */

import { makeCommit, type CommitRecord } from '@atlas/test-state';

export type BlockType = 'text' | 'heading' | 'list' | 'image-placeholder';

export interface BlockContentImage {
  alt?: string;
  src?: string;
}

export type BlockContent = string | string[] | BlockContentImage;

export interface Block {
  blockId: string;
  type: BlockType;
  content: BlockContent;
  config: Record<string, unknown>;
}

export interface BlockDocument {
  blocks: Block[];
}

export interface BlockEditorSnapshot {
  surfaceId: string;
  document: BlockDocument;
  selection: string | null;
  dirty: boolean;
  lastCommit: CommitRecord | null;
}

export type BlockEditorListener = (snapshot: BlockEditorSnapshot) => void;

export interface BlockEditorOptions {
  surfaceId?: string;
  document?: BlockDocument | null;
}

export type CommitOk = { ok: true; commit?: CommitRecord };
export type CommitFail = { ok: false; reason: string };
export type CommitResult = CommitOk | CommitFail;

export interface InsertBlockPatch {
  blockId?: string;
  type?: BlockType;
  content?: BlockContent;
  config?: Record<string, unknown>;
  at?: number;
}

export interface RemoveBlockPatch {
  blockId?: string;
}

export interface MoveBlockPatch {
  blockId?: string;
  to?: number;
  from?: number;
}

export interface UpdateBlockPatch {
  blockId?: string;
  patch?: { content?: BlockContent; config?: Record<string, unknown> };
}

export interface SelectionPatch {
  blockId?: string | null;
}

export interface FormattingPatch {
  blockId?: string;
  format?: string;
}

const SUPPORTED_TYPES = new Set<BlockType>(['text', 'heading', 'list', 'image-placeholder']);

export class BlockEditorController {
  private _surfaceId: string;
  private _blocks: Block[];
  private _selection: string | null = null;
  private _dirty = false;
  private _lastCommit: CommitRecord | null = null;
  private _listeners: Set<BlockEditorListener> = new Set();

  constructor({ surfaceId, document: doc }: BlockEditorOptions = {}) {
    this._surfaceId = surfaceId ?? 'editor:block';
    this._blocks = Array.isArray(doc?.blocks) ? structuredClone(doc!.blocks) : [];
  }

  // ── accessors ───────────────────────────────────────────────────

  get surfaceId(): string {
    return this._surfaceId;
  }
  get document(): BlockDocument {
    return { blocks: structuredClone(this._blocks) };
  }
  get selection(): string | null {
    return this._selection;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get lastCommit(): CommitRecord | null {
    return this._lastCommit;
  }

  getSnapshot(): BlockEditorSnapshot {
    return {
      surfaceId: this._surfaceId,
      document: { blocks: structuredClone(this._blocks) },
      selection: this._selection,
      dirty: this._dirty,
      lastCommit: this._lastCommit,
    };
  }

  subscribe(fn: BlockEditorListener): () => void {
    this._listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this._listeners.delete(fn);
    };
  }

  // ── commit entry point ──────────────────────────────────────────

  /**
   * Every user intent flows through this method. Returns the commit
   * record on success; `{ ok: false, reason }` on rejection.
   */
  commit(intent: string, patch: Record<string, unknown>): CommitResult {
    const result = this._apply(intent, patch);
    if (!result.ok) return result;
    this._lastCommit = makeCommit(this._surfaceId, intent, patch);
    if (!isReadOnlyIntent(intent)) this._dirty = true;
    this._notify();
    return { ok: true, commit: this._lastCommit };
  }

  markClean(): void {
    this._dirty = false;
    this._notify();
  }

  // ── intent handlers ─────────────────────────────────────────────

  private _apply(intent: string, patch: Record<string, unknown>): CommitResult {
    switch (intent) {
      case 'insertBlock':
        return this._insertBlock(patch as InsertBlockPatch);
      case 'removeBlock':
        return this._removeBlock(patch as RemoveBlockPatch);
      case 'moveBlock':
        return this._moveBlock(patch as MoveBlockPatch);
      case 'updateBlock':
        return this._updateBlock(patch as UpdateBlockPatch);
      case 'setSelection':
        return this._setSelection(patch as SelectionPatch);
      case 'applyFormatting':
        return this._applyFormatting(patch as FormattingPatch);
      default:
        return { ok: false, reason: 'unknown-intent' };
    }
  }

  private _insertBlock(
    { blockId, type, content, config, at }: InsertBlockPatch = {},
  ): CommitResult {
    if (!blockId) return { ok: false, reason: 'invalid-blockId' };
    if (!type || !SUPPORTED_TYPES.has(type)) return { ok: false, reason: 'unsupported-type' };
    if (this._blocks.some((b) => b.blockId === blockId)) {
      return { ok: false, reason: 'duplicate-blockId' };
    }
    const index = Number.isFinite(at)
      ? clamp(at as number, 0, this._blocks.length)
      : this._blocks.length;
    this._blocks.splice(index, 0, {
      blockId,
      type,
      content: content ?? defaultContentFor(type),
      config: config ?? {},
    });
    return { ok: true };
  }

  private _removeBlock({ blockId }: RemoveBlockPatch = {}): CommitResult {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    this._blocks.splice(idx, 1);
    if (this._selection === blockId) this._selection = null;
    return { ok: true };
  }

  private _moveBlock({ blockId, to }: MoveBlockPatch = {}): CommitResult {
    const from = this._indexOf(blockId);
    if (from < 0) return { ok: false, reason: 'block-not-found' };
    const targetRaw = Number.isFinite(to) ? (to as number) : this._blocks.length - 1;
    const target = clamp(targetRaw, 0, this._blocks.length - 1);
    if (from === target) return { ok: true };
    const [picked] = this._blocks.splice(from, 1);
    if (!picked) return { ok: false, reason: 'block-not-found' };
    this._blocks.splice(target, 0, picked);
    return { ok: true };
  }

  private _updateBlock({ blockId, patch }: UpdateBlockPatch = {}): CommitResult {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid-patch' };
    const current = this._blocks[idx]!;
    this._blocks[idx] = {
      ...current,
      content: patch.content ?? current.content,
      config: patch.config ? { ...current.config, ...patch.config } : current.config,
    };
    return { ok: true };
  }

  private _setSelection({ blockId }: SelectionPatch = {}): CommitResult {
    if (blockId === null || blockId === undefined) {
      this._selection = null;
      return { ok: true };
    }
    if (this._indexOf(blockId) < 0) return { ok: false, reason: 'block-not-found' };
    this._selection = blockId;
    return { ok: true };
  }

  private _applyFormatting({ blockId, format }: FormattingPatch = {}): CommitResult {
    const idx = this._indexOf(blockId);
    if (idx < 0) return { ok: false, reason: 'block-not-found' };
    if (!format) return { ok: false, reason: 'invalid-patch' };
    const current = this._blocks[idx]!;
    const formats = new Set<string>(
      (current.config?.['formats'] as string[] | undefined) ?? [],
    );
    if (formats.has(format)) formats.delete(format);
    else formats.add(format);
    this._blocks[idx] = {
      ...current,
      config: { ...current.config, formats: [...formats] },
    };
    return { ok: true };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private _indexOf(blockId: string | undefined): number {
    if (!blockId) return -1;
    return this._blocks.findIndex((b) => b.blockId === blockId);
  }

  private _notify(): void {
    const snap = this.getSnapshot();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore */
      }
    }
  }
}

function defaultContentFor(type: BlockType): BlockContent {
  switch (type) {
    case 'heading':
      return 'New heading';
    case 'list':
      return ['Item 1', 'Item 2'];
    case 'image-placeholder':
      return { alt: '', src: '' };
    case 'text':
    default:
      return 'New text block';
  }
}

function isReadOnlyIntent(intent: string): boolean {
  return intent === 'setSelection';
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}
