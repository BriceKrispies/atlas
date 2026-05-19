/**
 * Platform-tenant primitives.
 *
 * Per [ADR 0008](../../../specs/decisions/0008-atlas-on-atlas.md) Atlas's
 * own admin / identity / authz / audit operations run through the same
 * machinery any tenant uses. The platform is a row in
 * `control_plane.tenants`, not a categorically different layer.
 *
 * This file owns:
 *
 *   - {@link PLATFORM_TENANT_ID} — the canonical tenant-id slug for the
 *     platform partition. Code paths that used to hard-code `'_platform'`
 *     import this constant; the slug literal stays in spec docs as
 *     prose, but never in source files.
 *
 *   - {@link PLATFORM_ROBOT_PRINCIPAL_ID} / {@link PlatformRobotPrincipal} —
 *     the first-class principal type for system-initiated events
 *     (signup, OAuth callback, JIT provisioning, password-login). Replaces
 *     `principalId: null` sentinels. Carries no human-user fields — it
 *     is a process identity, not an account.
 *
 * The platform-tenant row is created at boot by `apps/server/src/bootstrap.ts`
 * using `INSERT ... ON CONFLICT DO NOTHING` so reboots are idempotent.
 */

/**
 * Canonical tenant-id for the platform partition. Stable forever — renaming
 * this slug is a migration, not a code change ([ADR 0008](../../../specs/decisions/0008-atlas-on-atlas.md) §1).
 */
export const PLATFORM_TENANT_ID = '_platform';

/**
 * Stable principal-id for the bootstrap platform robot. Used to stamp
 * `principalId` on system-initiated events that have no human actor —
 * e.g. an unauthenticated signup request, an OAuth token revocation
 * from a client app, a JIT-provisioned User on first IdP login.
 *
 * Format mirrors how other principal kinds are encoded in event logs:
 * `<kind>:<sub-id>`. The sub-id is `bootstrap` for the always-on robot;
 * future robots (e.g. per-job operator identities) get their own sub-ids.
 */
export const PLATFORM_ROBOT_PRINCIPAL_ID = 'platform-robot:bootstrap';

/**
 * First-class principal type for system-initiated operations. Replaces
 * the `principalId: null` sentinel that earlier code used to mark
 * "no actor" — there is now always an actor, and audit / authz can
 * treat platform-driven writes uniformly with user-driven ones.
 *
 * Intentionally minimal:
 *
 *   - `kind: 'platform-robot'` distinguishes this from `User`, API key,
 *     ServicePrincipal, etc.
 *   - `principalId` is one of the stable robot ids
 *     (e.g. {@link PLATFORM_ROBOT_PRINCIPAL_ID}).
 *   - `tenantId` is the platform partition by default. Some flows
 *     emit events INTO a customer tenant (signup confirm provisions a
 *     User inside the new tenant) — those override `tenantId` at the
 *     call site so audit retains tenant scoping.
 *
 * No email, displayName, or other human-user fields — this is a process
 * identity, not an account.
 */
export interface PlatformRobotPrincipal {
  readonly kind: 'platform-robot';
  readonly principalId: string;
  readonly tenantId: string;
}

/**
 * Construct a {@link PlatformRobotPrincipal} for the always-on bootstrap
 * robot. `tenantId` defaults to {@link PLATFORM_TENANT_ID}; pass a
 * customer tenant id for flows that mint events inside that tenant
 * partition (e.g. confirming a signup creates the first User inside
 * `<new-tenant>` while the principal stays the platform robot).
 */
export function bootstrapPlatformRobot(
  tenantId: string = PLATFORM_TENANT_ID,
): PlatformRobotPrincipal {
  return {
    kind: 'platform-robot',
    principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
    tenantId,
  };
}

/**
 * Stable principal-id for the canonical platform administrator. Auto-seeded
 * at first boot of `apps/server` as a `User` entity in {@link PLATFORM_TENANT_ID},
 * with a `Membership` granting `roles=['admin']`. This is the bootstrap
 * operator identity — production deployments override the email and rotate
 * credentials after the seed lands.
 *
 * Distinct from {@link PLATFORM_ROBOT_PRINCIPAL_ID}: the robot is a process
 * identity for unauthenticated system events; this is a human/operator
 * identity that can drive admin-only endpoints (signup approval, policy
 * management) via test-auth or a real session.
 */
export const PLATFORM_ADMIN_PRINCIPAL_ID = 'platform-admin';

/** Default email for the seeded {@link PLATFORM_ADMIN_PRINCIPAL_ID} User. */
export const PLATFORM_ADMIN_EMAIL = 'platform-admin@atlas.local';
