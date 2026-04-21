/**
 * EditorController — framework-agnostic coordinator for <content-page edit>.
 *
 * Holds a mutable CLONE of the stored page doc (the PageStore's copy is
 * never mutated directly). Exposes pickUp / cancel / drop / deleteInstance
 * mutations that return either { ok: true, nextDoc } or
 * { ok: false, reason } — the caller is responsible for persisting the
 * nextDoc via pageStore.save and reloading.
 *
 * Valid-target caching: drops are validated against the same constraint
 * computation that was done on pickUp. Recomputation happens every pickUp.
 *
 * Events:
 *   'statechange' — fires after every transition of picked state
 *     (pickUp, cancel, drop-success, deleteInstance-success).
 */

import { computeValidTargets } from '../drop-zones.js';

/**
 * @typedef {object} Source
 * @property {string} regionName
 * @property {number} index
 */

/**
 * @typedef {object} PickedState
 * @property {string} widgetId
 * @property {Source | 'palette'} source
 * @property {('pointer'|'keyboard')} via
 * @property {ReturnType<typeof computeValidTargets>} validTargets
 */

export class EditorController {
  /**
   * @param {object} options
   * @param {object} options.pageDoc — initial doc; will be cloned internally.
   * @param {object} options.templateManifest
   * @param {object} options.widgetRegistry
   */
  constructor({ pageDoc, templateManifest, widgetRegistry }) {
    if (!pageDoc || typeof pageDoc !== 'object') {
      throw new TypeError('EditorController requires a pageDoc');
    }
    if (!templateManifest) {
      throw new TypeError('EditorController requires a templateManifest');
    }
    if (!widgetRegistry) {
      throw new TypeError('EditorController requires a widgetRegistry');
    }
    this._doc = structuredClone(pageDoc);
    this._template = templateManifest;
    this._registry = widgetRegistry;
    /** @type {PickedState | null} */
    this._picked = null;
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  // ---- accessors ----

  /** Current (mutable) cloned doc. */
  get doc() {
    return this._doc;
  }

  /** Replace the working doc (after a successful save + reload). */
  setDoc(nextDoc) {
    this._doc = structuredClone(nextDoc);
    // A fresh doc invalidates any in-flight pickUp.
    if (this._picked) {
      this._picked = null;
      this._emit('statechange', { picked: null });
    }
  }

  get picked() {
    return this._picked;
  }

  getValidTargets() {
    return this._picked ? this._picked.validTargets : null;
  }

  // ---- events ----

  /**
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(event, handler) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // Listener errors must not break state transitions.
        // eslint-disable-next-line no-console
        console.error('[editor-controller] listener threw', err);
      }
    }
  }

  // ---- commands ----

  /**
   * Begin a drag/move. Computes the valid-target cache against the
   * current doc. Replaces any prior picked state.
   */
  pickUp({ widgetId, source, via }) {
    if (!widgetId) throw new TypeError('pickUp requires widgetId');
    const sourcePosition =
      source && source !== 'palette' && typeof source === 'object'
        ? { regionName: source.regionName, index: source.index }
        : null;
    const validTargets = computeValidTargets(
      widgetId,
      this._doc,
      this._template,
      this._registry,
      sourcePosition,
    );
    this._picked = {
      widgetId,
      source: sourcePosition ? { regionName: source.regionName, index: source.index } : 'palette',
      via: via === 'keyboard' ? 'keyboard' : 'pointer',
      validTargets,
    };
    this._emit('statechange', { picked: this._picked });
    return this._picked;
  }

  cancel() {
    if (!this._picked) return;
    this._picked = null;
    this._emit('statechange', { picked: null });
  }

  /**
   * Finalize a drop against the cached valid targets.
   * Returns { ok, nextDoc?, reason? } — on success, the controller's
   * internal doc is updated.
   */
  drop({ target }) {
    if (!this._picked) return { ok: false, reason: 'not-picked-up' };
    if (!target || typeof target !== 'object') {
      return { ok: false, reason: 'invalid-target' };
    }
    const { regionName, index } = target;
    const { validTargets, widgetId, source } = this._picked;

    const regionEntry = validTargets.validRegions.find(
      (r) => r.regionName === regionName,
    );
    if (!regionEntry) {
      return { ok: false, reason: 'region-invalid' };
    }
    if (
      !Array.isArray(regionEntry.canInsertAt) ||
      index < 0 ||
      index >= regionEntry.canInsertAt.length ||
      regionEntry.canInsertAt[index] !== true
    ) {
      return { ok: false, reason: regionEntry.reason ?? 'index-invalid' };
    }

    // Apply mutation to a clone of the current doc.
    const next = structuredClone(this._doc);
    if (!next.regions || typeof next.regions !== 'object') next.regions = {};
    if (!Array.isArray(next.regions[regionName])) next.regions[regionName] = [];

    let entryToInsert;
    if (source === 'palette') {
      // New placement — caller must have set config etc. The palette path
      // ships a fresh entry via addFromPalette(); drop() alone can't
      // synthesize one (no config schema knowledge here).
      return { ok: false, reason: 'palette-must-use-addFromPalette' };
    }

    // Move or reorder: remove from current position first.
    const fromEntries = next.regions[source.regionName];
    if (!Array.isArray(fromEntries) || source.index >= fromEntries.length) {
      return { ok: false, reason: 'source-gone' };
    }
    const [picked] = fromEntries.splice(source.index, 1);
    entryToInsert = picked;

    // When moving within the same region, removing shifts subsequent
    // indices down by 1 — adjust the insertion index accordingly.
    let insertIndex = index;
    if (source.regionName === regionName && source.index < index) {
      insertIndex = index - 1;
    }

    next.regions[regionName].splice(insertIndex, 0, entryToInsert);

    this._doc = next;
    this._picked = null;
    this._emit('statechange', { picked: null });
    return {
      ok: true,
      nextDoc: next,
      action: 'move',
      widgetId,
      from: source,
      to: { regionName, index: insertIndex },
    };
  }

  /**
   * Relational drop sugar — "drop before/after the widget currently at
   * anchorIndex in anchorRegion". Thin wrapper around drop() that
   * translates the UI's before/after vocabulary into the insertion
   * index expected by computeValidTargets / drop().
   *
   * @param {object} opts
   * @param {string} opts.anchorRegion
   * @param {number} opts.anchorIndex
   * @param {'before'|'after'} opts.side
   */
  dropRelative({ anchorRegion, anchorIndex, side }) {
    if (typeof anchorIndex !== 'number' || anchorIndex < 0) {
      return { ok: false, reason: 'invalid-anchor' };
    }
    const insertIndex = side === 'before' ? anchorIndex : anchorIndex + 1;
    return this.drop({ target: { regionName: anchorRegion, index: insertIndex } });
  }

  /**
   * Add a new widget from the palette. Caller supplies the fully-formed
   * WidgetInstance (widgetId, instanceId, config). Validated against the
   * current picked valid-target cache if a pickUp is in progress.
   */
  addFromPalette({ entry, target }) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: 'invalid-entry' };
    }
    if (!target || typeof target !== 'object') {
      return { ok: false, reason: 'invalid-target' };
    }

    // Compute a fresh validTargets if pickUp wasn't called (programmatic
    // drop), or reuse the cache if it matches.
    let validTargets;
    if (
      this._picked &&
      this._picked.widgetId === entry.widgetId &&
      this._picked.source === 'palette'
    ) {
      validTargets = this._picked.validTargets;
    } else {
      validTargets = computeValidTargets(
        entry.widgetId,
        this._doc,
        this._template,
        this._registry,
        null,
      );
    }

    const regionEntry = validTargets.validRegions.find(
      (r) => r.regionName === target.regionName,
    );
    if (!regionEntry) {
      return { ok: false, reason: 'region-invalid' };
    }
    if (
      !Array.isArray(regionEntry.canInsertAt) ||
      target.index < 0 ||
      target.index >= regionEntry.canInsertAt.length ||
      regionEntry.canInsertAt[target.index] !== true
    ) {
      return { ok: false, reason: regionEntry.reason ?? 'index-invalid' };
    }

    const next = structuredClone(this._doc);
    if (!next.regions || typeof next.regions !== 'object') next.regions = {};
    if (!Array.isArray(next.regions[target.regionName])) {
      next.regions[target.regionName] = [];
    }
    next.regions[target.regionName].splice(target.index, 0, structuredClone(entry));

    this._doc = next;
    this._picked = null;
    this._emit('statechange', { picked: null });
    return {
      ok: true,
      nextDoc: next,
      action: 'add',
      widgetId: entry.widgetId,
      to: { regionName: target.regionName, index: target.index },
    };
  }

  /**
   * Remove a widget. Any region can be emptied — the "required" flag on
   * templates is informational only; pages may exist with empty regions.
   */
  deleteInstance({ regionName, index }) {
    const next = structuredClone(this._doc);
    if (!next.regions || !Array.isArray(next.regions[regionName])) {
      return { ok: false, reason: 'region-missing' };
    }
    if (index < 0 || index >= next.regions[regionName].length) {
      return { ok: false, reason: 'index-out-of-range' };
    }

    const [removed] = next.regions[regionName].splice(index, 1);
    this._doc = next;
    this._picked = null;
    this._emit('statechange', { picked: null });
    return {
      ok: true,
      nextDoc: next,
      action: 'delete',
      widgetId: removed?.widgetId,
      from: { regionName, index },
    };
  }
}
