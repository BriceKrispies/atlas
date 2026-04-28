import type { SearchDocument } from '@atlas/platform-core';

export interface SearchEngine {
  index(doc: SearchDocument): Promise<void>;
  deleteByDocument(
    tenantId: string,
    documentType: string,
    documentId: string,
  ): Promise<void>;
  search(
    query: string,
    tenantId: string,
    principalId: string,
  ): Promise<SearchDocument[]>;
}
