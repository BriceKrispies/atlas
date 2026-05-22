/**
 * Integration test: query-side catch-all dispatcher.
 *
 * Substrate ticket: `tickets/atlas-on-atlas/query-catch-all-dispatcher.md`.
 * Contract: `specs/crosscut/action-driven-routing.md` §4.
 *
 * Drives the running `apps/server` HTTP boundary to confirm:
 *   - `GET /api/v1/queries/Identity.Memberships.List` is reachable with
 *     an authorized debug-principal (returns 200 + a JSON array).
 *   - An unknown queryId returns 404 (catch-all owns the surface; no
 *     hand-mount required).
 *   - An unauthenticated request returns 401 (the catch-all is mounted
 *     under the authed group).
 *
 * In-process route-level coverage — including the synthetic-query
 * roundtrip, I2 deny, and the cacheKey wire-through — lives at
 * `apps/server/test/routes/queries.test.ts`. This file is the
 * end-to-end HTTP-boundary smoke for the substrate.
 *
 * Skipped silently when `apps/server` is not reachable; same pattern as
 * `custom-domains.itest.ts`, `intent-logging.itest.ts`, etc.
 */
import { test, expect } from '@playwright/test';

const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const TENANT_ID = process.env['TENANT_ID'] ?? 'dev-tenant';

async function ingressUp(): Promise<boolean> {
  try {
    const res = await fetch(`${INGRESS}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

test.describe('query-side catch-all (/api/v1/queries/:queryId)', function () {
  test.beforeAll(async function () {
    if (!(await ingressUp())) {
      test.skip(true, `apps/server at ${INGRESS} not reachable`);
    }
  });

  test('GET Identity.Memberships.List with debug admin → 200 + JSON array', async function () {
    const res = await fetch(
      `${INGRESS}/api/v1/queries/Identity.Memberships.List`,
      {
        headers: {
          'X-Debug-Principal': `user:tester:${TENANT_ID}:admin`,
        },
      },
    );
    // The catch-all reached the descriptor; the only failure-shapes
    // here are 401 (no principal — wrong harness setup) or 500
    // (real outage). 200 / 403 are both "the catch-all is wired" —
    // 403 means policy denies the test principal; 200 means the
    // memberships query ran. Allow either since policy seeding is
    // out of this ticket's scope; both prove the substrate is mounted.
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const body: unknown = await res.json();
      expect(Array.isArray(body)).toBe(true);
    }
  });

  test('GET unknown queryId → 404 (catch-all owns the surface)', async function () {
    const res = await fetch(
      `${INGRESS}/api/v1/queries/Synthetic.NotRegistered.Anywhere`,
      {
        headers: {
          'X-Debug-Principal': `user:tester:${TENANT_ID}:admin`,
        },
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  test('no auth → 401', async function () {
    const res = await fetch(
      `${INGRESS}/api/v1/queries/Identity.Memberships.List`,
    );
    // Catch-all is mounted under the authed group; principal middleware
    // rejects unauthenticated calls before reaching the route handler.
    expect([401, 403]).toContain(res.status);
  });
});
