/**
 * Shared helpers for `@server`-tagged BDD scenarios that drive the real
 * `apps/server` + Postgres + smtp4dev stack instead of the IDB sim.
 *
 * Three concerns, one module:
 *
 *   1. HTTP wrappers around the public-signup + admin-signups routes,
 *      using the Playwright `request` fixture so cookies / proxy / retry
 *      / timing are uniform with the rest of the BDD suite.
 *   2. smtp4dev REST polling (lifted from
 *      `tests/integration/public-signup.itest.ts` lines 58–110 with the
 *      contract narrowed to what the BDD steps actually need).
 *   3. Postgres helpers for both per-run cleanup and the structural
 *      assertions ("tenant row exists", "per-tenant entities table is
 *      reachable", "signup row is approved").
 *   4. A log-tail helper that reads the in-memory ring buffer via the
 *      admin-logging route (`/api/v1/admin/logging/correlation/:id/recent`)
 *      so steps can assert on structured log events without scraping
 *      stdout. Option B in the slice 4 brief.
 *
 * The shapes are deliberately narrow — every interface returns the
 * minimum the steps consume. Add fields lazily; don't speculatively
 * mirror the full upstream payload.
 *
 * Spec: specs/domains/tenancy/capabilities/public-signup/README.md
 */
import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';

const SMTP4DEV_BASE_URL =
  process.env['SMTP4DEV_URL'] ?? 'http://localhost:5080';

const CONTROL_PLANE_DB_URL_DEFAULT =
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const ADMIN_LOGIN_BASE = '/api/v1/admin/logging';

// ─────────────────────────────────────────────────────────────────────
// HTTP helpers — public + admin signup endpoints
// ─────────────────────────────────────────────────────────────────────

export interface SubmitSignupArgs {
  email: string;
  tenantSlug: string;
  organizationName: string;
  /**
   * Forwarded as `X-Correlation-Id` so downstream assertions can pin
   * the structured-log line and email_log row by id.
   */
  correlationId: string;
}

export interface SubmitSignupResult {
  ok: boolean;
  status: number;
  signupId: string;
  /**
   * The id the harness pinned via `X-Correlation-Id`. The server honours
   * the inbound header (`apps/server/src/middleware/correlation.ts`), so
   * echoing it back keeps the World object's `correlationId` and the
   * server's view in lockstep.
   */
  correlationId: string;
}

/**
 * Submit a public signup. Returns 202 on success (per
 * `apps/server/src/routes/signup.ts`). Throws if the call body shape
 * deviates from the contract — the steps treat the result as
 * authoritative so a soft-error here would hide regressions.
 */
export async function submitSignup(
  request: APIRequestContext,
  args: SubmitSignupArgs,
): Promise<SubmitSignupResult> {
  const res = await request.post('/api/v1/signup', {
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': args.correlationId,
    },
    data: {
      email: args.email,
      tenantSlug: args.tenantSlug,
      organizationName: args.organizationName,
    },
  });
  const status = res.status();
  const bodyText = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `submitSignup: expected JSON response, got ${status} ${bodyText}`,
    );
  }
  if (!isRecord(body)) {
    throw new Error(
      `submitSignup: expected object body, got ${typeof body}: ${bodyText}`,
    );
  }
  const signupId = body['signupId'];
  if (typeof signupId !== 'string' || signupId.length === 0) {
    throw new Error(`submitSignup: missing signupId in body: ${bodyText}`);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    signupId,
    correlationId: args.correlationId,
  };
}

export interface SignupRow {
  signupId: string;
  email: string;
  tenantSlug: string;
  status: 'pending' | 'approved' | 'denied';
}

/**
 * List pending signups. `principal` is the `X-Debug-Principal` value —
 * pass the seeded admin (`user:platform-admin:_platform:admin`) for the
 * server-stack scenarios.
 */
export async function listPendingSignups(
  request: APIRequestContext,
  principal: string,
): Promise<SignupRow[]> {
  const res = await request.get('/api/v1/admin/signups?status=pending', {
    headers: { 'X-Debug-Principal': principal },
  });
  const status = res.status();
  const bodyText = await res.text();
  if (status !== 200) {
    throw new Error(
      `listPendingSignups: expected 200, got ${status} ${bodyText}`,
    );
  }
  const body: unknown = JSON.parse(bodyText);
  if (!isRecord(body) || !Array.isArray(body['signups'])) {
    throw new Error(
      `listPendingSignups: malformed body (expected { signups: [...] }): ${bodyText}`,
    );
  }
  return body['signups'].map(rowToSignupRow);
}

export interface ApproveResult {
  tenantId: string;
  hostname: string;
  status: SignupRow['status'];
}

export async function approveSignup(
  request: APIRequestContext,
  principal: string,
  signupId: string,
  correlationId: string,
): Promise<ApproveResult> {
  const res = await request.post(
    `/api/v1/admin/signups/${encodeURIComponent(signupId)}/approve`,
    {
      headers: {
        'X-Debug-Principal': principal,
        'X-Correlation-Id': correlationId,
      },
    },
  );
  const status = res.status();
  const bodyText = await res.text();
  if (status !== 200) {
    throw new Error(
      `approveSignup: expected 200, got ${status} ${bodyText}`,
    );
  }
  const body: unknown = JSON.parse(bodyText);
  if (
    !isRecord(body) ||
    typeof body['tenantId'] !== 'string' ||
    typeof body['hostname'] !== 'string' ||
    typeof body['status'] !== 'string'
  ) {
    throw new Error(`approveSignup: malformed body: ${bodyText}`);
  }
  const stStr = body['status'];
  if (stStr !== 'pending' && stStr !== 'approved' && stStr !== 'denied') {
    throw new Error(`approveSignup: unknown status '${stStr}' in body`);
  }
  return {
    tenantId: body['tenantId'],
    hostname: body['hostname'],
    status: stStr,
  };
}

// ─────────────────────────────────────────────────────────────────────
// smtp4dev — REST polling
// ─────────────────────────────────────────────────────────────────────

export interface Smtp4DevMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedDate: string;
}

interface Smtp4DevList {
  results: Smtp4DevMessage[];
  rowCount: number;
}

async function smtp4devListMessages(): Promise<Smtp4DevMessage[]> {
  const res = await fetch(
    `${SMTP4DEV_BASE_URL}/api/Messages?sortColumn=receivedDate&sortIsDescending=true`,
  );
  if (!res.ok) {
    throw new Error(`smtp4dev list failed: ${res.status}`);
  }
  const raw: unknown = await res.json();
  if (!isRecord(raw) || !Array.isArray(raw['results'])) {
    throw new Error(
      `smtp4dev list returned unexpected shape: ${JSON.stringify(raw)}`,
    );
  }
  // The contract is "rows of { id, from, to, subject, receivedDate }"; the
  // helpers downstream consume only those fields. Narrow loosely — a
  // future smtp4dev release adding fields is fine.
  return raw['results'].filter(isSmtp4DevMessage);
}

function messagesForRecipient(
  messages: readonly Smtp4DevMessage[],
  recipient: string,
): Smtp4DevMessage[] {
  const r = recipient.toLowerCase();
  return messages.filter(function (m) {
    return m.to.some(function (t) {
      return t.toLowerCase() === r;
    });
  });
}

/**
 * Poll smtp4dev's REST API for messages addressed to `recipient`. Returns
 * the FULL set when at least one match is found — callers assert on
 * `.length === 1` for the "exactly one email" contract.
 *
 * Why "all matching" instead of "first match": the BDD step asserts
 * cardinality (exactly one message). Returning just the first would
 * silently mask a double-send regression.
 */
export async function pollSmtp4DevFor(
  recipient: string,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<Smtp4DevMessage[]> {
  const interval = opts.intervalMs ?? 250;
  const deadline = Date.now() + opts.timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const all = await smtp4devListMessages();
      const matches = messagesForRecipient(all, recipient);
      if (matches.length > 0) return matches;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(
    `no message arrived for ${recipient} within ${opts.timeoutMs}ms ` +
      `(last error: ${String(lastErr)})`,
  );
}

/**
 * Best-effort inbox wipe. The DELETE /api/Messages/* endpoint matches
 * the integration test (`tests/integration/public-signup.itest.ts:176`).
 * Wrapped in `catch` because a missing smtp4dev is the caller's
 * problem to surface, not this helper's.
 */
export async function smtp4devClearInbox(): Promise<void> {
  try {
    await fetch(`${SMTP4DEV_BASE_URL}/api/Messages/*`, { method: 'DELETE' });
  } catch {
    // ignored — best effort
  }
}

// ─────────────────────────────────────────────────────────────────────
// Postgres — control_plane queries + per-tenant entity probe
// ─────────────────────────────────────────────────────────────────────

/**
 * Open a control-plane Postgres client honouring `CONTROL_PLANE_DB_URL`.
 * Returns `null` when no URL is configured AND the default localhost
 * URL isn't reachable, so a misconfigured runner skips clean instead
 * of misleadingly failing the assertion.
 *
 * Callers MUST call `sql.end()` when done; the `After('@server', …)`
 * hook in `hooks.ts` handles the per-scenario lifecycle.
 */
export async function openControlPlaneSql(): Promise<postgres.Sql | null> {
  const url =
    process.env['CONTROL_PLANE_DB_URL'] ?? CONTROL_PLANE_DB_URL_DEFAULT;
  const sql = postgres(url, { max: 2 });
  try {
    await sql`SELECT 1`;
    return sql;
  } catch {
    await sql.end({ timeout: 1 }).catch(function () {
      return undefined;
    });
    return null;
  }
}

export interface EmailLogRow {
  messageId: string;
  toAddress: string;
  subject: string;
  body: string;
  correlationId: string | null;
  tags: readonly string[];
}

/**
 * Read the single email_log row this scenario produced. Returns `null`
 * when no row exists yet (caller decides whether to retry or fail).
 *
 * Filtered by `to_address` (lower-cased to match the column's storage
 * shape — see `adapters/node/src/mailer-smtp.ts:108`). Per-run unique
 * emails make this a 1:1 lookup; we still ORDER BY sent_at DESC LIMIT 1
 * defensively in case a future cleanup gap leaves stale rows.
 */
export async function readEmailLogFor(
  sql: postgres.Sql,
  email: string,
): Promise<EmailLogRow | null> {
  const rows = await sql<
    Array<{
      message_id: string;
      to_address: string;
      subject: string;
      body: string;
      correlation_id: string | null;
      tags: string[] | null;
    }>
  >`
    SELECT message_id, to_address, subject, body, correlation_id, tags
    FROM control_plane.email_log
    WHERE to_address = ${email.toLowerCase()}
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    messageId: row.message_id,
    toAddress: row.to_address,
    subject: row.subject,
    body: row.body,
    correlationId: row.correlation_id,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

/**
 * Assert the post-approval `control_plane.tenants` row exists. Throws
 * on absence; returns silently on success. Caller wraps in a Playwright
 * `expect(async () => …).not.toThrow()` if it wants a softer assertion.
 */
export async function assertTenantProvisioned(
  sql: postgres.Sql,
  tenantId: string,
): Promise<void> {
  const rows = await sql<Array<{ tenant_id: string; status: string }>>`
    SELECT tenant_id, status
    FROM control_plane.tenants
    WHERE tenant_id = ${tenantId}
  `;
  if (rows.length === 0) {
    throw new Error(`tenant '${tenantId}' missing from control_plane.tenants`);
  }
}

/**
 * Verify the new tenant's per-tenant `entities` table is reachable. In
 * dev mode tenants share the control-plane DB (per
 * `tenant-db-provider.ts` fallback) so this is effectively "the
 * `entities` substrate table exists and the tenantId scope can be
 * filtered" — which is what `ensureTenantMigrated` guarantees once
 * approve has run.
 *
 * The assertion runs a COUNT(*) filtered by `tenant_id`; an unmigrated
 * tenant either has no table (relation not found) or a freshly migrated
 * one with 0 rows. Either way the query returning normally is the
 * "table exists" signal we need.
 */
export async function assertPerTenantEntitiesTableExists(
  sql: postgres.Sql,
  tenantId: string,
): Promise<void> {
  // postgres.js throws on a missing relation; let it propagate.
  const rows = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM entities
    WHERE tenant_id = ${tenantId}
  `;
  // `rows` is always length 1 for a COUNT(*) — guard anyway.
  if (rows.length === 0) {
    throw new Error(
      `entities table query returned no rows for tenant '${tenantId}'`,
    );
  }
}

export async function assertSignupStatus(
  sql: postgres.Sql,
  signupId: string,
  expected: 'pending' | 'approved' | 'denied',
): Promise<void> {
  const rows = await sql<Array<{ status: string }>>`
    SELECT status
    FROM control_plane.signup_requests
    WHERE signup_id = ${signupId}
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`signup '${signupId}' missing from signup_requests`);
  }
  if (row.status !== expected) {
    throw new Error(
      `signup '${signupId}' status is '${row.status}', expected '${expected}'`,
    );
  }
}

/**
 * Open a `postgres.Sql` connection to a tenant's per-tenant database.
 *
 * Reads the tenant's `db_*` columns from `control_plane.tenants` and
 * opens a fresh pool. Callers MUST `await pool.end()` when done — this
 * helper does not pool internally because BDD assertions tend to read
 * once per step and the connection cost is dwarfed by the test
 * runtime.
 *
 * Required after the ADR 0005 db-per-tenant move: tenant events live
 * in the per-tenant `events` table, not `control_plane.events`. Tests
 * that assert on event-store state MUST open the per-tenant sql via
 * this helper rather than reusing the control-plane connection.
 */
export async function openTenantSql(
  controlPlaneSql: postgres.Sql,
  tenantId: string,
): Promise<postgres.Sql> {
  const rows = await controlPlaneSql<
    Array<{
      db_host: string | null;
      db_port: number | null;
      db_user: string | null;
      db_password: string | null;
      db_name: string | null;
    }>
  >`
    SELECT db_host, db_port, db_user, db_password, db_name
    FROM control_plane.tenants
    WHERE tenant_id = ${tenantId}
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`openTenantSql: tenant '${tenantId}' not found in control_plane.tenants`);
  }
  if (
    row.db_host === null ||
    row.db_port === null ||
    row.db_user === null ||
    row.db_password === null ||
    row.db_name === null
  ) {
    throw new Error(
      `openTenantSql: tenant '${tenantId}' has NULL db_* columns — provisioning hasn't run`,
    );
  }
  return postgres({
    host: row.db_host,
    port: row.db_port,
    user: row.db_user,
    password: row.db_password,
    database: row.db_name,
    max: 1,
  });
}

export async function readSignupCacheInvalidationTags(
  controlPlaneSql: postgres.Sql,
  tenantId: string,
  signupId: string,
): Promise<string[]> {
  // The `Tenancy.SignupApproved` event lives in the per-tenant events
  // table (ADR 0005 db-per-tenant) — not in `control_plane.events`,
  // which holds only the legacy pre-db-per-tenant audit rows. Open a
  // tenant-scoped pool to read it.
  const tenantSql = await openTenantSql(controlPlaneSql, tenantId);
  try {
    const rows = await tenantSql<Array<{ cache_invalidation_tags: string[] | null }>>`
      SELECT cache_invalidation_tags
      FROM events
      WHERE tenant_id = ${tenantId}
        AND event_type = 'Tenancy.SignupApproved'
        AND idempotency_key = ${`tenancy.signup.approve.${signupId}`}
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(
        `Tenancy.SignupApproved event not found in per-tenant DB for tenant '${tenantId}' signup '${signupId}'`,
      );
    }
    return row.cache_invalidation_tags ?? [];
  } finally {
    await tenantSql.end({ timeout: 1 });
  }
}

/**
 * Generic version of the cache-tag reader for any event the tenant
 * appended. Per sdet verdict #7 — refactor of the signup-specific
 * helper. Returns the latest event matching the (tenant, type[, key])
 * triple.
 */
export async function readEventCacheInvalidationTags(
  sql: postgres.Sql,
  tenantId: string,
  eventType: string,
  idempotencyKey: string | null,
): Promise<string[]> {
  if (idempotencyKey !== null) {
    const rows = await sql<Array<{ cache_invalidation_tags: string[] | null }>>`
      SELECT cache_invalidation_tags
      FROM events
      WHERE tenant_id = ${tenantId}
        AND event_type = ${eventType}
        AND idempotency_key = ${idempotencyKey}
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(
        `event ${eventType} (key=${idempotencyKey}) not found for tenant '${tenantId}'`,
      );
    }
    return row.cache_invalidation_tags ?? [];
  }
  const rows = await sql<Array<{ cache_invalidation_tags: string[] | null }>>`
    SELECT cache_invalidation_tags
    FROM events
    WHERE tenant_id = ${tenantId}
      AND event_type = ${eventType}
    ORDER BY occurred_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(
      `event ${eventType} not found for tenant '${tenantId}'`,
    );
  }
  return row.cache_invalidation_tags ?? [];
}

/**
 * Count events of a given type for a tenant. Used by the I2 negative
 * step — assert 0 events were emitted for a deny path.
 */
export async function countEventsOfType(
  sql: postgres.Sql,
  tenantId: string,
  eventType: string,
): Promise<number> {
  const rows = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM events
    WHERE tenant_id = ${tenantId}
      AND event_type = ${eventType}
  `;
  const row = rows[0];
  return row ? Number(row.count) : 0;
}

/**
 * Read the apps/server bootId from `/readyz`. The endpoint surfaces
 * `bootId` (uuid stamped in bootstrap.ts) + `startedAt` so harnesses
 * can mechanically assert I20 zero-restart.
 */
export async function readBootId(
  request: APIRequestContext,
): Promise<string> {
  const res = await request.get('/readyz');
  const bodyText = await res.text();
  const status = res.status();
  if (status !== 200 && status !== 503) {
    throw new Error(`readBootId: /readyz returned ${status}: ${bodyText}`);
  }
  const body: unknown = JSON.parse(bodyText);
  if (!isRecord(body)) {
    throw new Error(`readBootId: /readyz returned non-object: ${bodyText}`);
  }
  const bootId = body['bootId'];
  if (typeof bootId !== 'string' || bootId.length === 0) {
    throw new Error(`readBootId: bootId missing in /readyz body: ${bodyText}`);
  }
  return bootId;
}

/**
 * Cleanup helper for the identity / tenant-admin-invites-user run.
 * Deletes the seeded tenant-admin + invitee rows so reruns don't trip
 * unique indexes. Tenant `acme` is left in place across runs — it's a
 * stable BDD fixture.
 */
export async function cleanupInviteRun(
  sql: postgres.Sql,
  args: { tenantId: string; adminEmail: string; inviteeEmail: string },
): Promise<void> {
  const adminEmail = args.adminEmail.toLowerCase();
  const inviteeEmail = args.inviteeEmail.toLowerCase();
  await sql`DELETE FROM control_plane.email_log WHERE to_address IN (${adminEmail}, ${inviteeEmail})`;
  // Per-tenant rows live in `entities` (db-per-tenant fallback uses
  // shared control plane in dev). Scope deletes by tenant_id so other
  // tenants' rows stay intact.
  try {
    await sql`DELETE FROM events WHERE tenant_id = ${args.tenantId} AND event_type IN (
      'Identity.InviteIssued',
      'Identity.InviteAccepted',
      'Identity.UserCreated',
      'Identity.MembershipCreated',
      'Identity.UserPasswordSet',
      'Identity.PasswordLoginSucceeded',
      'Identity.AuthSessionIssued'
    )`;
  } catch {
    // best-effort
  }
  try {
    await sql`DELETE FROM entities WHERE tenant_id = ${args.tenantId} AND entity_type IN ('User', 'Membership', 'InviteToken', 'AuthSession')`;
  } catch {
    // best-effort
  }
}

/**
 * Idempotent per-run cleanup. Mirrors the DELETE block in
 * `tests/integration/public-signup.itest.ts:169-172` so reruns don't
 * trip the unique index on `(email, tenant_slug)`.
 *
 * Order matters: `custom_domains` references `tenants` via tenant_id;
 * `email_log` is independent.
 */
export async function cleanupServerStackRun(
  sql: postgres.Sql,
  args: { email: string; tenantSlug: string },
): Promise<void> {
  const email = args.email.toLowerCase();
  await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id = ${args.tenantSlug}`;
  await sql`DELETE FROM control_plane.signup_requests WHERE email = ${args.email}`;
  await sql`DELETE FROM control_plane.tenants WHERE tenant_id = ${args.tenantSlug}`;
  await sql`DELETE FROM control_plane.email_log WHERE to_address = ${email}`;
}

// ─────────────────────────────────────────────────────────────────────
// Log tail — Option B (in-memory ring buffer over the admin endpoint)
// ─────────────────────────────────────────────────────────────────────

/**
 * Loosely-typed mirror of `LogEvent` (see
 * `packages/platform-core/src/log-event.ts`). The admin endpoint returns
 * events as-is; only the fields the BDD steps actually assert on are
 * named here. Everything else is opaque via `properties`.
 */
export interface LogLine {
  timestamp: string;
  level: string;
  message: string;
  eventName?: string;
  correlationId?: string;
  tenantId?: string;
  properties?: Record<string, unknown>;
}

interface RecentLogsResponse {
  correlationId: string;
  count: number;
  events: LogLine[];
}

/**
 * Poll `/api/v1/admin/logging/correlation/:correlationId/recent` until
 * one or more events show up for the given correlationId, or the
 * timeout fires.
 *
 * Why poll: the structured-log pipeline drains in setImmediate-batched
 * chunks (see `packages/logging/src/pipeline.ts`), so an event emitted
 * inside the approve handler is not synchronously visible — a 50ms
 * gap between approve-returns and ring-buffer-has-the-line is normal.
 *
 * Requires the principal to have the `admin` role. Pass the same
 * seeded `user:platform-admin:_platform:admin` value the rest of the
 * scenario uses.
 */
export async function tailLogFor(
  request: APIRequestContext,
  principal: string,
  correlationId: string,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<LogLine[]> {
  const interval = opts.intervalMs ?? 100;
  const deadline = Date.now() + opts.timeoutMs;
  let lastBodyText = '';
  while (Date.now() < deadline) {
    const res = await request.get(
      `${ADMIN_LOGIN_BASE}/correlation/${encodeURIComponent(correlationId)}/recent?limit=500`,
      { headers: { 'X-Debug-Principal': principal } },
    );
    const status = res.status();
    lastBodyText = await res.text();
    if (status === 200) {
      const raw: unknown = JSON.parse(lastBodyText);
      if (!isRecord(raw) || !Array.isArray(raw['events'])) {
        throw new Error(
          `tailLogFor: malformed body (expected { events: [...] }): ${lastBodyText}`,
        );
      }
      const events = raw['events'].filter(isLogLine);
      if (events.length > 0) return events;
    } else if (status !== 200) {
      // Surface auth / 4xx failures immediately — retrying won't help.
      throw new Error(
        `tailLogFor: GET ring buffer returned ${status} ${lastBodyText}`,
      );
    }
    await sleep(interval);
  }
  throw new Error(
    `tailLogFor: no log events for correlationId '${correlationId}' ` +
      `within ${opts.timeoutMs}ms (last body: ${lastBodyText})`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSmtp4DevMessage(v: unknown): v is Smtp4DevMessage {
  if (!isRecord(v)) return false;
  if (typeof v['id'] !== 'string') return false;
  if (typeof v['from'] !== 'string') return false;
  if (typeof v['subject'] !== 'string') return false;
  if (typeof v['receivedDate'] !== 'string') return false;
  const to = v['to'];
  if (!Array.isArray(to)) return false;
  for (const t of to) {
    if (typeof t !== 'string') return false;
  }
  return true;
}

/**
 * Narrow a LogLine against the admin-logging endpoint's wire shape. Only
 * required fields are checked; `eventName`, `correlationId`, etc. are
 * optional on `LogEvent` (see `packages/platform-core/src/log-event.ts`).
 */
function isLogLine(v: unknown): v is LogLine {
  if (!isRecord(v)) return false;
  if (typeof v['timestamp'] !== 'string') return false;
  if (typeof v['level'] !== 'string') return false;
  if (typeof v['message'] !== 'string') return false;
  return true;
}

function rowToSignupRow(raw: unknown): SignupRow {
  if (!isRecord(raw)) {
    throw new Error(`signup row is not an object: ${JSON.stringify(raw)}`);
  }
  const signupId = raw['signupId'];
  const email = raw['email'];
  const tenantSlug = raw['tenantSlug'];
  const status = raw['status'];
  if (
    typeof signupId !== 'string' ||
    typeof email !== 'string' ||
    typeof tenantSlug !== 'string' ||
    (status !== 'pending' && status !== 'approved' && status !== 'denied')
  ) {
    throw new Error(
      `signup row missing required fields: ${JSON.stringify(raw)}`,
    );
  }
  return { signupId, email, tenantSlug, status };
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
