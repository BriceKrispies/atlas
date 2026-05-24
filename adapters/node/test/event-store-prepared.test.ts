/**
 * PostgresEventStore.append — production-config (prepared, against a real
 * provisioned tenant DB).
 *
 * The existing contract suite at `adapters/node/test/event-store.test.ts`
 * uses a hand-created test database (`adapters_node_test`) with
 * `prepare: false`. That setup does NOT reproduce a real production
 * failure: when `apps/server` writes the `Tenancy.SignupApproved` event
 * through `PostgresEventStore.append` into a tenant DB that was
 * created by `PostgresTenantDbProvider.provisionTenantDatabase`,
 * postgres.js's `sql.array(string[])` parameter binding gets sent as
 * a single `text` value rather than `text[]`. Postgres rejects with
 *
 *   column "cache_invalidation_tags" is of type text[] but
 *   expression is of type text
 *
 * The bug only reproduces against provisioned tenant DBs, not against
 * a hand-created CREATE DATABASE; the schemas are byte-identical so
 * the divergence is some combination of postgres.js's type-OID
 * inference and the provisioned-DB session state. The defensive fix
 * — explicit `::text[]` cast in the SQL — sidesteps the inference
 * path entirely.
 *
 * This file sets up the exact production scenario: provision a fresh
 * tenant DB, open the runtime pool, call `PostgresEventStore.append`
 * with a string-array `cacheInvalidationTags`. Without the fix, the
 * first test fails with the production error; with the fix, all four
 * pass.
 *
 * Spec:
 *   - specs/domains/tenancy/capabilities/public-signup/README.md
 *   - tickets/tenancy/admin-approve-provisions-tenant-db.md
 */
import { describe, test, expect, beforeAll, afterAll } from '@atlas/test';
import postgres from 'postgres';
import {
  PostgresEventStore,
  PostgresTenantDbProvider,
} from '../src/index.ts';
import type { EventEnvelope } from '@atlas/platform-core';

const CONTROL_PLANE_URL = process.env['TEST_CONTROL_PLANE_DB_URL']
  ?? 'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const PROVISIONER_INFO = {
  host: 'localhost',
  port: 15433,
  user: 'atlas_platform',
  password: 'local_dev_password',
};

const HAS_DB = process.env['TEST_TENANT_DB_URL'] !== undefined
  || process.env['TEST_CONTROL_PLANE_DB_URL'] !== undefined;

let controlPlaneSql: postgres.Sql | null = null;
let provider: PostgresTenantDbProvider | null = null;
let provisionedTenantId: string | null = null;
let tenantSql: postgres.Sql | null = null;

beforeAll(async function () {
  if (!HAS_DB) return;
  controlPlaneSql = postgres(CONTROL_PLANE_URL, { max: 2 });
  // Probe — if the control_plane.tenants table doesn't exist (db not
  // migrated), silently skip. Mirrors `_setup.ts:HAS_DB` skip-on-missing.
  try {
    await controlPlaneSql`SELECT 1 FROM control_plane.tenants LIMIT 1`;
  } catch {
    await controlPlaneSql.end({ timeout: 1 });
    controlPlaneSql = null;
    return;
  }
  // Pick a unique tenant id per run so concurrent test invocations
  // and re-runs don't collide on CREATE DATABASE.
  provisionedTenantId =
    'es-prep-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8);
  await controlPlaneSql`
    INSERT INTO control_plane.tenants (tenant_id, name, status)
    VALUES (${provisionedTenantId}, ${provisionedTenantId}, 'active')
  `;
  provider = new PostgresTenantDbProvider(controlPlaneSql);
  await provider.provisionTenantDatabase({ tenantId: provisionedTenantId });
  tenantSql = await provider.getPool(provisionedTenantId);
});

afterAll(async function () {
  if (provider) {
    try {
      await provider.close();
    } catch {
      // best-effort
    }
    provider = null;
  }
  if (provisionedTenantId && controlPlaneSql) {
    // Drop the provisioned DB so reruns don't accumulate. Best-effort.
    const sanitised = provisionedTenantId.replace(/-/g, '_');
    try {
      await controlPlaneSql.unsafe(
        `DROP DATABASE IF EXISTS atlas_t_${sanitised} WITH (FORCE)`,
      );
      await controlPlaneSql.unsafe(
        `DROP ROLE IF EXISTS atlas_t_${sanitised}_runtime`,
      );
      await controlPlaneSql`DELETE FROM control_plane.tenants WHERE tenant_id = ${provisionedTenantId}`;
    } catch {
      // best-effort
    }
  }
  if (controlPlaneSql) {
    await controlPlaneSql.end({ timeout: 1 });
    controlPlaneSql = null;
  }
});

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: overrides.eventId ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'Tenancy.SignupApproved',
    schemaId: 'tenancy.signup.approved.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: provisionedTenantId ?? '',
    correlationId: 'test-correlation',
    idempotencyKey: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    causationId: null,
    principalId: 'test-principal',
    userId: null,
    cacheInvalidationTags: ['Tenant:test', 'Signup:s1'],
    payload: { signupId: 's1' },
    ...overrides,
  } as EventEnvelope;
}

describe('PostgresEventStore.append (provisioned tenant DB, production config)', function () {
  test('append succeeds with a string[] cacheInvalidationTags — the BDD failure mode', async function () {
    if (!tenantSql || !provisionedTenantId) {
      // Postgres unreachable — silently skip.
      return;
    }
    const store = new PostgresEventStore(tenantSql);
    const envelope = makeEnvelope({
      cacheInvalidationTags: [`Tenant:${provisionedTenantId}`, 'Signup:sg-1'],
    });
    const stored = await store.append(envelope);
    expect(stored.eventId).toBe(envelope.eventId);
    expect(stored.cacheInvalidationTags).toEqual([
      `Tenant:${provisionedTenantId}`,
      'Signup:sg-1',
    ]);
  });

  test('append round-trips a single-element tag array', async function () {
    if (!tenantSql || !provisionedTenantId) return;
    const store = new PostgresEventStore(tenantSql);
    const envelope = makeEnvelope({ cacheInvalidationTags: ['Tenant:only'] });
    const stored = await store.append(envelope);
    expect(stored.cacheInvalidationTags).toEqual(['Tenant:only']);
  });

  test('append round-trips a three-element tag array', async function () {
    if (!tenantSql || !provisionedTenantId) return;
    const store = new PostgresEventStore(tenantSql);
    const envelope = makeEnvelope({
      cacheInvalidationTags: ['Tenant:t', 'Signup:s', 'Membership:m'],
    });
    const stored = await store.append(envelope);
    expect(stored.cacheInvalidationTags).toContain('Tenant:t');
    expect(stored.cacheInvalidationTags).toContain('Signup:s');
    expect(stored.cacheInvalidationTags).toContain('Membership:m');
  });

  test('append with null cacheInvalidationTags still works', async function () {
    if (!tenantSql || !provisionedTenantId) return;
    const store = new PostgresEventStore(tenantSql);
    const envelope = makeEnvelope({ cacheInvalidationTags: null });
    const stored = await store.append(envelope);
    expect(stored.eventId).toBe(envelope.eventId);
  });
});
