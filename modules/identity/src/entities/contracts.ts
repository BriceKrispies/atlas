/**
 * Locked contract types for the identity module.
 *
 * Mirrors the Phase B.1 pattern in `@atlas/content-pages/entities/contracts.ts`:
 * one source of truth for the `Deps` shapes that handlers, the dispatcher,
 * and the query layer all consume. Keeps wiring sites honest about which
 * stores they need to thread.
 */

import type {
  Cache,
  EntityStore,
  RelationStore,
} from '@atlas/ports';

export interface IdentityDispatchContext {
  entities: EntityStore;
  relations: RelationStore;
  /**
   * Reserved. Cross-cutting cache invalidation lives in the wiring
   * layer's `cacheTagDispatcher`.
   */
  cache?: Cache;
}

export interface IdentityQueryDeps {
  tenantId: string;
  principalId: string;
  correlationId: string;
  entities: EntityStore;
  relations: RelationStore;
}
