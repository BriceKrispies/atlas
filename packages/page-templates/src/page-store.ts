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

import { validatePageDocument } from './document.ts';
import { PageDocumentError, PageStoreError } from './errors.ts';

export interface WidgetInstance {
  widgetId: string;
  instanceId: string;
  config?: Record<string, unknown>;
}

export interface PageDocument {
  pageId: string;
  tenantId?: string;
  templateId?: string;
  templateVersion?: string;
  layoutId?: string;
  layoutVersion?: string;
  regions?: Record<string, WidgetInstance[]>;
  [k: string]: unknown;
}

export interface PageStore {
  get(pageId: string): Promise<PageDocument | null>;
  save(pageId: string, doc: PageDocument): Promise<void>;
  list(): Promise<PageDocument[]>;
  delete(pageId: string): Promise<void>;
}

/**
 * In-memory PageStore. Backed by a Map. Clones in and out so stored
 * documents are immune to caller mutation.
 */
export class InMemoryPageStore implements PageStore {
  _docs: Map<string, PageDocument> = new Map();

  async get(pageId: string): Promise<PageDocument | null> {
    const doc = this._docs.get(pageId);
    if (!doc) return null;
    return structuredClone(doc);
  }

  async save(pageId: string, doc: PageDocument): Promise<void> {
    if (typeof pageId !== 'string' || pageId.length === 0) {
      throw new PageStoreError('pageId must be a non-empty string');
    }
    if (!doc || typeof doc !== 'object') {
      throw new PageStoreError('doc must be an object');
    }
    this._docs.set(pageId, structuredClone(doc));
  }

  async list(): Promise<PageDocument[]> {
    return [...this._docs.values()].map((d) => structuredClone(d));
  }

  async delete(pageId: string): Promise<void> {
    this._docs.delete(pageId);
  }
}

/**
 * ValidatingPageStore — decorator that validates every document against
 * page_document.schema.json on write, and re-validates on read. Any
 * adapter (in-memory, HTTP) can be wrapped; the decorator is the frozen-
 * v1 enforcement point.
 */
export class ValidatingPageStore implements PageStore {
  private _inner: PageStore;

  constructor(inner: PageStore) {
    if (!inner || typeof inner !== 'object') {
      throw new PageStoreError('ValidatingPageStore requires an inner store');
    }
    this._inner = inner;
  }

  async get(pageId: string): Promise<PageDocument | null> {
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

  async save(pageId: string, doc: PageDocument): Promise<void> {
    const { ok, errors } = validatePageDocument(doc);
    if (!ok) {
      throw new PageDocumentError(
        `page document for pageId=${pageId} is invalid`,
        { errors },
      );
    }
    await this._inner.save(pageId, doc);
  }

  async list(): Promise<PageDocument[]> {
    const docs = await this._inner.list();
    for (const doc of docs) {
      const { ok, errors } = validatePageDocument(doc);
      if (!ok) {
        throw new PageDocumentError(
          `page document returned by store (pageId=${(doc as { pageId?: string })?.pageId ?? '<unknown>'}) is invalid`,
          { errors },
        );
      }
    }
    return docs;
  }

  async delete(pageId: string): Promise<void> {
    await this._inner.delete(pageId);
  }
}
