/**
 * layout-store.ts — persistence port for layout documents.
 *
 * Mirrors the existing `PageStore` surface (get / save / list / delete)
 * so apps can plug in an in-memory implementation, a validating
 * decorator, or a backend-backed store without changing the consumer.
 *
 * Phase 1 ships the two non-backend variants; a fetch-backed store lives
 * with the future backend persistence work.
 */

import {
  validateLayoutDocument,
  cloneLayoutDocument,
  type LayoutDocument,
} from './layout-document.ts';

export interface LayoutStore {
  get(layoutId: string): Promise<LayoutDocument | null>;
  save(layoutId: string, doc: LayoutDocument): Promise<void>;
  list(): Promise<LayoutDocument[]>;
  delete(layoutId: string): Promise<void>;
}

export class InMemoryLayoutStore implements LayoutStore {
  private _map: Map<string, LayoutDocument> = new Map();

  constructor(seed?: Record<string, LayoutDocument> | null) {
    if (seed && typeof seed === 'object') {
      for (const [id, doc] of Object.entries(seed)) {
        this._map.set(id, cloneLayoutDocument(doc));
      }
    }
  }

  async get(layoutId: string): Promise<LayoutDocument | null> {
    const doc = this._map.get(layoutId);
    return doc ? cloneLayoutDocument(doc) : null;
  }

  async save(layoutId: string, doc: LayoutDocument): Promise<void> {
    if (typeof layoutId !== 'string' || layoutId.length === 0) {
      throw new Error('save: layoutId must be a non-empty string');
    }
    if (!doc || typeof doc !== 'object') {
      throw new Error('save: doc must be an object');
    }
    this._map.set(layoutId, cloneLayoutDocument(doc));
  }

  async list(): Promise<LayoutDocument[]> {
    return [...this._map.values()].map((d) => cloneLayoutDocument(d));
  }

  async delete(layoutId: string): Promise<void> {
    this._map.delete(layoutId);
  }
}

/**
 * Decorator that validates every document against the layout schema on
 * the save path. Reads pass through untouched; consumers that want to
 * guard against corrupted storage can validate on read themselves.
 */
export class ValidatingLayoutStore implements LayoutStore {
  private _inner: LayoutStore;

  constructor(inner: LayoutStore) {
    this._inner = inner;
  }

  async get(layoutId: string): Promise<LayoutDocument | null> {
    return this._inner.get(layoutId);
  }

  async save(layoutId: string, doc: LayoutDocument): Promise<void> {
    const result = validateLayoutDocument(doc);
    if (!result.ok) {
      const summary = result.errors
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

  async list(): Promise<LayoutDocument[]> {
    return this._inner.list();
  }

  async delete(layoutId: string): Promise<void> {
    return this._inner.delete(layoutId);
  }
}
