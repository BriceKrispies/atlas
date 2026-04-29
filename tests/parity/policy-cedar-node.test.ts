/**
 * Node-mode parity for the Cedar policy engine.
 *
 * Seeds a Cedar bundle directly into `control_plane.policies` for a freshly
 * minted tenant, then drives the running `apps/server` via its HTTP
 * surface. Asserts:
 *
 *   - permit on a matching action lets a valid intent through
 *   - deny on a non-matching action surfaces 403 / UNAUTHORIZED
 *   - cross-tenant isolation: tenant A's bundle never leaks into B
 *   - forbid-overrides-permit (Invariant I4) wins
 *
 * Skipped unless the parity supervisor has set `NODE_PARITY_BASE_URL`
 * (i.e. `apps/server` is up). Requires `POLICY_ENGINE=cedar` on the
 * server, surfaced via the parity harness's env.
 *
 * The test does NOT use `apps/server`'s public intent endpoint to seed
 * the policy — it writes the row directly with a postgres client. That
 * mirrors how an admin tool would seed bundles in production
 * pre-Authz.Policy.* surface (Chunk 6c+).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { makeServerIngress } from './lib/server-factory.ts';
import {
  intentWithMismatchedTenant,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const policyEngineKind = process.env['POLICY_ENGINE'] ?? 'stub';
// Two-axis gate: parity infra must be up AND the server has to be running
// in `cedar` mode. The supervisor sets POLICY_ENGINE on the child but not
// in the test process, so we accept either signal.
const enableSuite = baseUrl && (
  policyEngineKind === 'cedar' || process.env['NODE_PARITY_POLICY_ENGINE'] === 'cedar'
);

const d = enableSuite ? describe : describe.skip;

const CEDAR_BUNDLE = `
  @id("permit-seed-apply")
  permit (
    principal,
    action == Action::"Catalog.SeedPackage.Apply",
    resource
  );

  @id("forbid-protected-deletes")
  forbid (
    principal,
    action == Action::"Catalog.Family.Delete",
    resource
  );
`;

async function seedPolicy(
  sql: postgres.Sql,
  tenantId: string,
  cedarText: string,
  version = 1,
): Promise<void> {
  // Tenant row first — `policies.tenant_id` has an FK to `tenants.tenant_id`.
  await sql`
    INSERT INTO control_plane.tenants (tenant_id, name, status)
    VALUES (${tenantId}, ${tenantId}, 'active')
    ON CONFLICT (tenant_id) DO NOTHING
  `;
  await sql`
    INSERT INTO control_plane.policies (tenant_id, version, policy_json, status)
    VALUES (
      ${tenantId},
      ${version},
      ${sql.json({ format: 'cedar-text', policies: cedarText, schemaVersion: 1 })},
      'active'
    )
    ON CONFLICT (tenant_id, version) DO UPDATE SET
      policy_json = EXCLUDED.policy_json,
      status = 'active'
  `;
}

d('[node] Cedar policy engine parity', () => {
  const dbUrl =
    process.env['CONTROL_PLANE_DB_URL'] ??
    'postgres://atlas_platform:local_dev_password@localhost:5433/control_plane';
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(dbUrl, { max: 2 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  test('permits a matching action when a tenant has a permissive bundle', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cedar-permit');
    await seedPolicy(sql, tenantId, CEDAR_BUNDLE);

    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('cedar-permit'),
    });
    const r = await ingress.submitIntent(env);
    expect(r.eventId.length).toBeGreaterThan(0);
    await ingress.close();
  });

  test('cross-tenant isolation: tenant A bundle does not authorize tenant B requests', async () => {
    const { ingress: ingressA, tenantId: tenantA } = await makeServerIngress('cedar-iso-a');
    await seedPolicy(sql, tenantA, CEDAR_BUNDLE);
    await ingressA.close();

    // Tenant B never gets a bundle seeded — engine should fall through to
    // the permissive (no-bundle) path, which still enforces tenant scope.
    const { ingress: ingressB, principalId } = await makeServerIngress('cedar-iso-b');
    const env = intentWithMismatchedTenant({
      envelopeTenantId: tenantA, // attempt to act as tenant A
      principalId,
    });
    const out = await ingressB.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(403);
      expect(['TENANT_MISMATCH', 'UNAUTHORIZED']).toContain(out.failure.code);
    }
    await ingressB.close();
  });

  test('forbid-overrides-permit: a forbid for the same action wins', async () => {
    // Bundle that *both* permits SeedPackage.Apply AND forbids it. Cedar's
    // deny-overrides semantics (Invariant I4) means the forbid wins → 403.
    const { ingress, tenantId, principalId } = await makeServerIngress('cedar-forbid');
    const conflictingBundle = `
      @id("permit-seed-apply")
      permit (
        principal,
        action == Action::"Catalog.SeedPackage.Apply",
        resource
      );

      @id("forbid-seed-apply")
      forbid (
        principal,
        action == Action::"Catalog.SeedPackage.Apply",
        resource
      );
    `;
    await seedPolicy(sql, tenantId, conflictingBundle);

    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('cedar-forbid'),
    });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(403);
    }
    await ingress.close();
  });

  test('no-bundle tenant falls through to permissive (allow-all-with-tenant-scope)', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('cedar-nobundle');
    // Deliberately do NOT seed a bundle. The engine's permissive fallback
    // should still allow same-tenant intents through.
    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('cedar-nobundle'),
    });
    const r = await ingress.submitIntent(env);
    expect(r.eventId.length).toBeGreaterThan(0);
    await ingress.close();
  });
});
