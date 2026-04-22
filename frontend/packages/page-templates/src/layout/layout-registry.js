/**
 * layout-registry.js — in-process lookup for preset layout documents.
 *
 * Preset layouts ship as JSON inside @atlas/page-templates (and will be
 * re-exported by bundle packages). The registry lets apps wire a set of
 * presets in at boot and resolve them by `layoutId` — same pattern as
 * `TemplateRegistry` for the legacy template classes.
 *
 * The registry is read-only from the app's perspective; the editor
 * writes new / modified layouts through a `LayoutStore`, not here.
 */

import { validateLayoutDocument, cloneLayoutDocument } from './layout-document.js';

/**
 * @typedef {import('./layout-document.js').LayoutDocument} LayoutDocument
 */

export class LayoutRegistry {
  constructor() {
    /** @type {Map<string, LayoutDocument>} */
    this._map = new Map();
  }

  /** @param {LayoutDocument} doc */
  register(doc) {
    const { ok, errors } = validateLayoutDocument(doc);
    if (!ok) {
      const summary = errors
        .map((e) => `${e.path || '(root)'} ${e.message}`)
        .join('; ');
      throw new Error(`invalid layout: ${summary}`);
    }
    this._map.set(doc.layoutId, cloneLayoutDocument(doc));
    return this;
  }

  has(layoutId) {
    return this._map.has(layoutId);
  }

  /** @returns {LayoutDocument | null} */
  get(layoutId) {
    const doc = this._map.get(layoutId);
    return doc ? cloneLayoutDocument(doc) : null;
  }

  /** @returns {LayoutDocument[]} */
  list() {
    return [...this._map.values()].map((d) => cloneLayoutDocument(d));
  }
}

/** Module-default registry. Bundle packages register presets into this. */
export const moduleDefaultLayoutRegistry = new LayoutRegistry();
