/**
 * EditorAPI — the public, imperative surface for mutating a page.
 *
 * Exposed as `contentPageEl.editor` whenever the element is in edit mode
 * (or whenever `canEdit=true`, even in view mode — agents shouldn't need
 * to flip the UI on to make changes).
 *
 * Design goals:
 *   - Agent-first. Every mutation takes stable identifiers (instanceId,
 *     region name, widgetId). Agents never need to know indices.
 *   - Test-first. Every method is plain async, returns a plain {ok,...}
 *     result object, and never depends on pointer or keyboard events.
 *     Playwright can call `await page.evaluate(el => el.editor.move(...))`
 *     and get the same result the UI does.
 *   - Isolated. A call mutates ONLY the target widget's entry. Siblings
 *     are untouched unless index shifts force renumbering (which is an
 *     array-splice side effect, not a value change).
 *
 * Every call:
 *   1. Validates via EditorController's pure primitives.
 *   2. If ok, persists via `onCommit(nextDoc, info)` (typically
 *      pageStore.save → reload → remount).
 *   3. Emits telemetry + a11y announcement.
 *   4. Returns the result object.
 *
 * Return shape:
 *   { ok: true, action, instanceId, widgetId, from?, to? }
 *   { ok: false, reason: '<code>', message? }
 *
 * Reason codes (stable, safe to assert in tests):
 *   region-invalid, index-invalid, max-widgets, unknown-widget,
 *   required-region-empty, duplicate-instance-id, instance-not-found,
 *   invalid-entry, source-gone, persist-failed, not-editable.
 */

/**
 * @typedef {object} AddArgs
 * @property {string} widgetId
 * @property {string} region
 * @property {number} [index]         — defaults to append
 * @property {string} [instanceId]    — auto-generated if omitted
 * @property {object} [config]        — defaults to {}
 */

/**
 * @typedef {object} MoveArgs
 * @property {string} instanceId
 * @property {string} region          — target region
 * @property {number} [index]         — defaults to append
 */

/**
 * @typedef {object} UpdateArgs
 * @property {string} instanceId
 * @property {object} config          — replaces the existing config
 */

/**
 * @typedef {object} RemoveArgs
 * @property {string} instanceId
 */

/**
 * Build a fresh instanceId for a widget. Not cryptographically unique — just
 * uncollidable in practice and readable in the DOM / telemetry.
 */
export function freshInstanceId(widgetId) {
  const prefix = String(widgetId ?? 'w').split('.').pop() || 'w';
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36);
  return `w-${prefix}-${stamp}-${rand}`;
}

/**
 * Extract top-level property defaults from a JSON Schema (draft-07) object.
 * Only reads `properties[key].default` — nested defaults and `$ref`s are
 * out of scope; widget schemas in this repo are flat.
 * @param {object | null | undefined} schema
 * @returns {object}
 */
function schemaDefaults(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const props = schema.properties;
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop && typeof prop === 'object' && 'default' in prop) {
      out[key] = prop.default;
    }
  }
  return out;
}

export class EditorAPI {
  /**
   * @param {object} options
   * @param {import('./editor-controller.js').EditorController} options.controller
   * @param {(nextDoc: object, info: object) => Promise<void>} options.onCommit
   * @param {(event: string, payload: object) => void} [options.onTelemetry]
   * @param {(msg: string) => void} [options.announce]
   * @param {() => boolean} [options.isEditable] — gate; returns false to
   *   reject every mutation with reason 'not-editable'. Defaults to always
   *   true.
   * @param {string} [options.surfaceId] — surface id for commit envelopes.
   */
  constructor({ controller, onCommit, onTelemetry, announce, isEditable, surfaceId }) {
    this._controller = controller;
    this._commit = typeof onCommit === 'function' ? onCommit : async () => {};
    this._telemetry = typeof onTelemetry === 'function' ? onTelemetry : () => {};
    this._announce = typeof announce === 'function' ? announce : () => {};
    this._isEditable = typeof isEditable === 'function' ? isEditable : () => true;
    this._surfaceId = surfaceId ?? 'editor';
    /** @type {null | { surfaceId: string, intent: string, patch: object, at: number }} */
    this._lastCommit = null;
    this._dirty = false;
  }

  /**
   * Snapshot of the editor's externally-observable state. Used by the
   * `@atlas/test-state` registry (see interaction-contracts.md).
   */
  getSnapshot() {
    return {
      surfaceId: this._surfaceId,
      document: this._controller.doc,
      entries: this._controller.listEntries(),
      dirty: this._dirty,
      lastCommit: this._lastCommit,
    };
  }

  get lastCommit() { return this._lastCommit; }

  // ---- introspection (synchronous) ----

  /**
   * Snapshot of every widget entry on the page, as positional records.
   * Stable across calls (always reflects the latest committed doc).
   */
  list() {
    return this._controller.listEntries();
  }

  /**
   * Fetch a single entry by instanceId. Returns null if the instance is
   * unknown.
   */
  get(instanceId) {
    const found = this._controller.findInstance(instanceId);
    if (!found) return null;
    return {
      instanceId,
      widgetId: found.entry.widgetId,
      region: found.region,
      index: found.index,
      config: found.entry.config ?? {},
    };
  }

  /**
   * Pure validation — would this call succeed right now? Handy for
   * highlighting drop zones without performing the mutation.
   */
  can(op, args) {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    switch (op) {
      case 'add': {
        const entry = {
          widgetId: args.widgetId,
          instanceId: args.instanceId ?? freshInstanceId(args.widgetId),
          config: args.config ?? {},
        };
        // Dry-run: ask the controller without committing. We clone the
        // doc ourselves so we don't accidentally mutate the live one via
        // a bug.
        const preDoc = this._controller.doc;
        const result = this._controller.applyAdd({
          entry,
          region: args.region,
          index: args.index,
        });
        if (result.ok) this._controller.setDoc(preDoc); // roll back
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      case 'move': {
        const preDoc = this._controller.doc;
        const result = this._controller.applyMove(args);
        if (result.ok) this._controller.setDoc(preDoc);
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      case 'update': {
        const preDoc = this._controller.doc;
        const result = this._controller.applyUpdate(args);
        if (result.ok) this._controller.setDoc(preDoc);
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      case 'remove': {
        const preDoc = this._controller.doc;
        const result = this._controller.applyRemove(args);
        if (result.ok) this._controller.setDoc(preDoc);
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      default:
        return { ok: false, reason: 'invalid-entry' };
    }
  }

  // ---- mutations (async) ----

  /**
   * Add a new widget.
   * @param {AddArgs} args
   */
  async add(args) {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.widgetId || !args.region) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const schema = this._controller.getSchema?.(args.widgetId) ?? null;
    const defaults = schemaDefaults(schema);
    const entry = {
      widgetId: args.widgetId,
      instanceId: args.instanceId ?? freshInstanceId(args.widgetId),
      config: { ...defaults, ...(args.config ?? {}) },
    };
    const result = this._controller.applyAdd({
      entry,
      region: args.region,
      index: args.index,
    });
    return this._finalize(result);
  }

  /**
   * Move a widget to a new position. Idempotent no-op when target matches
   * current position.
   * @param {MoveArgs} args
   */
  async move(args) {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId || !args.region) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyMove(args);
    return this._finalize(result);
  }

  /**
   * Replace the config of a widget.
   * @param {UpdateArgs} args
   */
  async update(args) {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyUpdate(args);
    return this._finalize(result);
  }

  /**
   * Remove a widget.
   * @param {RemoveArgs} args
   */
  async remove(args) {
    if (!this._isEditable()) return { ok: false, reason: 'not-editable' };
    if (!args || !args.instanceId) {
      return { ok: false, reason: 'invalid-entry' };
    }
    const result = this._controller.applyRemove(args);
    return this._finalize(result);
  }

  // ---- internal ----

  async _finalize(result) {
    if (!result.ok) {
      this._announce(`${result.reason.replace(/-/g, ' ')}.`);
      this._telemetry('atlas.content-page.edit.rejected', {
        reason: result.reason,
        action: result.action,
      });
      return { ok: false, reason: result.reason };
    }
    if (result.noop) {
      // Valid but nothing changed — skip persistence.
      this._telemetry('atlas.content-page.edit.noop', {
        action: result.action,
        instanceId: result.instanceId,
      });
      return {
        ok: true,
        noop: true,
        action: result.action,
        instanceId: result.instanceId,
        widgetId: result.widgetId,
        from: result.from,
        to: result.to,
      };
    }
    try {
      await this._commit(result.nextDoc, {
        action: result.action,
        instanceId: result.instanceId,
        widgetId: result.widgetId,
        from: result.from,
        to: result.to,
      });
    } catch (err) {
      const message = err?.message ?? String(err);
      this._announce(`Save failed: ${message}`);
      this._telemetry('atlas.content-page.save.error', { message });
      return { ok: false, reason: 'persist-failed', message };
    }
    this._telemetry('atlas.content-page.edit', {
      action: result.action,
      instanceId: result.instanceId,
      widgetId: result.widgetId,
      fromRegion: result.from?.region,
      fromIndex: result.from?.index,
      toRegion: result.to?.region,
      toIndex: result.to?.index,
    });
    this._recordCommit(result);
    // Announcements are keyed off action; the edit-mount a11y wrapper
    // handles friendlier phrasing where possible.
    return {
      ok: true,
      action: result.action,
      instanceId: result.instanceId,
      widgetId: result.widgetId,
      from: result.from,
      to: result.to,
    };
  }

  _recordCommit(result) {
    this._lastCommit = {
      surfaceId: this._surfaceId,
      intent: result.action,
      patch: {
        instanceId: result.instanceId,
        widgetId: result.widgetId,
        from: result.from ?? null,
        to: result.to ?? null,
      },
      at: Date.now(),
    };
    this._dirty = true;
  }

  /**
   * Reset the dirty flag (e.g. after an external save). Does not affect
   * `lastCommit` — tests can still inspect the most recent intent.
   */
  markClean() {
    this._dirty = false;
  }

  /**
   * Record a commit for an intent that didn't flow through the apply*
   * primitives (e.g. DnD drops that wrap a move, resize gestures).
   * Callers are responsible for ensuring the underlying state change
   * actually happened (typically via the other commit methods).
   */
  recordExternalCommit(intent, patch) {
    this._lastCommit = {
      surfaceId: this._surfaceId,
      intent,
      patch: patch ?? {},
      at: Date.now(),
    };
  }
}
