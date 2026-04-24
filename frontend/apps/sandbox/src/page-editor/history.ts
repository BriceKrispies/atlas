/**
 * HistoryStack + wrapStoreWithHistory — undo/redo for page edits.
 *
 * Strategy: wrap the PageStore at the shell level. Every `save()` that
 * lands on the target pageId captures a `{ prev, next }` frame. `undo()`
 * and `redo()` replay prev/next through `save()` behind a `_replaying`
 * flag so no new frame is pushed for the replay itself — the replay save
 * updates `_lastKnown` so a subsequent live edit captures the correct
 * prev.
 *
 * Depth cap: 100 frames. On overflow the oldest frame is dropped.
 *
 * `clear()` empties the stack — used when the page changes (pageId,
 * template switch, or reload).
 */

import type { PageDocument, PageStore } from '@atlas/page-templates';

const DEFAULT_MAX_DEPTH = 100;

export interface HistoryFrame {
  prev: PageDocument | null;
  next: PageDocument;
}

export interface HistoryStackArgs {
  pageId: string;
  initialDoc: PageDocument | null;
  maxDepth?: number;
  onChange?: () => void;
}

export class HistoryStack {
  pageId: string;
  private _frames: HistoryFrame[] = [];
  private _index = -1;
  private _lastKnown: PageDocument | null;
  private _replaying = false;
  private _maxDepth: number;
  private _onChange: () => void;

  constructor(args: HistoryStackArgs) {
    const { pageId, initialDoc, maxDepth = DEFAULT_MAX_DEPTH, onChange } = args;
    this.pageId = pageId;
    this._lastKnown = initialDoc ?? null;
    this._maxDepth = maxDepth;
    this._onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  /**
   * Record a save that just happened. Called by the wrapped store.
   * No-op when `_replaying` is true (so replays don't re-push frames).
   */
  capture(nextDoc: PageDocument): void {
    if (this._replaying) {
      this._lastKnown = nextDoc;
      this._onChange();
      return;
    }
    const prev = this._lastKnown;
    // Drop any redo tail.
    if (this._index < this._frames.length - 1) {
      this._frames = this._frames.slice(0, this._index + 1);
    }
    this._frames.push({ prev, next: nextDoc });
    if (this._frames.length > this._maxDepth) {
      this._frames.shift();
    } else {
      this._index++;
    }
    this._lastKnown = nextDoc;
    this._onChange();
  }

  get canUndo(): boolean {
    return this._index >= 0;
  }

  get canRedo(): boolean {
    return this._index < this._frames.length - 1;
  }

  get depth(): number {
    return this._index + 1;
  }

  /**
   * Apply the previous frame's `prev` doc by calling `saveFn`.
   * Returns the frame that was undone, or null if no undo available.
   */
  async undo(saveFn: (doc: PageDocument | null) => Promise<void>): Promise<HistoryFrame | null> {
    if (!this.canUndo) return null;
    const frame = this._frames[this._index];
    if (!frame) return null;
    this._replaying = true;
    try {
      await saveFn(frame.prev);
      this._lastKnown = frame.prev;
    } finally {
      this._replaying = false;
    }
    this._index--;
    this._onChange();
    return frame;
  }

  /**
   * Re-apply the frame ahead of the current index.
   */
  async redo(saveFn: (doc: PageDocument) => Promise<void>): Promise<HistoryFrame | null> {
    if (!this.canRedo) return null;
    const frame = this._frames[this._index + 1];
    if (!frame) return null;
    this._replaying = true;
    try {
      await saveFn(frame.next);
      this._lastKnown = frame.next;
    } finally {
      this._replaying = false;
    }
    this._index++;
    this._onChange();
    return frame;
  }

  clear(initialDoc: PageDocument | null): void {
    this._frames = [];
    this._index = -1;
    this._lastKnown = initialDoc ?? null;
    this._onChange();
  }
}

export type PageSubscriber = (doc: PageDocument) => void;

export interface WrappedPageStore extends PageStore {
  subscribe(pageId: string, cb: PageSubscriber): () => void;
}

/**
 * Wrap a PageStore so that saves for the given pageId update the
 * HistoryStack AND notify per-pageId subscribers. All other methods pass
 * through to the inner store.
 *
 * Subscribers are used by the Page Editor's live preview pane (Phase F)
 * to re-render when the canvas commits an edit. The wrapper owns its own
 * subscriber table so the underlying store (in-memory, validating,
 * future HTTP) doesn't need a subscribe API.
 */
export function wrapStoreWithHistory(inner: PageStore, history: HistoryStack): WrappedPageStore {
  const subscribers = new Map<string, Set<PageSubscriber>>();

  return {
    get: (pageId: string) => inner.get(pageId),
    save: async (pageId: string, doc: PageDocument): Promise<void> => {
      await inner.save(pageId, doc);
      if (pageId === history.pageId) history.capture(doc);
      const subs = subscribers.get(pageId);
      if (subs && subs.size > 0) {
        for (const cb of subs) {
          try { cb(doc); } catch (err) { console.error('[history] subscriber threw', err); }
        }
      }
    },
    list: () => inner.list(),
    delete: (pageId: string) => inner.delete(pageId),
    subscribe: (pageId: string, cb: PageSubscriber): (() => void) => {
      if (typeof cb !== 'function') return () => {};
      let set = subscribers.get(pageId);
      if (!set) {
        set = new Set();
        subscribers.set(pageId, set);
      }
      set.add(cb);
      return () => {
        subscribers.get(pageId)?.delete(cb);
      };
    },
  };
}
