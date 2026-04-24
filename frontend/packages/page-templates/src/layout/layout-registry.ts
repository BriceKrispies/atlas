/**
 * layout-registry.ts — in-process lookup for preset layout documents.
 *
 * Preset layouts ship as JSON inside @atlas/page-templates (and will be
 * re-exported by bundle packages). The registry lets apps wire a set of
 * presets in at boot and resolve them by `layoutId` — same pattern as
 * `TemplateRegistry` for the legacy template classes.
 *
 * The registry is read-only from the app's perspective; the editor
 * writes new / modified layouts through a `LayoutStore`, not here.
 */

import {
  validateLayoutDocument,
  cloneLayoutDocument,
  type LayoutDocument,
} from './layout-document.ts';

export class LayoutRegistry {
  private _map: Map<string, LayoutDocument> = new Map();

  register(doc: LayoutDocument): this {
    const result = validateLayoutDocument(doc);
    if (!result.ok) {
      const summary = result.errors
        .map((e) => `${e.path || '(root)'} ${e.message}`)
        .join('; ');
      throw new Error(`invalid layout: ${summary}`);
    }
    this._map.set(doc.layoutId, cloneLayoutDocument(doc));
    return this;
  }

  has(layoutId: string): boolean {
    return this._map.has(layoutId);
  }

  get(layoutId: string): LayoutDocument | null {
    const doc = this._map.get(layoutId);
    return doc ? cloneLayoutDocument(doc) : null;
  }

  list(): LayoutDocument[] {
    return [...this._map.values()].map((d) => cloneLayoutDocument(d));
  }
}

/** Module-default registry. Bundle packages register presets into this. */
export const moduleDefaultLayoutRegistry = new LayoutRegistry();
