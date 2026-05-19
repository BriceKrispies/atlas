/**
 * Unit test for the platform-admin boot seed.
 *
 * Driven through `makeFakeEntityStore` (no Postgres). Confirms the two
 * properties the bootstrap relies on:
 *
 *   1. First call on an empty store inserts the User + Membership rows
 *      and returns `{ created: true }`.
 *   2. Second call is a no-op and returns `{ created: false }` — the
 *      caller in `bootstrap.ts` uses this to suppress the
 *      `Tenancy.PlatformAdmin.Seeded` log line on subsequent boots.
 *
 * The real integration (per-tenant pool wiring + the boot log line) is
 * exercised by the BDD scenario added in slice 4.
 */
import { describe, expect, it } from '@atlas/test';
import type { Entity, EntityStore, EntityWriteInput } from '@atlas/ports';
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PRINCIPAL_ID,
  PLATFORM_TENANT_ID,
} from '@atlas/platform-core';
import { seedPlatformAdmin } from '../src/bootstrap-platform-admin.ts';

/**
 * Minimal in-memory EntityStore tracking only the operations
 * `seedPlatformAdmin` performs (`get` + `put`). The other methods throw
 * if exercised — keeps the fake honest, mirrors the throw-on-access
 * proxy pattern in `test/lib/factories.ts`.
 */
function makeMemoryEntityStore(): EntityStore & {
  puts: EntityWriteInput[];
  rows: Map<string, Entity>;
} {
  const rows = new Map<string, Entity>();
  const puts: EntityWriteInput[] = [];
  const keyOf = (
    tenantId: string,
    entityType: string,
    entityId: string,
  ): string => `${tenantId}::${entityType}::${entityId}`;
  return {
    rows,
    puts,
    async get<TAttrs = unknown>(
      tenantId: string,
      entityType: string,
      entityId: string,
    ): Promise<Entity<TAttrs> | null> {
      const row = rows.get(keyOf(tenantId, entityType, entityId));
      return (row as Entity<TAttrs> | undefined) ?? null;
    },
    async put<TAttrs = unknown>(
      input: EntityWriteInput<TAttrs>,
    ): Promise<Entity<TAttrs>> {
      puts.push(input as EntityWriteInput);
      const now = new Date().toISOString();
      const row: Entity<TAttrs> = {
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        schemaVersion: input.schemaVersion ?? 1,
        attrs: input.attrs,
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      };
      rows.set(
        keyOf(input.tenantId, input.entityType, input.entityId),
        row as Entity,
      );
      return row;
    },
    async delete(): Promise<void> {
      throw new Error('delete not used by seedPlatformAdmin');
    },
    async list(): Promise<Entity[]> {
      throw new Error('list not used by seedPlatformAdmin');
    },
    async query(): Promise<Entity[]> {
      throw new Error('query not used by seedPlatformAdmin');
    },
  };
}

describe('seedPlatformAdmin', function () {
  it('inserts User + Membership on a clean store and returns created:true', async function () {
    const entities = makeMemoryEntityStore();

    const result = await seedPlatformAdmin(entities);

    expect(result).toEqual({ created: true });
    expect(entities.puts).toHaveLength(2);

    // User row carries the canonical id, email, and active status. Anything
    // less and the BDD admin actor (X-Debug-Principal user:platform-admin:_platform:admin)
    // wouldn't have a real entity to point at.
    const user = await entities.get<{
      email: string;
      displayName: string;
      status: string;
    }>(PLATFORM_TENANT_ID, 'User', PLATFORM_ADMIN_PRINCIPAL_ID);
    expect(user).not.toBeNull();
    expect(user?.attrs.email).toBe(PLATFORM_ADMIN_EMAIL);
    expect(user?.attrs.displayName).toBe('Platform Admin');
    expect(user?.attrs.status).toBe('active');

    // Membership row carries roles=['admin'] in the platform tenant. This
    // is what makes the seeded admin actually admin — the principal
    // middleware (4-segment X-Debug-Principal) only hydrates header-supplied
    // roles, but production paths reading the Membership entity rely on
    // this row.
    const membership = await entities.get<{
      userId: string;
      tenantId: string;
      roles: string[];
      status: string;
    }>(
      PLATFORM_TENANT_ID,
      'Membership',
      `membership:${PLATFORM_ADMIN_PRINCIPAL_ID}`,
    );
    expect(membership).not.toBeNull();
    expect(membership?.attrs.userId).toBe(PLATFORM_ADMIN_PRINCIPAL_ID);
    expect(membership?.attrs.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(membership?.attrs.roles).toEqual(['admin']);
    expect(membership?.attrs.status).toBe('active');
  });

  it('is idempotent — second call writes nothing and returns created:false', async function () {
    const entities = makeMemoryEntityStore();

    const first = await seedPlatformAdmin(entities);
    expect(first).toEqual({ created: true });
    expect(entities.puts).toHaveLength(2);

    const second = await seedPlatformAdmin(entities);
    expect(second).toEqual({ created: false });

    // Crucially: the second call MUST NOT issue any further `put` calls.
    // The bootstrap log line is gated on `created`, so a stray write here
    // would either double-log or silently overwrite the production row.
    expect(entities.puts).toHaveLength(2);
    expect(entities.rows.size).toBe(2);
  });
});
