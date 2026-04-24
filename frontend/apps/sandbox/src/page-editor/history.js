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

const DEFAULT_MAX_DEPTH = 100;

export class HistoryStack {
  /**
   * @param {{ pageId: string, initialDoc: object | null, maxDepth?: number, onChange?: () => void }} args
   */
  constructor({ pageId, initialDoc, maxDepth = DEFAULT_MAX_DEPTH, onChange } = {}) {
    this.pageId = pageId;
    this._frames = [];
    this._index = -1;
    this._lastKnown = initialDoc ?? null;
    this._replaying = false;
    this._maxDepth = maxDepth;
    this._onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  /**
   * Record a save that just happened. Called by the wrapped store.
   * No-op when `_replaying` is true (so replays don't re-push frames).
   * @param {object} nextDoc — the doc that was saved
   */
  capture(nextDoc) {
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

  /** @returns {boolean} */
  get canUndo() {
    return this._index >= 0;
  }

  /** @returns {boolean} */
  get canRedo() {
    return this._index < this._frames.length - 1;
  }

  /** @returns {number} */
  get depth() {
    return this._index + 1;
  }

  /**
   * Apply the previous frame's `prev` doc by calling `saveFn`.
   * Returns the frame that was undone, or null if no undo available.
   * @param {(doc: object | null) => Promise<void>} saveFn
   */
  async undo(saveFn) {
    if (!this.canUndo) return null;
    const frame = this._frames[this._index];
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
   * @param {(doc: object) => Promise<void>} saveFn
   */
  async redo(saveFn) {
    if (!this.canRedo) return null;
    const frame = this._frames[this._index + 1];
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

  clear(initialDoc) {
    this._frames = [];
    this._index = -1;
    this._lastKnown = initialDoc ?? null;
    this._onChange();
  }
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
 *
 * @param {import('@atlas/page-templates').PageStore} inner
 * @param {HistoryStack} history
 */
export function wrapStoreWithHistory(inner, history) {
  /** @type {Map<string, Set<(doc: object) => void>>} */
  const subscribers = new Map();

  return {
    get: (pageId) => inner.get(pageId),
    save: async (pageId, doc) => {
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
    delete: (pageId) => inner.delete(pageId),
    /**
     * @param {string} pageId
     * @param {(doc: object) => void} cb
     * @returns {() => void} unsubscribe
     */
    subscribe: (pageId, cb) => {
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
