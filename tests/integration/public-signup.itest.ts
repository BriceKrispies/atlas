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
 *   - `COOKIE_DOMAIN` env var set on the server (e.g. `.localhost` for
 *     dev). The magic-link redirect crosses the apex (`localhost:3000`)
 *     to the tenant subdomain (`<slug>.localhost:3000`) and the test
 *     asserts a session cookie carries across that boundary. Without
 *     `COOKIE_DOMAIN` the cookie sticks to the apex and the assertion
 *     fails with a misleading "no session cookie." Skipped in that case.
 *
 * Windows note (host resolver):
 *   On Windows, Playwright's bundled Chromium does NOT auto-resolve
 *   `*.localhost` to 127.0.0.1 — Linux glibc and macOS do, Windows does
 *   not. To make the redirect to `<slug>.localhost:3000` reach the dev
 *   server, Chromium must be launched with:
 *
 *       --host-resolver-rules="MAP *.localhost 127.0.0.1"
 *
 *   That arg belongs in `playwright.itest.config.ts`'s `launchOptions.args`
 *   (alongside any other Chromium flags). If it isn't there and you're on
 *   Windows, this test will fail with a navigation timeout on the redirect
 *   step. The fix is one line of config — not in this file because the
 *   test file owner doesn't own the config; flag it loudly to whoever
 *   investigates the timeout.
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

// Second-loop signup (idempotency replay test). Distinct slug + email so
// we don't collide with the primary loop's rows.
const RUN_ID_2 = `${RUN_ID}-replay`;
const TENANT_SLUG_2 = `signup-itest-${RUN_ID_2}`;
const ORG_NAME_2 = `Signup ITest Replay ${RUN_ID_2}`;
const EMAIL_2 = `signup-itest-${RUN_ID_2}@atlas.local`;

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

function messagesForRecipient(
  messages: readonly Smtp4DevMessage[],
  recipient: string,
): Smtp4DevMessage[] {
  const r = recipient.toLowerCase();
  return messages.filter((m) => m.to.some((t) => t.toLowerCase() === r));
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
      const match = messagesForRecipient(messages, recipient)[0];
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

    // Cookie-domain precondition. The test asserts the session cookie
    // set by POST /signup/confirm is visible to the tenant subdomain
    // after the redirect. That only works when the server attaches
    // `Domain=.localhost` (or similar) to the Set-Cookie. The server
    // reads this from `COOKIE_DOMAIN`. Without it, the cookie is
    // host-only on the apex and the subdomain sees nothing — fail
    // would be the unhelpful "no session cookie." Skip cleanly with a
    // clear message instead. We can't read the server's config
    // directly from here, so we rely on the runner to forward the same
    // env var.
    if (!process.env['COOKIE_DOMAIN']) {
      test.skip(
        true,
        'COOKIE_DOMAIN env var must be set (e.g. ".localhost" for dev) so the session cookie crosses the apex→subdomain redirect',
      );
      return;
    }

    if (CP_URL) {
      sql = postgres(CP_URL, { max: 2 });
      // Defensive cleanup: a previous run with the same RUN_ID is
      // impossible (Date.now() based), but if a developer sets
      // RUN_ID manually for repro, this prevents the unique index
      // from blocking submit.
      await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id IN (${TENANT_SLUG}, ${TENANT_SLUG_2})`;
      await sql`DELETE FROM control_plane.signup_requests WHERE email IN (${EMAIL}, ${EMAIL_2})`;
      await sql`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_SLUG}, ${TENANT_SLUG_2})`;
      await sql`DELETE FROM control_plane.email_log WHERE to_address IN (${EMAIL.toLowerCase()}, ${EMAIL_2.toLowerCase()})`;
    }

    // Clear smtp4dev's inbox so polling doesn't trip over a stale
    // message from a prior run.
    await fetch(`${SMTP4DEV}/api/Messages/*`, { method: 'DELETE' }).catch(
      () => {},
    );

    // Verify the inbox is actually empty before the test sends. If a
    // message landed between the DELETE and now (e.g. another runner),
    // we'd rather fail here than chase a phantom message later.
    const initial = await smtp4devListMessages();
    expect(
      initial.length,
      `smtp4dev inbox should be empty after cleanup; got ${initial.length} message(s). A parallel runner may be sharing this smtp4dev instance.`,
    ).toBe(0);
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id IN (${TENANT_SLUG}, ${TENANT_SLUG_2})`;
    await sql`DELETE FROM control_plane.signup_requests WHERE email IN (${EMAIL}, ${EMAIL_2})`;
    await sql`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_SLUG}, ${TENANT_SLUG_2})`;
    await sql`DELETE FROM control_plane.email_log WHERE to_address IN (${EMAIL.toLowerCase()}, ${EMAIL_2.toLowerCase()})`;
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
      headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG}:admin` },
    });
    expect(listRes.status, await listRes.text()).toBe(200);
    const listBody = (await listRes.json()) as {
      signups: Array<{ signupId: string; email: string; tenantSlug: string }>;
    };
    // Match on (email, tenantSlug). Under parallel runs of this test
    // two pending rows may share an email pattern but always differ on
    // tenantSlug — keep both predicates so we don't accidentally pick
    // the wrong row.
    const signup = listBody.signups.find(
      (s) => s.email === EMAIL && s.tenantSlug === TENANT_SLUG,
    );
    if (!signup) {
      throw new Error(`signup not found in admin list. Got: ${JSON.stringify(listBody)}`);
    }

    const approveRes = await fetch(
      `${INGRESS}/api/v1/admin/signups/${signup.signupId}/approve`,
      {
        method: 'POST',
        headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG}:admin` },
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
    // Substring match — `ORG_NAME` includes the run id, which is
    // guaranteed alphanumeric (Date.now base36) but `toContain` makes
    // the assertion robust to future ORG_NAME changes that include
    // regex-meta characters.
    expect(message.subject).toContain(ORG_NAME);

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
    // Expected cookie name today is `atlas_session` (see
    // `apps/server/src/middleware/cookie.ts:SESSION_COOKIE_NAME`). Keep
    // the regex tolerant so a future rename to e.g. `atlas_sess` or
    // `session_id` doesn't tank this test — but log the matched name in
    // the failure message so a rename surfaces visibly.
    const sessionCookie = cookies.find((c) => /session/i.test(c.name));
    expect(
      sessionCookie,
      `expected a session cookie (matching /session/i; expected name "atlas_session"). Got: ${JSON.stringify(cookies)}`,
    ).toBeTruthy();

    // 6. email_log row landed (Mailer adapter persistence — see
    //    specs/normative_requirements.md MAILER-001/002).
    if (sql) {
      const rows = await sql<
        Array<{
          message_id: string;
          to_address: string;
          correlation_id: string | null;
          tags: string[];
        }>
      >`
        SELECT message_id, to_address, correlation_id, tags
        FROM control_plane.email_log
        WHERE to_address = ${EMAIL.toLowerCase()}
      `;
      expect(rows.length, `expected exactly one email_log row for ${EMAIL}`).toBe(1);
      const row = rows[0]!;
      expect(row.correlation_id, 'email_log.correlation_id must be non-null').toBeTruthy();
      // `tags` is JSONB; postgres.js decodes JSONB to a JS value. The
      // approve handler emits `['magic-link', 'signup-approved']` (see
      // modules/tenancy/src/handlers/signup-approve.ts).
      expect(Array.isArray(row.tags), `email_log.tags should decode to an array; got ${typeof row.tags}`).toBe(true);
      expect(row.tags).toContain('magic-link');
    }
  });

  // I2 — invalid token must not produce a session cookie. No setup
  // required; the negative gate is independent of any pending signup.
  test('confirm with invalid token returns error and sets no session cookie', async () => {
    // Use any tenantId; with a bogus token, ensureTenantMigrated either
    // 404s (unknown tenant) or the handler throws INVITE_NOT_FOUND
    // (404). Both are 4xx and neither sets a cookie. A concrete tenant
    // wouldn't change the assertion; a randomized slug avoids any
    // cross-test pollution.
    const res = await fetch(`${INGRESS}/signup/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: `bogus-tenant-${RUN_ID}`,
        presentedToken: 'totally-bogus-token',
        acceptedEmail: 'foo@bar.test',
      }),
      // Redirects don't apply to a JSON 200/4xx response from this
      // route, but be explicit so a future shape change can't silently
      // chase a Location header into another origin.
      redirect: 'manual',
    });
    expect(res.status, `expected 4xx for bogus token; got ${res.status}`).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // No session cookie of any name should be set on a failed confirm.
    // `Set-Cookie` may appear multiple times — `getSetCookie` returns
    // an array (Node 20+). Fall back to the single-header lookup for
    // older runtimes that haven't picked up the spec.
    const setCookies =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (() => {
            const single = res.headers.get('set-cookie');
            return single ? [single] : [];
          })();
    const sessionCookieHeader = setCookies.find((h) => /session/i.test(h));
    expect(
      sessionCookieHeader,
      `expected NO session cookie on failed confirm; got: ${JSON.stringify(setCookies)}`,
    ).toBeFalsy();
  });

  // I3 — replaying approve must not double-send mail. Skipped pending
  // the idempotency fix from the parallel agent: the current handler
  // throws SIGNUP_NOT_PENDING (409) on the second approve, but we want
  // to assert the side-effect shape (smtp4dev count) regardless.
  // Enable once Agent B's fix lands; expected behavior is "at most 1
  // mail per signup id, ever." If the fix re-mints + revokes prior,
  // the assertion may need to flex to count <= 2 — see comment inline.
  test.skip('approve replay does not double-send mail', async () => {
    // Submit a fresh signup distinct from the primary loop's rows.
    const submitRes = await fetch(`${INGRESS}/api/v1/public/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: ORG_NAME_2,
        tenantSlug: TENANT_SLUG_2,
        email: EMAIL_2,
      }),
    });
    expect(submitRes.status, await submitRes.text()).toBeLessThan(400);

    // Locate the new signup row.
    const listRes = await fetch(`${INGRESS}/api/v1/admin/signups?status=pending`, {
      headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG_2}:admin` },
    });
    expect(listRes.status, await listRes.text()).toBe(200);
    const listBody = (await listRes.json()) as {
      signups: Array<{ signupId: string; email: string; tenantSlug: string }>;
    };
    const signup = listBody.signups.find(
      (s) => s.email === EMAIL_2 && s.tenantSlug === TENANT_SLUG_2,
    );
    if (!signup) {
      throw new Error(`replay signup not found. Got: ${JSON.stringify(listBody)}`);
    }

    // First approve — should succeed and dispatch one email.
    const first = await fetch(
      `${INGRESS}/api/v1/admin/signups/${signup.signupId}/approve`,
      {
        method: 'POST',
        headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG_2}:admin` },
      },
    );
    expect(first.status, await first.text()).toBe(200);
    await pollForMessage(EMAIL_2);

    // Second approve with the same signupId — accept either:
    //   - 200 (idempotent re-return of the same approval result), OR
    //   - 409 SIGNUP_NOT_PENDING (current handler behavior; replay is
    //     a no-op because the row already moved to `approved`).
    const second = await fetch(
      `${INGRESS}/api/v1/admin/signups/${signup.signupId}/approve`,
      {
        method: 'POST',
        headers: { 'X-Debug-Principal': `user:admin:${TENANT_SLUG_2}:admin` },
      },
    );
    expect([200, 409]).toContain(second.status);
    if (second.status === 409) {
      const body = (await second.json()) as { code?: string };
      expect(body.code).toBe('SIGNUP_NOT_PENDING');
    }

    // Side-effect assertion: exactly one mail for this recipient. If
    // Agent B's fix re-mints and revokes prior, this may need to flex
    // to `<= 2` — note that case here so the next reader doesn't have
    // to dig. The post-fix contract documented in the spec is "at
    // most 1 mail per signup," so we assert that.
    const inbox = await smtp4devListMessages();
    const forRecipient = messagesForRecipient(inbox, EMAIL_2);
    expect(
      forRecipient.length,
      `replay must not double-send; got ${forRecipient.length} messages for ${EMAIL_2}`,
    ).toBe(1);
  });
});
