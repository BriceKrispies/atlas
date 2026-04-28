import { describe } from 'vitest';
import type { SearchEngine } from '@atlas/ports';

export function searchEngineContract(_makeEngine: () => Promise<SearchEngine>): void {
  describe.skip('SearchEngine contract (skeleton — bodies arrive in Chunk 2)', () => {
    // index then search returns the document
    // tenant isolation: cross-tenant query returns nothing
    // deleteByDocument removes from search results
    // permissionAttributes filter excludes disallowed principals
    // ranking is descending by score
  });
}
