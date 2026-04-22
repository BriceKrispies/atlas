/**
 * layout-store.js — persistence port for layout documents.
 *
 * Mirrors the existing `PageStore` surface (get / save / list / delete)
 * so apps can plug in an in-memory implementation, a validating
 * decorator, or a backend-backed store without changing the consumer.
 *
 * Phase 1 ships the two non-backend variants; a fetch-backed store lives
 * with the future backend persistence work.
 */

import { validateLayoutDocument, cloneLayoutDocument } from './layout-document.js';

/**
 * @typedef {import('./layout-document.js').LayoutDocument} LayoutDocument
 *
 * @typedef {{
 *   get(layoutId: string): Promise<LayoutDocument | null>,
 *   save(layoutId: string, doc: LayoutDocument): Promise<void>,
 *   list(): Promise<LayoutDocument[]>,
 *   delete(layoutId: string): Promise<void>,
 * }} LayoutStore
 */

export class InMemoryLayoutStore {
  constructor(seed) {
    /** @type {Map<string, LayoutDocument>} */
    this._map = new Map();
    if (seed && typeof seed === 'object') {
      for (const [id, doc] of Object.entries(seed)) {
        this._map.set(id, cloneLayoutDocument(doc));
      }
    }
  }

  async get(layoutId) {
    const doc = this._map.get(layoutId);
    return doc ? cloneLayoutDocument(doc) : null;
  }

  async save(layoutId, doc) {
    if (typeof layoutId !== 'string' || layoutId.length === 0) {
      throw new Error('save: layoutId must be a non-empty string');
    }
    if (!doc || typeof doc !== 'object') {
      throw new Error('save: doc must be an object');
    }
    this._map.set(layoutId, cloneLayoutDocument(doc));
  }

  async list() {
    return [...this._map.values()].map((d) => cloneLayoutDocument(d));
  }

  async delete(layoutId) {
    this._map.delete(layoutId);
  }
}

/**
 * Decorator that validates every document against the layout schema on
 * the save path. Reads pass through untouched; consumers that want to
 * guard against corrupted storage can validate on read themselves.
 */
export class ValidatingLayoutStore {
  /** @param {LayoutStore} inner */
  constructor(inner) {
    this._inner = inner;
  }

  async get(layoutId) {
    return this._inner.get(layoutId);
  }

  async save(layoutId, doc) {
    const { ok, errors } = validateLayoutDocument(doc);
    if (!ok) {
      const summary = errors
        .map((e) => `${e.path || '(root)'} ${e.message}`)
        .join('; ');
      throw new Error(`schema violation: ${summary}`);
    }
    if (doc.layoutId !== layoutId) {
      throw new Error(
        `layoutId mismatch: argument "${layoutId}" vs doc.layoutId "${doc.layoutId}"`,
      );
    }
    return this._inner.save(layoutId, doc);
  }

  async list() {
    return this._inner.list();
  }

  async delete(layoutId) {
    return this._inner.delete(layoutId);
  }
}
