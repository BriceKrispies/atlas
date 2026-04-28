import type { SearchDocument } from '@atlas/platform-core';
import type { SearchEngine } from '@atlas/ports';
import type { IdbDb } from './db.ts';

const FIELD_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['title', 1.0],
  ['summary', 0.5],
  ['body_text', 0.25],
  ['taxonomy_path', 0.1],
];

function termHit(haystack: string | null, term: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(term);
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  return null;
}

function rowKey(tenantId: string, documentType: string, documentId: string): string {
  return `${tenantId}::${documentType}::${documentId}`;
}

export class IdbSearchEngine implements SearchEngine {
  constructor(private readonly db: IdbDb) {}

  async index(doc: SearchDocument): Promise<void> {
    const id = rowKey(doc.tenantId, doc.documentType, doc.documentId);
    await this.db.put('search_documents', {
      searchDocumentId: id,
      tenantId: doc.tenantId,
      documentType: doc.documentType,
      documentId: doc.documentId,
      doc,
    });
  }

  async deleteByDocument(
    tenantId: string,
    documentType: string,
    documentId: string,
  ): Promise<void> {
    const id = rowKey(tenantId, documentType, documentId);
    await this.db.delete('search_documents', id);
  }

  async search(
    query: string,
    tenantId: string,
    principalId: string,
  ): Promise<SearchDocument[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const terms = trimmed
      .toLowerCase()
      .split(/\s+/u)
      .filter((t): t is string => t.length > 0);
    if (terms.length === 0) return [];

    const rows = await this.db.getAllFromIndex(
      'search_documents',
      'by_tenant_type',
      IDBKeyRange.bound([tenantId, ''], [tenantId, '￿']),
    );

    const scored: Array<{ doc: SearchDocument; score: number }> = [];
    for (const row of rows) {
      const d = row.doc;
      if (d.permissionAttributes != null) {
        if (!d.permissionAttributes.allowedPrincipals.includes(principalId)) {
          continue;
        }
      }

      let score = 0;
      let anyHit = false;
      for (const term of terms) {
        for (const [field, weight] of FIELD_WEIGHTS) {
          const v = asString(d.fields[field]);
          if (termHit(v, term)) {
            score += weight;
            anyHit = true;
          }
        }
      }
      if (!anyHit) continue;

      const cloned: SearchDocument = {
        ...d,
        fields: { ...d.fields, _score: score },
      };
      scored.push({ doc: cloned, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.doc);
  }
}
