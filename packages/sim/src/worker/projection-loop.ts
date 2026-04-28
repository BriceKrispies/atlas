import type { Db } from '../ports/db.ts';
import type { ProjectionStorePort } from '../ports/projection-store.ts';
import type { SearchEnginePort } from '../ports/search-engine.ts';
import type { CachePort } from '../ports/cache.ts';
import type { EventEnvelope } from '../types.ts';
import { rebuildTaxonomyNavigation } from '../domain/catalog/projections/taxonomy-navigation.ts';
import { rebuildFamilyDetail } from '../domain/catalog/projections/family-detail.ts';
import { rebuildVariantMatrix } from '../domain/catalog/projections/variant-matrix.ts';
import { rebuildSearchDocuments } from '../domain/catalog/projections/search-documents.ts';

const CATALOG_EVENT_TYPES = new Set([
  'StructuredCatalog.SeedPackageApplied',
  'StructuredCatalog.FamilyPublished',
  'StructuredCatalog.VariantUpserted',
]);

export interface ProjectionContext {
  db: Db;
  projections: ProjectionStorePort;
  search: SearchEnginePort;
  cache: CachePort;
}

export async function dispatchEvent(envelope: EventEnvelope, ctx: ProjectionContext): Promise<void> {
  if (CATALOG_EVENT_TYPES.has(envelope.eventType)) {
    await rebuildTaxonomyNavigation(envelope.tenantId, ctx.db, ctx.projections);
    await rebuildFamilyDetail(envelope.tenantId, ctx.db, ctx.projections);
    await rebuildVariantMatrix(envelope.tenantId, ctx.db, ctx.projections);
    await rebuildSearchDocuments(envelope.tenantId, ctx.db, ctx.search);
  }

  if (envelope.cacheInvalidationTags && envelope.cacheInvalidationTags.length > 0) {
    await ctx.cache.invalidateByTags(envelope.cacheInvalidationTags);
  }
}
