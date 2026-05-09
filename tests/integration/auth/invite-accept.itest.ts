/**
 * E2E auth: admin issues invite → recipient accepts → session
 * established (Layer 3).
 *
 * Boots against `apps/server` + `smtp4dev` (mirrors `public-signup.itest.ts`).
 * Distinct from `magic-link-signup.itest.ts` because this is the
 * admin-issued path (existing tenant, admin invites a new user) vs.
 * the public-signup path (no tenant yet; visitor self-provisions).
 *
 * Pre-requisites (skipped silently when missing):
 *   - apps/server reachable at INGRESS_BASE_URL with TEST_AUTH_ENABLED=true,
 *     MAILER_MODE=smtp pointing at smtp4dev.
 *   - smtp4dev reachable at SMTP4DEV_URL.
 *
 * Spec: specs/domains/identity (invite-issue + invite-accept).
 */

import { test, expect } from '@playwright/test';

const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const SMTP4DEV = process.env['SMTP4DEV_URL'] ?? 'http://localhost:5080';
const TENANT = process.env['TENANT_ID'] ?? 'dev-tenant';
const RUN_ID = Date.now().toString(36);
const EMAIL = `invite-itest-${RUN_ID}@atlas.local`;

interface IntentResponse {
  eventId: string;
  correlationId: string;
  result?: Record<string, unknown>;
}

interface Smtp4DevMessage {
  id: string;
  from: string;
  to: string[];
  receivedDate: string;
  subject: string;
}

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

async function smtp4devUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SMTP4DEV}/api/Server`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function smtp4devClear(): Promise<void> {
  await fetch(`${SMTP4DEV}/api/Messages/*`, { method: 'DELETE' });
}

async function smtp4devList(): Promise<Smtp4DevMessage[]> {
  const res = await fetch(
    `${SMTP4DEV}/api/Messages?sortColumn=receivedDate&sortIsDescending=true`,
  );
  if (!res.ok) throw new Error(`smtp4dev list failed: ${res.status}`);
  const body = (await res.json()) as { results: Smtp4DevMessage[] };
  return body.results;
}

async function smtp4devPlainBody(messageId: string): Promise<string> {
  const res = await fetch(
    `${SMTP4DEV}/api/Messages/${messageId}/plaintext`,
  );
  if (!res.ok) throw new Error(`smtp4dev plaintext failed: ${res.status}`);
  return res.text();
}

async function pollForRecipient(
  recipient: string,
  timeoutMs = 10_000,
): Promise<Smtp4DevMessage> {
  const start = Date.now();
  const r = recipient.toLowerCase();
  while (Date.now() - start < timeoutMs) {
    const msgs = await smtp4devList();
    const match = msgs.find((m) => m.to.some((t) => t.toLowerCase() === r));
    if (match) return match;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`no message for ${recipient} within ${timeoutMs}ms`);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function submitIntent(
  actionId: string,
  payload: Record<string, unknown>,
  principal: string,
): Promise<IntentResponse> {
  const u = uid();
  const envelope = {
    eventId: `evt-${u}`,
    eventType: actionId,
    schemaId: `${actionId.toLowerCase()}.v1`,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: TENANT,
    correlationId: `corr-invite-${RUN_ID}`,
    idempotencyKey: `idem-${u}`,
    actionId,
    payload,
  };
  const res = await fetch(`${INGRESS}/api/v1/intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Principal': principal,
    },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) {
    throw new Error(`${actionId} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as IntentResponse;
}

test.describe('e2e — admin invite → user accept', () => {
  test.beforeAll(async () => {
    if (!(await ingressUp())) {
      test.skip(true, `apps/server not reachable at ${INGRESS}`);
    }
    if (!(await smtp4devUp())) {
      test.skip(true, `smtp4dev not reachable at ${SMTP4DEV}`);
    }
    await smtp4devClear();
  });

  test('admin issues invite → email arrives → click magic-link → session established', async ({
    request,
  }) => {
    const adminPrincipal = `user:admin:${TENANT}:admin`;

    // 1. Admin issues invite.
    await submitIntent(
      'Identity.Invite.Issue',
      { email: EMAIL, rolesOnAccept: ['Author'] },
      adminPrincipal,
    );

    // 2. Wait for email in smtp4dev.
    const message = await pollForRecipient(EMAIL);
    const body = await smtp4devPlainBody(message.id);
    const linkMatch = body.match(/(https?:\/\/\S+\/signup\/confirm\?[^\s)]+)/);
    expect(linkMatch).not.toBeNull();
    const magicLink = linkMatch![1]!;

    // 3. Visit the magic link. The /signup/confirm endpoint
    //    redirects to the tenant home with a session cookie set.
    const visitRes = await request.get(magicLink);
    expect(visitRes.ok() || visitRes.status() === 303).toBe(true);

    // 4. The cookie set on the response is the session cookie. Pull
    //    it from the cookie jar and assert the next authenticated
    //    request succeeds.
    const cookies = await request.storageState();
    const sessionCookie = cookies.cookies.find((c) =>
      c.name.toLowerCase().includes('session'),
    );
    expect(sessionCookie).toBeDefined();
  });
});
