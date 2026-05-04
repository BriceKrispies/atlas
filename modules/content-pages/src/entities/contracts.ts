/**
 * Locked contract types for the Phase B.1 migration.
 *
 * Stage 2 + 3 agents in the parallel sets import from here so they
 * share **one source of truth** on the post-migration shape of the
 * dispatcher and query Deps. Without this published contract, two
 * agents could land conflicting definitions of `entities` /
 * `relations` slots and we'd be back to merge-conflict whack-a-mole.
 *
 * These shapes intentionally do NOT include `renderTreeStore` — that
 * port is retired in Stage 5. Stage 2 handlers and Stage 3 wiring
 * thread `EntityStore` + `RelationStore` everywhere `renderTreeStore`
 * was previously threaded.
 *
 * The "V2" suffix denotes "post-migration"; the legacy interfaces
 * (`ContentPagesDispatchContext`, `ContentPagesQueryDeps`) keep their
 * names to minimize call-site churn during the dual-write window.
 * After Stage 5, these V2 types replace the legacy ones outright.
 */

import type {
  Cache,
  EntityStore,
  RelationStore,
  WasmHost,
} from '@atlas/ports';

/**
 * Post-migration shape of `ContentPagesDispatchContext`.
 *
 * Consumers in Stage 2:
 *   - `dispatch.ts` (Agent B owns)
 *   - handlers (Agent A reads to know which deps a handler needs)
 *
 * The `cache` slot stays optional (cross-cutting flush still happens
 * via the wiring layer's `cacheTagDispatcher`, not in this module).
 */
export interface ContentPagesDispatchContextV2 {
  entities: EntityStore;
  relations: RelationStore;
  /**
   * Reserved. Cross-cutting cache invalidation lives in the wiring
   * layer's `cacheTagDispatcher`. Kept here so the type stays compatible
   * with call sites that pass it through.
   */
  cache?: Cache;
  /**
   * Optional WASM host for `pluginRef`-routed render trees. Threaded by
   * the wiring layer (server / sim factory).
   */
  wasmHost?: WasmHost;
}

/**
 * Post-migration shape of `ContentPagesQueryDeps`.
 *
 * Consumers in Stage 3:
 *   - `queries.ts` (Agent D owns)
 *   - `apps/server/src/middleware/state.ts`,
 *     `apps/sim/src/main.ts`,
 *     `tests/parity/lib/sim-factory.ts` (Agent E owns)
 */
export interface ContentPagesQueryDepsV2 {
  tenantId: string;
  principalId: string;
  correlationId: string;
  entities: EntityStore;
  relations: RelationStore;
}
