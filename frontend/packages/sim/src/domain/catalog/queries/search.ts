import type { SearchEnginePort } from '../../../ports/search-engine.ts';
import type { SearchParams, SearchResponse, SearchResult, SearchDocument } from '../../../types.ts';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

function formatResult(d: SearchDocument): SearchResult {
  const title = typeof d.fields['title'] === 'string' ? (d.fields['title']) : '';
  const summaryRaw = d.fields['summary'];
  const summary = typeof summaryRaw === 'string' ? summaryRaw : null;
  const taxonomyRaw = d.fields['taxonomy_path'];
  const taxonomyPath = typeof taxonomyRaw === 'string' ? taxonomyRaw : null;
  const scoreRaw = d.fields['_score'];
  const score = typeof scoreRaw === 'number' ? scoreRaw : 0;
  return {
    documentType: d.documentType,
    documentId: d.documentId,
    title,
    summary,
    taxonomyPath,
    score,
  };
}

export async function handleSearch(
  tenantId: string,
  principalId: string,
  params: SearchParams,
  search: SearchEnginePort,
): Promise<SearchResponse> {
  const trimmed = params.q.trim();
  if (!trimmed) {
    throw Object.assign(new Error('search query parameter `q` is required'), {
      code: 'BAD_REQUEST',
    });
  }
  let docs = await search.search(trimmed, tenantId, principalId);
  if (params.type && params.type.length > 0) {
    docs = docs.filter((d) => d.documentType === params.type);
  }

  let pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  if (pageSize <= 0) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  const offset = params.cursor ? Math.max(0, parseInt(params.cursor, 10) || 0) : 0;

  const total = docs.length;
  const start = Math.min(offset, total);
  const end = Math.min(start + pageSize, total);
  const page = docs.slice(start, end);
  const hasMore = end < total;

  return {
    query: trimmed,
    results: page.map(formatResult),
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? String(end) : null,
    },
  };
}
