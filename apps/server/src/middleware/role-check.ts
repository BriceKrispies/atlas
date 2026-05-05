/**
 * Inline role enforcement for routes that bypass the intent pipeline
 * (Phase A7 admin routes — impersonation + break-glass).
 *
 * Standard route flow goes through `POST /api/v1/intents`, where Cedar
 * resolves the principal's Membership.roles against the action manifest.
 * The Phase A7 routes are direct REST shortcuts that skip the intent
 * pipeline, so they must run their own role check or any authenticated
 * tenant member could trigger ops-only operations.
 *
 * Two checks:
 *
 *   - {@link assertPlatformOperator} — caller's HOME tenant Membership
 *     carries role 'PlatformSupport'. Used by impersonation/start +
 *     break-glass/issue + break-glass/approve + break-glass/deny.
 *
 *   - {@link assertTenantAdmin} — caller's Membership in the TARGET
 *     tenant carries role 'TenantAdmin'. Used by impersonation/revoke
 *     + break-glass/revoke (the customer-side override).
 *
 * Both look up the Membership lazily (one entity-store hit per route).
 * A future optimisation could hydrate Principal.roles in the principal
 * middleware and skip the per-route lookup, but inline-check is simpler
 * for now and the cost is bounded.
 */

import type { Context } from 'hono';
import type { Principal } from '@atlas/platform-core';
import {
  PostgresEntityStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  MEMBERSHIP_ENTITY_TYPE,
  MEMBERSHIP_USER_EDGE,
  type MembershipDocument,
} from '@atlas/identity';
import { ensureTenantMigrated } from '../bootstrap.ts';
import type { AppState } from '../bootstrap.ts';
import { errorResponse } from './errors.ts';
import { correlationIdFor } from './correlation.ts';
import type { ServerVariables } from './principal.ts';

/** Platform operator role. Lives on Memberships in the operator tenant. */
export const PLATFORM_SUPPORT_ROLE = 'PlatformSupport';

/** Tenant administrator role. Lives on Memberships in the target tenant. */
export const TENANT_ADMIN_ROLE = 'TenantAdmin';

/**
 * Returns the active Membership for `(tenantId, userId)`, or null when
 * none exists / it's not active. Resolves via the
 * `MEMBERSHIP_USER_EDGE` cross-partition relation rather than scanning
 * entities.
 */
async function findMembership(
  state: AppState,
  tenantId: string,
  userId: string,
): Promise<MembershipDocument | null> {
  if (!userId) return null;
  const sql = await ensureTenantMigrated(state, tenantId);
  const entities = new PostgresEntityStore(sql);
  const relations = new PostgresRelationStore(sql);
  // The userId-keyed cross-partition relation has the membership entity_id
  // on `fromId`. There can only be one Membership per (tenant, user) by
  // construction (membershipEntityIdFor is derived from userId).
  const incoming = await relations.incoming(
    tenantId,
    MEMBERSHIP_USER_EDGE,
    userId,
  );
  if (incoming.length === 0) {
    return null;
  }
  for (const edge of incoming) {
    const row = await entities.get<MembershipDocument>(
      tenantId,
      MEMBERSHIP_ENTITY_TYPE,
      edge.fromId,
    );
    if (row && row.status === 'active' && row.attrs.status === 'active') {
      return row.attrs;
    }
  }
  return null;
}

/**
 * Ensures the caller has the `PlatformSupport` role on a Membership in
 * THEIR own tenant (i.e. the platform-operator tenant). Returns null on
 * success; otherwise writes a 403 response and returns the response so
 * callers can `return` it directly.
 *
 * SECURITY: must run BEFORE any side effects (Invariant I2). Never
 * leaks WHICH check failed in the response — uniform 403 for any
 * non-operator caller.
 */
export async function assertPlatformOperator(
  c: Context<{ Variables: ServerVariables }>,
  state: AppState,
  principal: Principal,
): Promise<Response | null> {
  const correlationId = correlationIdFor(c);
  if (!principal.userId) {
    // Platform-operator routes require a User-backed principal — service
    // principals + API keys are deliberately excluded from impersonation
    // and break-glass issuance. This closes a path where a stolen API
    // key could escalate.
    return errorResponse(
      c,
      'IMPERSONATION_REQUIRES_OPERATOR',
      'platform operator role required',
      403,
      correlationId,
    );
  }
  const membership = await findMembership(
    state,
    principal.tenantId,
    principal.userId,
  );
  if (!membership || !membership.roles.includes(PLATFORM_SUPPORT_ROLE)) {
    return errorResponse(
      c,
      'IMPERSONATION_REQUIRES_OPERATOR',
      'platform operator role required',
      403,
      correlationId,
    );
  }
  return null;
}

/**
 * Ensures the caller has the `TenantAdmin` role on a Membership in the
 * TARGET tenant (which may differ from the caller's home tenant if this
 * is a cross-tenant administration scenario — but in practice the host
 * resolution + intent layer pin it to the same tenant).
 *
 * Used by tenant-side override routes (impersonation revoke, break-glass
 * revoke).
 */
export async function assertTenantAdmin(
  c: Context<{ Variables: ServerVariables }>,
  state: AppState,
  principal: Principal,
  targetTenantId: string,
): Promise<Response | null> {
  const correlationId = correlationIdFor(c);
  if (!principal.userId) {
    return errorResponse(
      c,
      'PRINCIPAL_INVALID',
      'tenant admin role required',
      403,
      correlationId,
    );
  }
  // The caller must have a Membership in the target tenant. If the
  // principal's home tenant differs from `targetTenantId`, this fails
  // (correctly — cross-tenant admin is not a thing today).
  if (principal.tenantId !== targetTenantId) {
    return errorResponse(
      c,
      'PRINCIPAL_INVALID',
      'tenant scope mismatch',
      403,
      correlationId,
    );
  }
  const membership = await findMembership(
    state,
    targetTenantId,
    principal.userId,
  );
  if (!membership || !membership.roles.includes(TENANT_ADMIN_ROLE)) {
    return errorResponse(
      c,
      'PRINCIPAL_INVALID',
      'tenant admin role required',
      403,
      correlationId,
    );
  }
  return null;
}

/**
 * Test-friendly variant: takes an EntityStore + RelationStore directly
 * instead of resolving them through `state.tenantDb`. Lets the unit
 * tests exercise the role check without spinning up Postgres.
 *
 * NOT for production use — production callers should always go through
 * `assertPlatformOperator` / `assertTenantAdmin` so the tenant-DB pool
 * caching kicks in.
 */
export async function findMembershipDirect(
  entities: PostgresEntityStore | { get: PostgresEntityStore['get'] },
  relations: PostgresRelationStore | {
    incoming: PostgresRelationStore['incoming'];
  },
  tenantId: string,
  userId: string,
): Promise<MembershipDocument | null> {
  if (!userId) return null;
  const incoming = await relations.incoming(
    tenantId,
    MEMBERSHIP_USER_EDGE,
    userId,
  );
  for (const edge of incoming) {
    const row = await entities.get<MembershipDocument>(
      tenantId,
      MEMBERSHIP_ENTITY_TYPE,
      edge.fromId,
    );
    if (row && row.status === 'active' && row.attrs.status === 'active') {
      return row.attrs;
    }
  }
  return null;
}
