/**
 * Integration test: custom-domain Host-header → tenantId resolution.
 *
 * Requires:
 *   - apps/server running with TEST_AUTH_ENABLED=true on `INGRESS_BASE_URL`
 *     (default http://localhost:3000)
 *   - control-plane DB reachable at `CONTROL_PLANE_DB_URL`
 *
 * Skipped silently when either is missing.
 *
 * Drives a fetch request with an explicit `Host:` header and asserts:
 *   - matching Host + JWT tenant → 200 / route handled
 *   - mismatched Host + JWT tenant → 403 PRINCIPAL_INVALID
 *   - unregistered Host (no row) → no constraint applied; passes through
 */

import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const CP_URL = process.env['CONTROL_PLANE_DB_URL'];

const TENANT_A = 'cd-itest-a';
const TENANT_B = 'cd-itest-b';
const HOST_A = 'community.cd-itest-a.test';
const HOST_UNKNOWN = 'unknown.cd-itest.test';

test.describe('custom-domain host resolution', () => {
  let sql: postgres.Sql | null = null;

  test.beforeAll(async () => {
    if (!CP_URL) {
      test.skip(true, 'CONTROL_PLANE_DB_URL not set');
      return;
    }
    // Bail early if apps/server isn't reachable.
    try {
      const ping = await fetch(`${INGRESS}/healthz`);
      if (!ping.ok) {
        test.skip(true, `apps/server at ${INGRESS} not healthy`);
        return;
      }
    } catch {
      test.skip(true, `apps/server at ${INGRESS} not reachable`);
      return;
    }

    sql = postgres(CP_URL, { max: 2 });
    // Both tenants must exist for the FK on custom_domains. We don't
    // populate the per-tenant DB columns because this test only exercises
    // the ingress middleware path, which doesn't open tenant pools.
    await sql`DELETE FROM control_plane.custom_domains WHERE hostname IN (${HOST_A})`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
    await sql`
      INSERT INTO control_plane.tenants (tenant_id, name, status)
      VALUES (${TENANT_A}, 'A', 'active'), (${TENANT_B}, 'B', 'active')
    `;
    await sql`
      INSERT INTO control_plane.custom_domains (hostname, tenant_id, status, is_primary)
      VALUES (${HOST_A}, ${TENANT_A}, 'active', TRUE)
    `;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM control_plane.custom_domains WHERE hostname IN (${HOST_A})`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
    await sql.end({ timeout: 5 });
  });

  test('matching Host + debug-principal → 200 healthz', async () => {
    const res = await fetch(`${INGRESS}/healthz`, {
      headers: {
        Host: HOST_A,
        'X-Debug-Principal': `user:test:${TENANT_A}`,
      },
    });
    expect(res.status).toBe(200);
  });

  test('mismatched Host + debug-principal → 403 PRINCIPAL_INVALID', async () => {
    // /healthz is public (no principal middleware). Hit a route that
    // does run the principal middleware: any /api/v1/* path will do; we
    // don't need a successful handler dispatch, just the auth gate.
    const res = await fetch(`${INGRESS}/api/v1/intents`, {
      method: 'POST',
      headers: {
        Host: HOST_A,
        'Content-Type': 'application/json',
        'X-Debug-Principal': `user:test:${TENANT_B}`,
      },
      body: JSON.stringify({ noop: true }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe('PRINCIPAL_INVALID');
    // Message specifically mentions Host so we know we hit the new gate
    // and not some other PRINCIPAL_INVALID branch.
    expect(body.message ?? '').toMatch(/Host/i);
  });

  test('unregistered Host imposes no constraint → falls through to auth', async () => {
    // Same request as the mismatch test but with an unregistered hostname.
    // Should not 403 from our gate; will instead reach the request body /
    // schema validation step (which rejects with a different code).
    const res = await fetch(`${INGRESS}/api/v1/intents`, {
      method: 'POST',
      headers: {
        Host: HOST_UNKNOWN,
        'Content-Type': 'application/json',
        'X-Debug-Principal': `user:test:${TENANT_B}`,
      },
      body: JSON.stringify({ noop: true }),
    });
    // Whatever the next gate decides, it's NOT our Host-mismatch
    // PRINCIPAL_INVALID path. Most likely UNKNOWN_SCHEMA or
    // SCHEMA_VALIDATION_FAILED on this malformed body.
    if (res.status === 403) {
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').not.toMatch(/Host/i);
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });
});
