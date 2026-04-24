/**
 * dnd/projection.ts — visual-only layout projection during drag.
 *
 * Purpose: let siblings and drop slots react to the hovered target without
 * committing application state on every pointer move. The controller is
 * the only caller; app code never touches projections directly.
 */

export type ProjectionSourceMode = 'ghost' | 'hidden' | 'inert';

export class Projection {
  private _source: HTMLElement | null = null;
  private _activeEl: HTMLElement | null = null;
  private _decorated: Set<HTMLElement> = new Set();

  setSourceGhost(el: HTMLElement | null, mode: ProjectionSourceMode = 'ghost'): void {
    this._source = el;
    if (!el) return;
    el.setAttribute('data-dnd-source', mode);
    this._decorated.add(el);
  }

  setActiveTarget(el: HTMLElement | null): void {
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
   */
  markCandidates(elements: Iterable<HTMLElement>): void {
    for (const el of elements) {
      if (!el) continue;
      el.setAttribute('data-dnd-candidate', 'true');
      this._decorated.add(el);
    }
  }

  clear(): void {
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
