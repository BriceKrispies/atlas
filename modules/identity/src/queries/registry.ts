/**
 * Identity query registry — the per-module `QueryRegistry` consumed by the
 * server's query-side catch-all (`GET/POST /api/v1/queries/:queryId`).
 *
 * Substrate ticket: `tickets/atlas-on-atlas/query-catch-all-dispatcher.md`.
 * Contract: [`specs/crosscut/action-driven-routing.md`](../../../../specs/crosscut/action-driven-routing.md) §4.
 *
 * This file lands the FIRST registered query — `Identity.Memberships.List`
 * (the route the `identity/tenant-admin-invites-user` slice needs to render
 * the Users surface, per design doc §8). Additional identity queries
 * migrate onto the registry path in per-module follow-up slices; the
 * module-local query helpers in `../queries.ts` continue to work in
 * parallel during the migration window (§4.7).
 *
 * Per §4.2, the registered query function takes a `QueryContext` (the
 * unified per-request context built by `apps/server/src/middleware/state.ts`'s
 * `buildRequestBundle`) and returns a JSON-serialisable result. Positional
 * args that the legacy `*QueryDeps`-shaped helpers took become fields on
 * the `params` object; this query takes no params today (it lists every
 * membership in the request tenant), but the shape is reserved for future
 * filtering / pagination.
 */
import {
  createQueryRegistry,
  type EntityStore,
  type QueryContext,
  type QueryRegistry,
  type RelationStore,
} from '@atlas/ports';
import type { MembershipDocument } from '../types.ts';
import { listMembershipsForTenant } from '../entities/membership.ts';

/**
 * Structural narrowing of `QueryContext` to the shape this module's
 * queries read. Mirrors how the existing `IdentityQueryDeps` interface
 * carries `entities` / `relations` alongside the request envelope —
 * §4.2's migration contract calls for collapsing per-module deps into
 * the unified `QueryContext`, so each query reaches in via this narrow
 * accessor rather than re-declaring a parallel deps type.
 *
 * The catch-all wiring (`apps/server/src/middleware/state.ts`) populates
 * `entities` + `relations` with the per-request `EntityStore` /
 * `RelationStore` for the tenant pool; reading them off the context here
 * is the structural narrow §4.2 prescribes.
 */
function identityContext(ctx: QueryContext): {
  tenantId: string;
  entities: EntityStore;
  relations: RelationStore;
} {
  if (ctx.entities === undefined || ctx.entities === null) {
    throw new Error(
      'Identity query: QueryContext.entities is required (wired by buildRequestBundle).',
    );
  }
  if (ctx.relations === undefined || ctx.relations === null) {
    throw new Error(
      'Identity query: QueryContext.relations is required (wired by buildRequestBundle).',
    );
  }
  return {
    tenantId: ctx.tenantId,
    // §4.1 typed `entities` / `relations` as `unknown` to keep the port
    // file cycle-free; consumers structurally narrow at the reach-in.
    // The wiring layer populates concrete `EntityStore` / `RelationStore`
    // instances per request; the narrow here matches the shape the
    // legacy `IdentityQueryDeps` already enforced.
    entities: ctx.entities as EntityStore,
    relations: ctx.relations as RelationStore,
  };
}

/**
 * Build the identity-domain query registry. One instance per process —
 * `apps/server/src/middleware/state.ts` calls this at boot and composes
 * the result into the request-time catch-all dispatcher.
 *
 * Today's surface: one entry (`Identity.Memberships.List`). Future
 * identity reads (`Identity.Sessions.ListOwn`, `Identity.User.Get`, …)
 * register here as separate per-module-migration slices.
 */
export function identityQueryRegistry(): QueryRegistry {
  const registry = createQueryRegistry();

  // Identity.Memberships.List — every active membership in the request
  // tenant. No params today; the action Cedar policy evaluates against
  // `Tenant:<tenantId>` (Cedar action id mirrors queryId per §4.3 /
  // design-doc decision #3). Cache key per §4.6: tenantId literal,
  // unconditional inclusion, plain static shape.
  registry.register({
    queryId: 'Identity.Memberships.List',
    actionId: 'Identity.Memberships.List',
    resource: {
      type: 'Tenant',
      // `idFrom` returns the tenant id for the policy `Resource.id` slot.
      // List queries (`<…>.List`) scope by tenant, not by a per-row id;
      // pulling the tenant id from the request context via the catch-all
      // is the conventional shape (intent side mirror: `Identity.User.Create`
      // also scopes by tenant). The catch-all hands ctx.tenantId in via
      // a closure when it calls the descriptor below — see
      // `apps/server/src/routes/queries.ts` for the wire-through.
      //
      // Today `idFrom` only sees `params`; to keep the descriptor pure
      // (no closure over `ctx.tenantId` at the wrong scope), we return
      // a constant `''` here and let the catch-all populate
      // `resource.tenantId` from `ctx.tenantId` when it builds the
      // `PolicyEvaluationRequest`. This mirrors `routes/authz.ts:48`'s
      // `id: ''` for list actions.
      idFrom: function (_params: Record<string, unknown>): string {
        return '';
      },
    },
    cacheKey: function (ctx: QueryContext, _params: Record<string, unknown>): string {
      // §4.6: tenantId literal, unconditional inclusion. `Memberships`
      // segment names the resource collection so per-resource purges
      // (e.g. a future Membership.Updated emit) can target this key
      // specifically without dragging the broader `Tenant:<id>` tag.
      return `Identity.Memberships:${ctx.tenantId}`;
    },
    nullIsOk: false,
    fn: async function (
      ctx: QueryContext,
      _params: Record<string, unknown>,
    ): Promise<MembershipDocument[] | null> {
      const { tenantId, entities } = identityContext(ctx);
      // Delegate to the existing entity-level helper. The legacy
      // `listMemberships(deps)` wrapper in `../queries.ts` returns the
      // same shape; we reach for the entity helper directly here so the
      // registry doesn't depend on the legacy deps-shaped façade.
      return listMembershipsForTenant(entities, tenantId);
    },
  });

  return registry;
}
