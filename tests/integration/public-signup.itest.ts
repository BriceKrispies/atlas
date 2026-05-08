/**
 * Integration test: public signup → smtp4dev → magic link → tenant home.
 *
 * Drives the full Phase 1 Slice 1 loop end-to-end against the real
 * `apps/server` and a real `smtp4dev` container. Skipped silently when
 * either is unreachable so this can live alongside other itest specs
 * that don't need SMTP.
 *
 * Pre-requisites (all checked in `beforeAll`):
 *   - apps/server running on `INGRESS_BASE_URL` (default
 *     http://localhost:3000) with `TEST_AUTH_ENABLED=true` and
 *     `MAILER_MODE=smtp` pointing at smtp4dev
 *   - smtp4dev reachable at `SMTP4DEV_URL` (default http://localhost:5080)
 *   - control-plane DB at `CONTROL_PLANE_DB_URL` (for cleanup of
 *     pre-existing test rows; the test cannot guarantee a clean slate
 *     without it)
 *
 * Spec: specs/domains/tenancy/capabilities/public-signup/README.md
 */

import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const SMTP4DEV = process.env['SMTP4DEV_URL'] ?? 'http://localhost:5080';
const CP_URL = process.env['CONTROL_PLANE_DB_URL'];

// Unique per-run identifiers so reruns don't collide on the
// (email, tenantSlug) unique index in `signup_requests`.
const RUN_ID = Date.now().toString(36);
const TENANT_SLUG = `signup-itest-${RUN_ID}`;
const ORG_NAME = `Signup ITest ${RUN_ID}`;
const EMAIL = `signup-itest-${RUN_ID}@atlas.local`;

interface Smtp4DevMessage {
  id: string;
  from: string;
  to: string[];
  receivedDate: string;
  subject: string;
}

interface Smtp4DevList {
  results: Smtp4DevMessage[];
  rowCount: number;
}

async function smtp4devListMessages(): Promise<Smtp4DevMessage[]> {
  const res = await fetch(`${SMTP4DEV}/api/Messages?sortColumn=receivedDate&sortIsDescending=true`);
  if (!res.ok) throw new Error(`smtp4dev list failed: ${res.status}`);
  const body = (await res.json()) as Smtp4DevList;
  return body.results;
}

async function smtp4devGetPlainTextBody(messageId: string): Promise<string> {
  // smtp4dev exposes the parsed message at /api/Messages/{id}; the
  // plaintext part lives at /api/Messages/{id}/plaintext. The latter
  // returns the body as text/plain so we just .text() it.
  const res = await fetch(`${SMTP4DEV}/api/Messages/${messageId}/plaintext`);
  if (!res.ok) throw new Error(`smtp4dev plaintext failed: ${res.status}`);
  return res.text();
}

async function pollForMessage(
  recipient: string,
  timeoutMs = 10_000,
  intervalMs = 250,
): Promise<Smtp4DevMessage> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const messages = await smtp4devListMessages();
      const match = messages.find((m) =>
        m.to.some((t) => t.toLowerCase() === recipient.toLowerCase()),
      );
      if (match) return match;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `no message arrived for ${recipient} within ${timeoutMs}ms (last error: ${String(lastErr)})`,
  );
}

function extractMagicLink(plaintextBody: string): string {
  // The handler builds the link from `state.config.publicBaseUrl`. In
  // dev that's http://localhost:3000. Match either the default or any
  // host since the regex is anchored at /signup/confirm.
  const m = plaintextBody.match(/https?:\/\/[^\s]+\/signup\/confirm\?[^\s]+/);
  if (!m) {
    throw new Error(
      `magic-link URL not found in email body. Body was:\n${plaintextBody}`,
    );
  }
  return m[0];
}

test.describe('public signup → smtp4dev → magic link → tenant home', () => {
  let sql: postgres.Sql | null = null;

  test.beforeAll(async () => {
    // Skip silently when prerequisites aren't reachable so this test
    // can live alongside other itest specs that don't need SMTP.
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
    try {
      const ping = await fetch(`${SMTP4DEV}/api/Server`);
      if (!ping.ok) {
        test.skip(true, `smtp4dev at ${SMTP4DEV} not healthy`);
        return;
      }
    } catch {
      test.skip(true, `smtp4dev at ${SMTP4DEV} not reachable`);
      return;
    }

    if (CP_URL) {
      sql = postgres(CP_URL, { max: 2 });
      // Defensive cleanup: a previous run with the same RUN_ID is
      // impossible (Date.now() based), but if a developer sets
      // RUN_ID manually for repro, this prevents the unique index
      // from blocking submit.
      await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id = ${TENANT_SLUG}`;
      await sql`DELETE FROM control_plane.signup_requests WHERE email = ${EMAIL}`;
      await sql`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_SLUG}`;
    }

    // Clear smtp4dev's inbox so polling doesn't trip over a stale
    // message from a prior run.
    await fetch(`${SMTP4DEV}/api/Messages/*`, { method: 'DELETE' }).catch(
      () => {},
    );
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id = ${TENANT_SLUG}`;
    await sql`DELETE FROM control_plane.signup_requests WHERE email = ${EMAIL}`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_SLUG}`;
    await sql.end({ timeout: 5 });
  });

  test('signup → email visible → click link → land on tenant home', async ({
    page,
  }: {
    page: Page;
  }) => {
    // 1. Public visitor submits the signup form.
    await page.goto(`${INGRESS}/signup`);
    await page.locator('#organizationName').fill(ORG_NAME);
    await page.locator('#tenantSlug').fill(TENANT_SLUG);
    await page.locator('#email').fill(EMAIL);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#ok')).toBeVisible({ timeout: 5_000 });

    // 2. Find the signup id and approve via the admin endpoint.
    const listRes = await fetch(`${INGRESS}/api/v1/admin/signups?status=pending`, {
      headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG}` },
    });
    expect(listRes.status, await listRes.text()).toBe(200);
    const listBody = (await listRes.json()) as {
      signups: Array<{ signupId: string; email: string }>;
    };
    const signup = listBody.signups.find((s) => s.email === EMAIL);
    if (!signup) {
      throw new Error(`signup not found in admin list. Got: ${JSON.stringify(listBody)}`);
    }

    const approveRes = await fetch(
      `${INGRESS}/api/v1/admin/signups/${signup.signupId}/approve`,
      {
        method: 'POST',
        headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG}` },
      },
    );
    expect(approveRes.status, await approveRes.text()).toBe(200);
    const approveBody = (await approveRes.json()) as {
      tenantId: string;
      hostname: string;
    };
    expect(approveBody.tenantId).toBe(TENANT_SLUG);

    // 3. Wait for the magic-link email to land in smtp4dev.
    const message = await pollForMessage(EMAIL);
    expect(message.subject).toMatch(new RegExp(ORG_NAME));

    const body = await smtp4devGetPlainTextBody(message.id);
    const magicLink = extractMagicLink(body);

    // 4. Visit the magic link, click Sign in, follow the redirect to
    //    the tenant home.
    await page.goto(magicLink);
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // After clicking Sign in, the page POSTs to /signup/confirm and the
    // browser follows the 303 to <slug>.localhost:3000/. Wait for the
    // navigation to complete.
    await Promise.all([
      page.waitForURL(/^http:\/\/[^/]+\.localhost:\d+\/?/, { timeout: 10_000 }),
      page.locator('button[type="submit"]').click(),
    ]);

    // 5. Asserts on the tenant home: hostname matches our slug, and a
    //    session cookie was set.
    const url = new URL(page.url());
    expect(url.hostname).toBe(`${TENANT_SLUG}.localhost`);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => /session/i.test(c.name));
    expect(sessionCookie, `expected a session cookie. Got: ${JSON.stringify(cookies)}`).toBeTruthy();
  });
});
