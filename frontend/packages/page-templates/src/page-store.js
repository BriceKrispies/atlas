/**
 * PageStore port + in-memory adapter + validating decorator.
 *
 * The page-document shape is frozen at v1 (see specs/crosscut/page-templates.md);
 * the ValidatingPageStore decorator is the sole enforcement point for that
 * frozen shape at read and write time (INV-TEMPLATE-06). InMemoryPageStore
 * structuredClones on both save and get so callers cannot mutate internal
 * state — this doubles as a round-trip byte-equivalence proof for the
 * backend contract.
 */

import { validatePageDocument } from './document.js';
import { PageDocumentError, PageStoreError } from './errors.js';

/**
 * PageStore interface.
 *
 * @typedef {object} PageDocument
 * @typedef {object} PageStore
 * @property {(pageId: string) => Promise<PageDocument | null>} get
 * @property {(pageId: string, doc: PageDocument) => Promise<void>} save
 * @property {() => Promise<PageDocument[]>} list
 * @property {(pageId: string) => Promise<void>} delete
 */

/**
 * In-memory PageStore. Backed by a Map. Clones in and out so stored
 * documents are immune to caller mutation.
 */
export class InMemoryPageStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._docs = new Map();
  }

  async get(pageId) {
    const doc = this._docs.get(pageId);
    if (!doc) return null;
    return structuredClone(doc);
  }

  async save(pageId, doc) {
    if (typeof pageId !== 'string' || pageId.length === 0) {
      throw new PageStoreError('pageId must be a non-empty string');
    }
    if (!doc || typeof doc !== 'object') {
      throw new PageStoreError('doc must be an object');
    }
    this._docs.set(pageId, structuredClone(doc));
  }

  async list() {
    return [...this._docs.values()].map((d) => structuredClone(d));
  }

  async delete(pageId) {
    this._docs.delete(pageId);
  }
}

/**
 * ValidatingPageStore — decorator that validates every document against
 * page_document.schema.json on write, and re-validates on read. Any
 * adapter (in-memory, HTTP) can be wrapped; the decorator is the frozen-
 * v1 enforcement point.
 */
export class ValidatingPageStore {
  /** @param {PageStore} inner */
  constructor(inner) {
    if (!inner || typeof inner !== 'object') {
      throw new PageStoreError('ValidatingPageStore requires an inner store');
    }
    this._inner = inner;
  }

  async get(pageId) {
    const doc = await this._inner.get(pageId);
    if (doc == null) return null;
    const { ok, errors } = validatePageDocument(doc);
    if (!ok) {
      throw new PageDocumentError(
        `page document returned by store for pageId=${pageId} is invalid`,
        { errors },
      );
    }
    return doc;
  }

  async save(pageId, doc) {
    const { ok, errors } = validatePageDocument(doc);
    if (!ok) {
      throw new PageDocumentError(
        `page document for pageId=${pageId} is invalid`,
        { errors },
      );
    }
    await this._inner.save(pageId, doc);
  }

  async list() {
    const docs = await this._inner.list();
    for (const doc of docs) {
      const { ok, errors } = validatePageDocument(doc);
      if (!ok) {
        throw new PageDocumentError(
          `page document returned by store (pageId=${doc?.pageId ?? '<unknown>'}) is invalid`,
          { errors },
        );
      }
    }
    return docs;
  }

  async delete(pageId) {
    await this._inner.delete(pageId);
  }
}
