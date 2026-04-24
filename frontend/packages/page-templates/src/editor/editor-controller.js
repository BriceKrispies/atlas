/**
 * EditorController — pure state machine for page-document mutations.
 *
 * Holds a mutable CLONE of the stored page doc (the PageStore's copy is
 * never mutated directly). Exposes four primitive mutations:
 *
 *   applyAdd     — insert a new widget entry at (region, index)
 *   applyMove    — relocate an existing widget to (region, index) by instanceId
 *   applyUpdate  — replace the config of a widget by instanceId
 *   applyRemove  — remove a widget by instanceId
 *
 * Each returns { ok, nextDoc, ...info } or { ok: false, reason }. The caller
 * (EditorAPI) is responsible for persisting `nextDoc`.
 *
 * Identity is `instanceId`, never (region, index). Indices shift when
 * siblings move; instanceIds don't. Agents can stash an instanceId and
 * safely come back later.
 *
 * Validation covers:
 *   - region exists in template manifest           (INV-TEMPLATE-02)
 *   - region.maxWidgets respected                  (INV-TEMPLATE-04)
 *   - required regions never emptied               (INV-TEMPLATE-05)
 *   - widget is known to the registry
 *   - instanceId collision on add
 *   - instanceId lookup on move/update/remove
 *
 * No DOM, no store, no pointer / keyboard concerns. Plain data in → plain
 * data out.
 */

import { computeValidTargets } from '../drop-zones.js';

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
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  // ---- accessors ----

  get doc() {
    return this._doc;
  }

  setDoc(nextDoc) {
    this._doc = structuredClone(nextDoc);
    this._emit('statechange', { doc: this._doc });
  }

  /**
   * Locate a widget entry by instanceId. O(N) across the whole doc, which
   * is fine — pages rarely hold more than a few dozen widgets.
   * @param {string} instanceId
   * @returns {{region: string, index: number, entry: object} | null}
   */
  findInstance(instanceId) {
    const regions = this._doc?.regions ?? {};
    for (const region of Object.keys(regions)) {
      const entries = regions[region];
      if (!Array.isArray(entries)) continue;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].instanceId === instanceId) {
          return { region, index: i, entry: entries[i] };
        }
      }
    }
    return null;
  }

  /**
   * Snapshot of every entry with its current position. Used by
   * EditorAPI.list() and Playwright introspection.
   */
  listEntries() {
    const out = [];
    const regions = this._doc?.regions ?? {};
    for (const region of Object.keys(regions)) {
      const entries = regions[region];
      if (!Array.isArray(entries)) continue;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        out.push({
          instanceId: e.instanceId,
          widgetId: e.widgetId,
          region,
          index: i,
          config: e.config ?? {},
        });
      }
    }
    return out;
  }

  // ---- events ----

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
        // eslint-disable-next-line no-console
        console.error('[editor-controller] listener threw', err);
      }
    }
  }

  // ---- helpers ----

  _regionSpec(regionName) {
    const regions = this._template?.regions;
    if (!Array.isArray(regions)) return null;
    return regions.find((r) => r.name === regionName) ?? null;
  }

  /**
   * Look up the config JSON schema for a widgetId, if the registry has one.
   * Returns null when the registry doesn't know the widget or carries no
   * schema for it.
   */
  getSchema(widgetId) {
    const reg = this._registry;
    if (!reg || typeof reg.get !== 'function') return null;
    try {
      const entry = reg.get(widgetId);
      return entry?.schema ?? null;
    } catch {
      return null;
    }
  }

  _isWidgetKnown(widgetId) {
    const reg = this._registry;
    if (!reg) return false;
    try {
      if (typeof reg.has === 'function') return reg.has(widgetId);
      if (typeof reg.get === 'function') return reg.get(widgetId) != null;
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Would removing this instance leave a `required` region empty?
   */
  _wouldEmptyRequired(region, instanceId) {
    const spec = this._regionSpec(region);
    if (!spec || spec.required !== true) return false;
    const entries = this._doc?.regions?.[region] ?? [];
    const remaining = entries.filter((e) => e && e.instanceId !== instanceId);
    return remaining.length === 0;
  }

  // ---- primitives ----

  /**
   * Insert a new widget entry into (region, index).
   *
   * @param {object} args
   * @param {object} args.entry — { widgetId, instanceId, config }
   * @param {string} args.region
   * @param {number} [args.index] — defaults to "append" (end of region)
   */
  applyAdd({ entry, region, index }) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: 'invalid-entry' };
    }
    if (!entry.widgetId || !entry.instanceId) {
      return { ok: false, reason: 'invalid-entry' };
    }
    if (!this._isWidgetKnown(entry.widgetId)) {
      return { ok: false, reason: 'unknown-widget' };
    }
    const spec = this._regionSpec(region);
    if (!spec) return { ok: false, reason: 'region-invalid' };
    if (this.findInstance(entry.instanceId)) {
      return { ok: false, reason: 'duplicate-instance-id' };
    }

    const next = structuredClone(this._doc);
    if (!next.regions || typeof next.regions !== 'object') next.regions = {};
    if (!Array.isArray(next.regions[region])) next.regions[region] = [];

    const len = next.regions[region].length;
    const resolvedIndex =
      typeof index === 'number' ? index : len;
    if (resolvedIndex < 0 || resolvedIndex > len) {
      return { ok: false, reason: 'index-invalid' };
    }

    const max =
      typeof spec.maxWidgets === 'number' && spec.maxWidgets >= 0
        ? spec.maxWidgets
        : null;
    if (max !== null && len + 1 > max) {
      return { ok: false, reason: 'max-widgets' };
    }

    next.regions[region].splice(resolvedIndex, 0, structuredClone(entry));

    this._doc = next;
    this._emit('statechange', { doc: this._doc });
    return {
      ok: true,
      nextDoc: next,
      action: 'add',
      widgetId: entry.widgetId,
      instanceId: entry.instanceId,
      to: { region, index: resolvedIndex },
    };
  }

  /**
   * Move an existing instance to (region, index). Idempotent no-op if the
   * resolved target is the instance's current position.
   */
  applyMove({ instanceId, region, index }) {
    const found = this.findInstance(instanceId);
    if (!found) return { ok: false, reason: 'instance-not-found' };

    const spec = this._regionSpec(region);
    if (!spec) return { ok: false, reason: 'region-invalid' };

    const next = structuredClone(this._doc);
    if (!next.regions || typeof next.regions !== 'object') next.regions = {};
    if (!Array.isArray(next.regions[region])) next.regions[region] = [];
    if (!Array.isArray(next.regions[found.region])) {
      next.regions[found.region] = [];
    }

    // Remove from current position first; this matters for same-region moves
    // where the target index can refer to the slot after removal.
    const [picked] = next.regions[found.region].splice(found.index, 1);
    if (!picked) return { ok: false, reason: 'source-gone' };

    const targetLen = next.regions[region].length; // length after removal
    let resolvedIndex =
      typeof index === 'number' ? index : targetLen;
    // When moving within the same region and the caller passed the pre-removal
    // index AFTER the source, the removal has already shifted it down by 1.
    // Callers that compute "insert at slot K of the current layout" expect
    // that shift to be handled here. But when the caller gave a post-removal
    // index (typical for a DnD target or programmatic list), no adjustment
    // is needed. We adopt the post-removal convention: index is interpreted
    // against the array after the source was removed.
    if (resolvedIndex < 0 || resolvedIndex > targetLen) {
      // Restore before returning so the doc is unchanged on failure.
      next.regions[found.region].splice(found.index, 0, picked);
      return { ok: false, reason: 'index-invalid' };
    }

    // maxWidgets: cross-region moves add 1 to target; same-region keeps count.
    const max =
      typeof spec.maxWidgets === 'number' && spec.maxWidgets >= 0
        ? spec.maxWidgets
        : null;
    if (max !== null && found.region !== region && targetLen + 1 > max) {
      next.regions[found.region].splice(found.index, 0, picked);
      return { ok: false, reason: 'max-widgets' };
    }

    // Required-region guard: would emptying the source violate INV-TEMPLATE-05?
    if (found.region !== region) {
      const srcSpec = this._regionSpec(found.region);
      if (srcSpec?.required === true && next.regions[found.region].length === 0) {
        next.regions[found.region].splice(found.index, 0, picked);
        return { ok: false, reason: 'required-region-empty' };
      }
    }

    // No-op detection: target position equals source position.
    if (found.region === region && resolvedIndex === found.index) {
      next.regions[found.region].splice(found.index, 0, picked);
      return {
        ok: true,
        nextDoc: next,
        action: 'move',
        noop: true,
        widgetId: picked.widgetId,
        instanceId,
        from: { region: found.region, index: found.index },
        to: { region, index: resolvedIndex },
      };
    }

    next.regions[region].splice(resolvedIndex, 0, picked);

    this._doc = next;
    this._emit('statechange', { doc: this._doc });
    return {
      ok: true,
      nextDoc: next,
      action: 'move',
      noop: false,
      widgetId: picked.widgetId,
      instanceId,
      from: { region: found.region, index: found.index },
      to: { region, index: resolvedIndex },
    };
  }

  /**
   * Replace (not merge) the config of an existing instance.
   */
  applyUpdate({ instanceId, config }) {
    const found = this.findInstance(instanceId);
    if (!found) return { ok: false, reason: 'instance-not-found' };

    const next = structuredClone(this._doc);
    const entry = next.regions[found.region][found.index];
    entry.config = structuredClone(config ?? {});

    this._doc = next;
    this._emit('statechange', { doc: this._doc });
    return {
      ok: true,
      nextDoc: next,
      action: 'update',
      widgetId: entry.widgetId,
      instanceId,
      at: { region: found.region, index: found.index },
    };
  }

  /**
   * Remove an instance. Refuses if removal would leave a required region empty.
   */
  applyRemove({ instanceId }) {
    const found = this.findInstance(instanceId);
    if (!found) return { ok: false, reason: 'instance-not-found' };

    if (this._wouldEmptyRequired(found.region, instanceId)) {
      return { ok: false, reason: 'required-region-empty' };
    }

    const next = structuredClone(this._doc);
    const [removed] = next.regions[found.region].splice(found.index, 1);

    this._doc = next;
    this._emit('statechange', { doc: this._doc });
    return {
      ok: true,
      nextDoc: next,
      action: 'remove',
      widgetId: removed?.widgetId,
      instanceId,
      from: { region: found.region, index: found.index },
    };
  }

  /**
   * Dry-run: compute valid drop targets for a widgetId. Thin re-export of
   * computeValidTargets, kept here so UI code has one import surface.
   */
  validTargetsFor(widgetId, sourcePosition = null) {
    return computeValidTargets(
      widgetId,
      this._doc,
      this._template,
      this._registry,
      sourcePosition,
    );
  }
}
