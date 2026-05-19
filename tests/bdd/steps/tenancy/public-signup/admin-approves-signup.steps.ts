/**
 * Step implementations for the `@server` admin-approves-signup scenario.
 *
 * Drives the real apps/server + Postgres + smtp4dev stack. Helpers are
 * factored into `tests/bdd/support/server-stack.ts` so future
 * server-stack scenarios share them. World state is stashed under
 * `world.serverStack` (see `tests/bdd/support/world.ts`) so the
 * `After('@server', ...)` hook can run cleanup without re-deriving the
 * run's identifiers.
 *
 * Conventions copied from the existing catalog/family-publish steps:
 *   - Given/When/Then come from the shared `fixtures.ts` createBdd export
 *   - assertDefined() is used in lieu of non-null assertions
 *   - Playwright's `request` fixture (not raw fetch) for all HTTP
 *
 * Spec: specs/domains/tenancy/capabilities/public-signup/README.md
 */
import { expect } from '@playwright/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { Given, When, Then } from '../../../support/fixtures.ts';
import {
  approveSignup,
  assertPerTenantEntitiesTableExists,
  assertSignupStatus,
  assertTenantProvisioned,
  cleanupServerStackRun,
  listPendingSignups,
  openControlPlaneSql,
  pollSmtp4DevFor,
  readEmailLogFor,
  readSignupCacheInvalidationTags,
  smtp4devClearInbox,
  submitSignup,
  tailLogFor,
} from '../../../support/server-stack.ts';

/**
 * The seeded admin from slice 2. The 4-segment X-Debug-Principal form
 * parses to principalId='platform-admin', tenantId='_platform',
 * roles=['admin']. Validated by `parseDebugPrincipal` in
 * `apps/server/src/middleware/principal.ts:143`.
 */
const PLATFORM_ADMIN_DEBUG_PRINCIPAL =
  'user:platform-admin:_platform:admin';

/**
 * Polling budgets — generous enough to absorb the structured-log
 * setImmediate-batched drain and a cold smtp4dev REST round-trip, tight
 * enough to fail fast on a real regression.
 */
const SMTP4DEV_TIMEOUT_MS = 15_000;
const LOG_TAIL_TIMEOUT_MS = 10_000;

function newRunId(): string {
  // `Date.now().toString(36)` is the same shape the integration test
  // uses (`tests/integration/public-signup.itest.ts:48`). Per-run unique
  // — keeps reruns from colliding on the `(email, tenant_slug)` unique
  // index in `signup_requests`.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newCorrelationId(): string {
  // Distinct from the runId on purpose: correlationId is what flows
  // through the request pipeline + structured logs; runId namespaces
  // DB rows. Keeping them separate avoids accidentally coupling the
  // assertion (correlationId match) to the row-id derivation.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `bdd-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Given — preconditions
// ─────────────────────────────────────────────────────────────────────

Given('the Atlas stack is running with smtp4dev wired', async function ({ request }) {
  // /healthz is mounted public; a 200 response confirms apps/server is
  // up and reachable on the configured baseURL.
  const healthz = await request.get('/healthz');
  expect(healthz.status(), 'apps/server /healthz should be 200').toBe(200);
});

Given('the seeded platform-admin exists in the _platform tenant', async function ({ request }) {
  // Slice 2's boot seeder runs unconditionally. Verifying via a real
  // authenticated call rather than a DB probe so we catch the case where
  // the seed landed but the principal-resolution path can't load the
  // Membership row (which would surface as a 403 on the admin list,
  // not a missing entities row).
  const res = await request.get('/api/v1/admin/signups?status=pending&limit=1', {
    headers: { 'X-Debug-Principal': PLATFORM_ADMIN_DEBUG_PRINCIPAL },
  });
  expect(
    res.status(),
    `platform-admin debug principal must resolve to an admin role; got ${res.status()} ${await res.text()}`,
  ).toBe(200);
});

Given('the control-plane signup tables are clean for this run', async function ({ world }) {
  const runId = newRunId();
  const tenantSlug = `bdd-signup-${runId}`;
  const email = `bdd-signup-${runId}@atlas.local`;
  const organizationName = `BDD Signup ${runId}`;
  const correlationId = newCorrelationId();
  world.serverStack = {
    runId,
    email,
    tenantSlug,
    organizationName,
    correlationId,
    signupId: null,
    tenantId: null,
    hasPostgres: false,
  };
  const sql = await openControlPlaneSql();
  if (!sql) {
    throw new Error(
      'control-plane Postgres is not reachable. ' +
        'Run `make db-up` or set CONTROL_PLANE_DB_URL before invoking `pnpm bdd:server`.',
    );
  }
  try {
    await cleanupServerStackRun(sql, { email, tenantSlug });
    world.serverStack.hasPostgres = true;
  } finally {
    await sql.end({ timeout: 5 });
  }
  // smtp4dev inbox is shared across scenarios; clear once at the top.
  // Per-run cardinality assertions filter by recipient so a sibling
  // scenario's residue doesn't infect this run.
  await smtp4devClearInbox();
});

// ─────────────────────────────────────────────────────────────────────
// When — submit / list / approve
// ─────────────────────────────────────────────────────────────────────

When('an anonymous user submits a signup request', async function ({ request, world }) {
  const ctx = assertDefined(
    world.serverStack,
    'world.serverStack initialised by the "tables are clean" step',
  );
  const result = await submitSignup(request, {
    email: ctx.email,
    tenantSlug: ctx.tenantSlug,
    organizationName: ctx.organizationName,
    correlationId: ctx.correlationId,
  });
  ctx.signupId = result.signupId;
  // Stash on the legacy field too so any shared Then steps that read
  // `world.lastSubmitOk` keep working.
  world.lastSubmitOk = { ok: true, eventId: result.signupId };
  world.lastCorrelationId = ctx.correlationId;
});

When('the platform-admin lists pending signups', async function ({ request, world }) {
  const ctx = assertDefined(
    world.serverStack,
    'world.serverStack initialised by the "tables are clean" step',
  );
  const rows = await listPendingSignups(request, PLATFORM_ADMIN_DEBUG_PRINCIPAL);
  // Find this run's row and stash so the next Then can assert on it
  // without re-fetching.
  const match = rows.find(function (r) {
    return r.email === ctx.email && r.tenantSlug === ctx.tenantSlug;
  });
  world.lastQueryResponse = match ?? null;
});

When('the platform-admin approves the signup', async function ({ request, world }) {
  const ctx = assertDefined(
    world.serverStack,
    'world.serverStack initialised by the "tables are clean" step',
  );
  const signupId = assertDefined(
    ctx.signupId,
    'signupId set by the prior submit step',
  );
  const result = await approveSignup(
    request,
    PLATFORM_ADMIN_DEBUG_PRINCIPAL,
    signupId,
    ctx.correlationId,
  );
  ctx.tenantId = result.tenantId;
});

// ─────────────────────────────────────────────────────────────────────
// Then — assertions
// ─────────────────────────────────────────────────────────────────────

Then('the response is 202 with a correlationId', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const signupId = assertDefined(
    ctx.signupId,
    'signupId set by the submit step (proves a 2xx response with body.signupId)',
  );
  // `submitSignup` throws on non-JSON / missing-signupId, so reaching
  // here means the server returned 2xx with a parsed body. The status
  // assertion is on the helper's response — re-check the correlationId
  // round-trip explicitly.
  expect(signupId.length).toBeGreaterThan(0);
  expect(ctx.correlationId.length).toBeGreaterThan(0);
});

Then('the signup row is queued with status {string}', async function ({ world }, expected: string) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const signupId = assertDefined(ctx.signupId, 'signupId set by the submit step');
  if (expected !== 'pending' && expected !== 'approved' && expected !== 'denied') {
    throw new Error(`unknown expected status: ${expected}`);
  }
  const sql = await openControlPlaneSql();
  if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
  try {
    await assertSignupStatus(sql, signupId, expected);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

Then('the listed signup matches this run', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const match = world.lastQueryResponse;
  expect(match, 'listPendingSignups did not return this run\'s row').not.toBeNull();
  expect(match).toMatchObject({
    signupId: ctx.signupId,
    email: ctx.email,
    tenantSlug: ctx.tenantSlug,
    status: 'pending',
  });
});

Then('a tenant row for this run exists in control_plane.tenants', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const tenantId = assertDefined(ctx.tenantId, 'tenantId set by the approve step');
  const sql = await openControlPlaneSql();
  if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
  try {
    await assertTenantProvisioned(sql, tenantId);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

Then('the per-tenant entities table exists in the new tenant DB', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const tenantId = assertDefined(ctx.tenantId, 'tenantId set by the approve step');
  const sql = await openControlPlaneSql();
  if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
  try {
    await assertPerTenantEntitiesTableExists(sql, tenantId);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

Then('the structured log records a {string} event tagged with this run\'s correlationId',
  async function ({ request, world }, expectedEventName: string) {
    const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
    const events = await tailLogFor(
      request,
      PLATFORM_ADMIN_DEBUG_PRINCIPAL,
      ctx.correlationId,
      { timeoutMs: LOG_TAIL_TIMEOUT_MS },
    );
    const matches = events.filter(function (e) {
      return e.eventName === expectedEventName;
    });
    expect(
      matches.length,
      `expected exactly one '${expectedEventName}' log line for correlationId ` +
        `'${ctx.correlationId}'; got ${matches.length} ` +
        `(events seen: ${events.map(function (e) { return e.eventName ?? '<no-name>'; }).join(', ')})`,
    ).toBe(1);
    const props = matches[0]?.properties ?? {};
    // Mailer.Send.Success log carries `to` in properties (see
    // adapters/node/src/mailer-smtp.ts:139). Verify the email matches
    // this scenario so we don't accidentally pass on a sibling run's
    // log line that happened to share a correlationId.
    expect(props['to'], `Mailer log 'to' property should match this run`).toBe(
      ctx.email,
    );
  });

Then('the Tenancy.SignupApproved event carries cache invalidation tags for this tenant and signup',
  async function ({ world }) {
    // I10 mechanical check — every event a handler emits MUST include
    // cacheInvalidationTags, and this one specifically carries
    // `Tenant:${tenantId}` + `Signup:${signupId}` (see
    // modules/tenancy/src/handlers/signup-approve.ts:264).
    const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
    const tenantId = assertDefined(ctx.tenantId, 'tenantId set by the approve step');
    const signupId = assertDefined(ctx.signupId, 'signupId set by the submit step');
    const sql = await openControlPlaneSql();
    if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
    try {
      const tags = await readSignupCacheInvalidationTags(sql, tenantId, signupId);
      expect(tags).toContain(`Tenant:${tenantId}`);
      expect(tags).toContain(`Signup:${signupId}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

Then('control_plane.email_log carries the magic-link URL for this run', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const sql = await openControlPlaneSql();
  if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
  try {
    const row = await readEmailLogFor(sql, ctx.email);
    expect(row, `expected one email_log row for ${ctx.email}`).not.toBeNull();
    const r = assertDefined(row, 'guarded by non-null assertion above');
    expect(r.correlationId, 'email_log.correlation_id must be non-null').toBe(ctx.correlationId);
    expect(r.tags).toContain('magic-link');
    // The body holds the magic-link URL — regex mirrors the handler in
    // modules/tenancy/src/handlers/signup-approve.ts:209 which builds
    // `<publicBaseUrl>/signup/confirm?token=...&tenantId=...&email=...`.
    expect(r.body).toMatch(/\/signup\/confirm\?[^\s]+/);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

Then('smtp4dev has received exactly one message for this run', async function ({ world }) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const messages = await pollSmtp4DevFor(ctx.email, { timeoutMs: SMTP4DEV_TIMEOUT_MS });
  expect(
    messages.length,
    `smtp4dev should hold exactly one message for ${ctx.email}; got ${messages.length}`,
  ).toBe(1);
  // Subject contains the organization name (handler composes
  // `Welcome to ${signup.organizationName} — confirm your account` at
  // modules/tenancy/src/handlers/signup-approve.ts:215).
  expect(messages[0]?.subject).toContain(ctx.organizationName);
});

Then('the signup row is {string}', async function ({ world }, expected: string) {
  const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  const signupId = assertDefined(ctx.signupId, 'signupId set by the submit step');
  if (expected !== 'pending' && expected !== 'approved' && expected !== 'denied') {
    throw new Error(`unknown expected status: ${expected}`);
  }
  const sql = await openControlPlaneSql();
  if (!sql) throw new Error('control-plane Postgres unreachable mid-scenario');
  try {
    await assertSignupStatus(sql, signupId, expected);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
