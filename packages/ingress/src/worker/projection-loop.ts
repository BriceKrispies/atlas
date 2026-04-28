import type { EventEnvelope } from '@atlas/platform-core';
import type {
  CatalogStateStore,
  ProjectionStore,
  SearchEngine,
  Cache,
} from '@atlas/ports';
import {
  rebuildTaxonomyNavigation,
  rebuildFamilyDetail,
  rebuildVariantMatrix,
  rebuildSearchDocuments,
} from '@atlas/modules-catalog';

const CATALOG_EVENT_TYPES = new Set([
  'StructuredCatalog.SeedPackageApplied',
  'StructuredCatalog.FamilyPublished',
  'StructuredCatalog.VariantUpserted',
]);

export interface ProjectionContext {
  catalogState: CatalogStateStore;
  projections: ProjectionStore;
  search: SearchEngine;
  cache: Cache;
}

export async function dispatchEvent(envelope: EventEnvelope, ctx: ProjectionContext): Promise<void> {
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
