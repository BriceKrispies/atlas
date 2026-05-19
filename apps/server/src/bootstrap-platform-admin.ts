/**
 * Boot-time seed for the platform admin User + Membership entities in
 * `_platform`. Idempotent — re-runs return `{ created: false }` and
 * write nothing. The caller in `bootstrap.ts` owns the log line so
 * `seedPlatformAdmin` stays testable without a logger.
 *
 * Runs after `bootstrapPlatformRobot` and after `_platform`'s per-tenant
 * migrations have been applied (so the `entities` table exists). The
 * caller in `bootstrap.ts` orders this correctly via
 * `ensureTenantMigrated(state, PLATFORM_TENANT_ID)`.
 *
 * The shape is parameterised on an injected `EntityStore` rather than
 * pulled out of `AppState` so the unit test can drive it with an
 * in-memory fake — see `apps/server/test/bootstrap-platform-admin.test.ts`.
 * The `state`-shaped overload in `bootstrap.ts` does the per-tenant
 * pool + entityStoreFor wiring.
 *
 * Spec: specs/domains/tenancy/capabilities/public-signup/README.md
 *       (Surfaces / actors paragraph).
 */
import type { EntityStore } from '@atlas/ports';
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PRINCIPAL_ID,
  PLATFORM_TENANT_ID,
} from '@atlas/platform-core';

/** Membership entityId convention: `membership:<userId>`. */
const MEMBERSHIP_ENTITY_ID = `membership:${PLATFORM_ADMIN_PRINCIPAL_ID}`;

export interface SeedPlatformAdminResult {
  /**
   * `true` when this call inserted the User+Membership rows. `false` when
   * the User row already existed (re-boot). The caller uses this to
   * decide whether to emit `Tenancy.PlatformAdmin.Seeded` exactly once.
   */
  readonly created: boolean;
}

/**
 * Idempotently seed the platform-admin User+Membership in `_platform`.
 *
 * Existence check uses the `User` entity as the gate — if it exists, we
 * assume the Membership exists too (both inserted in the same call). If
 * a future migration ever orphans a User without its Membership the
 * recovery is to delete the User row and re-boot.
 */
export async function seedPlatformAdmin(
  entities: EntityStore,
): Promise<SeedPlatformAdminResult> {
  const existing = await entities.get(
    PLATFORM_TENANT_ID,
    'User',
    PLATFORM_ADMIN_PRINCIPAL_ID,
  );
  if (existing) return { created: false };

  await entities.put({
    tenantId: PLATFORM_TENANT_ID,
    entityType: 'User',
    entityId: PLATFORM_ADMIN_PRINCIPAL_ID,
    attrs: {
      email: PLATFORM_ADMIN_EMAIL,
      displayName: 'Platform Admin',
      status: 'active',
    },
  });

  await entities.put({
    tenantId: PLATFORM_TENANT_ID,
    entityType: 'Membership',
    entityId: MEMBERSHIP_ENTITY_ID,
    attrs: {
      userId: PLATFORM_ADMIN_PRINCIPAL_ID,
      tenantId: PLATFORM_TENANT_ID,
      roles: ['admin'],
      status: 'active',
    },
  });

  return { created: true };
}
