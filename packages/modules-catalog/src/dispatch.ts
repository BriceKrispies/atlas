import type { EventEnvelope } from '@atlas/platform-core';
import type {
  CatalogStateStore,
  ProjectionStore,
  SearchEngine,
  Cache,
} from '@atlas/ports';
import { rebuildTaxonomyNavigation } from './projections/taxonomy-navigation.ts';
import { rebuildFamilyDetail } from './projections/family-detail.ts';
import { rebuildVariantMatrix } from './projections/variant-matrix.ts';
import { rebuildSearchDocuments } from './projections/search-documents.ts';

const CATALOG_EVENT_TYPES = new Set([
  'StructuredCatalog.SeedPackageApplied',
  'StructuredCatalog.FamilyPublished',
  'StructuredCatalog.VariantUpserted',
]);

export interface CatalogDispatchContext {
  catalogState: CatalogStateStore;
  projections: ProjectionStore;
  search: SearchEngine;
  cache: Cache;
}

export async function dispatchCatalogEvent(
  envelope: EventEnvelope,
  ctx: CatalogDispatchContext,
): Promise<void> {
  if (CATALOG_EVENT_TYPES.has(envelope.eventType)) {
    await rebuildTaxonomyNavigation(envelope.tenantId, ctx.catalogState, ctx.projections);
    await rebuildFamilyDetail(envelope.tenantId, ctx.catalogState, ctx.projections);
    await rebuildVariantMatrix(envelope.tenantId, ctx.catalogState, ctx.projections);
    await rebuildSearchDocuments(envelope.tenantId, ctx.catalogState, ctx.search);
  }

  if (envelope.cacheInvalidationTags && envelope.cacheInvalidationTags.length > 0) {
    await ctx.cache.invalidateByTags(envelope.cacheInvalidationTags);
  }
}
