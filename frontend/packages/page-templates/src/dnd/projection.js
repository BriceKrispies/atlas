/**
 * dnd/projection.js — visual-only layout projection during drag.
 *
 * Purpose: let siblings and drop slots react to the hovered target without
 * committing application state on every pointer move. The controller is
 * the only caller; app code never touches projections directly.
 *
 * API:
 *   setSourceGhost(el, mode)   — mark the origin element so it renders as
 *                                 inert/ghosted/hidden/placeholder.
 *                                 mode: 'ghost' | 'hidden' | 'inert'.
 *   setActiveTarget(target)    — flag the currently-projected target with
 *                                 [data-dnd-over]. Caller passes null to
 *                                 clear.
 *   clear()                    — remove all projection attributes.
 *
 * Future work: animated reorder via FLIP — capture first positions on
 * setActiveTarget, invert-play after the DOM reorders. That belongs HERE,
 * not in the commit layer.
 */

export class Projection {
  constructor() {
    /** @type {HTMLElement | null} */
    this._source = null;
    /** @type {HTMLElement | null} */
    this._activeEl = null;
    /** @type {Set<HTMLElement>} */
    this._decorated = new Set();
  }

  /**
   * @param {HTMLElement} el
   * @param {'ghost' | 'hidden' | 'inert'} mode
   */
  setSourceGhost(el, mode = 'ghost') {
    this._source = el;
    if (!el) return;
    el.setAttribute('data-dnd-source', mode);
    this._decorated.add(el);
  }

  /** @param {HTMLElement | null} el */
  setActiveTarget(el) {
    if (this._activeEl === el) return;
    if (this._activeEl) {
      this._activeEl.removeAttribute('data-dnd-over');
    }
    this._activeEl = el;
    if (el) {
      el.setAttribute('data-dnd-over', 'true');
      this._decorated.add(el);
    }
  }

  /**
   * Mark candidate droppables visually so users see where they can drop.
   * Called once at drag start; cleared in clear().
   *
   * @param {Iterable<HTMLElement>} elements
   */
  markCandidates(elements) {
    for (const el of elements) {
      if (!el) continue;
      el.setAttribute('data-dnd-candidate', 'true');
      this._decorated.add(el);
    }
  }

  clear() {
    for (const el of this._decorated) {
      el.removeAttribute('data-dnd-source');
      el.removeAttribute('data-dnd-over');
      el.removeAttribute('data-dnd-candidate');
    }
    this._decorated.clear();
    this._source = null;
    this._activeEl = null;
  }
}
