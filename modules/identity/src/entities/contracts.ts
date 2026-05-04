/**
 * Locked contract types for the identity module.
 *
 * Mirrors the Phase B.1 pattern in `@atlas/content-pages/entities/contracts.ts`:
 * one source of truth for the `Deps` shapes that handlers, the dispatcher,
 * and the query layer all consume. Keeps wiring sites honest about which
 * stores they need to thread.
 *
 * Phase A2 extends the Deps with optional `sessionPolicy` so the
 * session-lifetime middleware (idle / hard timeout, concurrent-session
 * eviction) and the AuthSession-Issue handler share a single source of
 * truth on tenant policy. The slot is optional — handlers fall back to
 * `DEFAULT_SESSION_POLICY` (see `../types.ts`) when unset, which is
 * what test fixtures and the IDB sim do.
 */

import type {
  Cache,
  EntityStore,
  RelationStore,
} from '@atlas/ports';
import type { SessionPolicy } from '../types.ts';

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

/**
 * Resolver for per-tenant session policy. The wiring layer reads
 * `control_plane.tenants.session_policy_json` and adapts it into this
 * shape; tests / sim provide a synchronous fallback that returns
 * `DEFAULT_SESSION_POLICY`.
 *
 * Async on purpose so the wiring layer can defer the row read until
 * a session-policy-touching handler actually fires (Issue, Refresh,
 * lifetime-check) rather than on every request.
 */
export type SessionPolicyResolver = (tenantId: string) => Promise<SessionPolicy>;

/**
 * Phase A2 dispatcher context — extends the A1 shape with optional
 * session-policy resolution. The `auth-session` dispatcher reads
 * policy on Refresh / lifetime updates; ApiKey + ServicePrincipal +
 * OAuth dispatchers do not consult it.
 */
export interface IdentityDispatchContextA2 extends IdentityDispatchContext {
  /**
   * Resolves per-tenant session policy. Optional — handlers fall back
   * to `DEFAULT_SESSION_POLICY` when absent.
   */
  sessionPolicy?: SessionPolicyResolver;
}

/**
 * Phase A2 query deps — same extension shape so query helpers that
 * compute "is this session within idle window?" can read policy
 * uniformly.
 */
export interface IdentityQueryDepsA2 extends IdentityQueryDeps {
  sessionPolicy?: SessionPolicyResolver;
}
