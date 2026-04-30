import type { EventEnvelope } from '@atlas/platform-core';
import type {
  CatalogStateStore,
  ProjectionStore,
  SearchEngine,
  Cache,
  EventDispatcher,
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
  /**
   * Reserved for future use. Cache-tag invalidation no longer lives in this
   * dispatcher (Chunk 8 — moved to a cross-cutting `cacheTagDispatcher` in
   * the wiring layer); the field is kept on the context type so existing
   * call sites compile, but the catalog dispatcher does not consume it
   * today.
   */
  cache?: Cache;
}

/**
 * Apply catalog projection rebuilds for catalog event types. Cross-cutting
 * cache-tag invalidation has been factored out — see
 * `cacheTagDispatcher` in `@atlas/ports` consumers (apps/server) for the
 * tag-flush path. This function is now a pure projection-rebuild trigger,
 * with no responsibility outside its own module.
 */
export async function dispatchCatalogEvent(
  envelope: EventEnvelope,
  ctx: CatalogDispatchContext,
): Promise<void> {
  if (!CATALOG_EVENT_TYPES.has(envelope.eventType)) return;
  await rebuildTaxonomyNavigation(envelope.tenantId, ctx.catalogState, ctx.projections);
  await rebuildFamilyDetail(envelope.tenantId, ctx.catalogState, ctx.projections);
  await rebuildVariantMatrix(envelope.tenantId, ctx.catalogState, ctx.projections);
  await rebuildSearchDocuments(envelope.tenantId, ctx.catalogState, ctx.search);
}

/**
 * Factory: bind a `CatalogDispatchContext` and return an
 * `EventDispatcher` (per-event closure). Designed for `composeDispatchers`.
 *
 *   const dispatch = composeDispatchers(
 *     catalogDispatcher({ catalogState, projections, search, cache }),
 *     ...
 *   );
 *
 * Adding catalog logic that runs on every event lives here; cross-cutting
 * concerns (cache invalidation, audit fan-out) belong in their own
 * dispatcher rather than piggy-backing on this one.
 */
export function catalogDispatcher(ctx: CatalogDispatchContext): EventDispatcher {
  return (envelope) => dispatchCatalogEvent(envelope, ctx);
}
