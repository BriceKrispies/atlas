# Capability: Public Signup

**Capability:** public-signup
**Domain:** tenancy
**Status:** **Active (with known debt).** The signup → approval →
magic-link → login loop is wired end-to-end against the `Mailer` port,
the `SmtpMailer` adapter ships, smtp4dev runs in dev compose, and a
Playwright integration test drives the whole loop against the real
`apps/server`. Several deferrals remain — see [Known Debt](#known-debt).

## Purpose

A prospective tenant visits `/signup`, submits an organization name +
slug + email, and receives a magic-link email after an admin approves
the request. Clicking the link signs them in and lands them on
`<slug>.<apex>` — the tenant's home. The whole loop is exercisable
locally with no real SMTP provider: `smtp4dev` runs in a container,
the server posts to it on `localhost:1025`, and the email is browsable
at `http://localhost:5080`.

This is the **first thin vertical** of the Phase 1 MVP from
`specs/vision.md`. Subsequent slices add the tenant dashboard, code
upload, workflow runs, and real compute deploy.

## Invariants Touched

- **I1** — every endpoint in the flow (`/signup`, `/api/v1/signup`,
  `/api/v1/admin/signups/:id/approve`, `/signup/confirm`) is on
  `apps/server`. No other app exposes HTTP. Already satisfied.
- **I2** — the public `/signup` and `/signup/confirm` POSTs run
  *before* there's a session, so authz against the tenant is meaningless;
  the magic-link token IS the auth on confirm. Admin approve runs in the
  authed group via `principalMiddleware`, and `requireAdmin` now enforces
  an explicit `admin` role *even under* `TEST_AUTH_ENABLED=true` (the
  prior unconditional bypass was closed in this slice). An I2 negative
  test in the integration suite asserts a non-admin principal is rejected
  with 403 before any handler side effects fire.
- **I3** — `handleSignupApprove` is idempotent at every step
  (tenant.create existence-check, customDomains.add unique-index
  tolerance, mark-approved last). On a retry after a crash on
  mailer-send, the previous magic-link token is **revoked before a
  fresh one is minted**, then re-mailed. (Full revoke wiring is debt:
  the route currently passes a no-op `revokeOutstandingInvites`
  callback because the identity module does not yet expose an
  `Identity.Invite.Revoke` handler — see [Known Debt](#known-debt)
  item (a). The handler-level contract is correct; the implementation
  is the gap.)
- **I5** — `correlationId` flows from `correlationIdFor(c)` →
  `handleSignupSubmit` → `handleSignupApprove` → `issueInvite` →
  `mailer.send`. The SMTP adapter persists `correlation_id` to
  `control_plane.email_log` (parity with `StdoutEventMailer`) and
  forwards it as `X-Atlas-Correlation-Id` SMTP header.
- **I7** — tenant resolution by Host header is inherited from the
  custom-domains capability. The magic-link URL resolves to the
  tenant's primary host and the tenant-resolution middleware maps it
  back to `tenantId` before the confirm POST runs.
- **I9** — no new cache keys.
- **I10** — `Tenancy.SignupApproved` carries
  `cacheInvalidationTags: ['Tenant:${tenantId}', 'Signup:${signupId}']`.
  Existing `Identity.InviteIssued` / `Identity.InviteAccepted` tags are
  unchanged.
- **I12** — the new `Tenancy.SignupApproved` audit event is appended
  to the per-tenant event store via the `appendEvent` callback in the
  handler deps. It is a real `EventEnvelope` with idempotency key
  `tenancy.signup.approve.${signupId}` and an empty payload (no
  magic-link plaintext: secrets stay out of event history).
  Projections built on top of this stream are rebuildable from event
  history alone.

## Lexicon

Reuses `SignupRequest`, `MagicLink`, `InviteToken`, `Mailer`
(all four added to [`specs/LEXICON.md`](../../../../LEXICON.md) as
part of this slice). Verbs: `approveSignup`, `issueInvite`.

## Surfaces

What this capability changes, by surface:

- **Handlers** — `handleSignupSubmit`, `handleInviteAccept`,
  `handleInviteIssue` reused unchanged. **CHANGED** —
  `handleSignupApprove` deps gained two new callbacks:
  `revokeOutstandingInvites(tenantId, email)` (called before re-minting
  on retry) and `appendEvent(envelope)` (called after `markApproved` to
  emit `Tenancy.SignupApproved`).
- **Events emitted** — **NEW** `Tenancy.SignupApproved`. Real
  `EventEnvelope`. `cacheInvalidationTags: ['Tenant:${tenantId}',
  'Signup:${signupId}']`. Idempotency key
  `tenancy.signup.approve.${signupId}`. Payload contains no secrets
  (no token plaintext). `Identity.InviteIssued` and
  `Identity.InviteAccepted` already exist and are unchanged.
- **Projections / Queries** — none new.
- **Ports** — **CHANGED** `Mailer` (`ports/src/mailer.ts`) gained an
  optional `close?(): Promise<void>` hook so adapters with pooled
  connections can drain on server shutdown. Existing single-method
  adapters remain compatible.
- **Adapters** — **NEW** `adapters/node/src/mailer-smtp.ts` —
  `SmtpMailer implements Mailer` (mirrors `StdoutEventMailer`'s
  `control_plane.email_log` insert) plus a `close()` implementation
  that drains the SMTP connection pool. Bootstrap-confined: ESLint
  guard restricts `nodemailer` imports to adapter-node.
- **Routes** — **CHANGED** `POST /signup/confirm` now returns
  `200` with body `{ redirect: string }` rather than `303` with
  `Location:` (browsers were re-issuing the body POST against the
  redirect target on some flows). Client-side JS handles both
  shapes for back-compat, but the server is on the 200 path. A11y
  improvements landed alongside: `<label for>` / `<input id>` pairs,
  `role="alert" aria-live` on the error region, 44 px minimum touch
  targets, hover styles gated by `@media (hover: hover)`. All other
  routes (`/signup`, `/api/v1/signup`,
  `/api/v1/admin/signups/:id/approve`) unchanged in surface, only
  internals.
- **Admin route hardening** — `requireAdmin`
  (`apps/server/src/routes/admin-signups.ts`) no longer
  short-circuits on `TEST_AUTH_ENABLED=true`; the principal must
  carry `'admin'` in `roles`. `parseDebugPrincipal` now accepts a
  4-segment form `user:<id>:<tenantId>:<comma,separated,roles>` so
  dev workflows can mint admin principals via `X-Debug-Principal`.
- **Worker chain** — **NEW** `identityDispatcher` is now in
  `apps/projection-worker/src/tenant-loop.ts`'s dispatcher chain so
  invite events projected by the worker observe the same identity
  state as the in-process server. Two parity gaps remain (debt):
  `policyCacheDispatcher` and `serverEventDispatcher`.
- **UI surfaces** — none new. The existing inline HTML pages stay
  (per slice-1 scoping decision; SPA replacement is a future slice).
- **Migrations** — none. `control_plane.email_log` already exists
  and is shared across mailer drivers.
- **Infra** — **NEW** `smtp4dev` service in
  `infra/compose/compose.smtp4dev.yml`. SMTP `localhost:1025`,
  web UI `http://localhost:5080`. The compose file declares
  `atlas-dev` as an external network so it composes onto an already-up
  control-plane stack.
- **Server config** — **NEW** env vars `MAILER_DRIVER` (`stdout|smtp`,
  default `stdout`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`. Strict-mode
  validation: `smtp` driver requires host + port + from.
  `SmtpConfig` does NOT yet have auth fields — see
  [Known Debt](#known-debt) item (g).
- **Bootstrap** — `apps/server/src/bootstrap.ts` picks the mailer
  based on `config.mailerDriver`. `shutdown()` now awaits
  `mailer.close?.()` so a `MAILER_DRIVER=smtp` server drains its
  connection pool cleanly.

## End-to-End Flow

1. Public visitor `GET /signup` → inline HTML form
   (`routes/signup.ts`).
2. Submits form → `POST /api/v1/signup` → `handleSignupSubmit` inserts
   a `pending` row in `control_plane.signup_requests`. Returns 202.
3. Admin (a principal whose `roles` include `admin`)
   `POST /api/v1/admin/signups/:id/approve`
   (`routes/admin-signups.ts`). `requireAdmin` enforces the role
   even under `TEST_AUTH_ENABLED=true`.
4. `handleSignupApprove`
   (`modules/tenancy/src/handlers/signup-approve.ts`):
   a. tenant row created in `control_plane.tenants`.
   b. custom-domain `<slug>.<apex>` registered.
   c. tenant DB provisioned via `ensureTenantProvisioned` callback.
   d. `revokeOutstandingInvites` callback called — currently a no-op
      pending the identity revoke handler (see Known Debt).
   e. `issueInvite` callback mints a fresh `InviteToken` in the tenant
      DB via `handleInviteIssue` + `identityDispatcher`.
   f. Email body composed inside the handler around the URL returned
      by `buildMagicLinkUrl` callback, then `mailer.send({...})` —
      `StdoutEventMailer` by default, `SmtpMailer` when
      `MAILER_DRIVER=smtp`.
   g. signup row flipped to `approved` via `markApproved`.
   h. `appendEvent` callback emits a `Tenancy.SignupApproved`
      `EventEnvelope` into the per-tenant event store. The
      callback constructs the per-tenant `EventStore` lazily so the
      handler stays domain-pure.
5. Visitor opens smtp4dev (`http://localhost:5080`), sees the email,
   clicks the magic-link → `GET /signup/confirm` HTML page.
6. Clicks "Sign in" → `POST /signup/confirm` → `handleInviteAccept` →
   session cookie set on apex domain → `200 { redirect }` response;
   client JS performs the navigation to `<slug>.<apex>/`.
7. `routes/tenant-home.ts` serves the welcome stub for the
   authenticated session.

## What's Stubbed Today

The seam is fully shipped:

- **Form + submit** — `apps/server/src/routes/signup.ts`.
- **Admin approve** — `apps/server/src/routes/admin-signups.ts`
  (passes `mailer`, `buildMagicLinkUrl`, `revokeOutstandingInvites`,
  `appendEvent`).
- **Approve handler** — `modules/tenancy/src/handlers/signup-approve.ts`.
- **Invite mint** — `issueInviteForTenant`
  (`apps/server/src/routes/signup.ts`) wraps `handleInviteIssue` +
  `identityDispatcher`. (Adapter-construction debt — see Known Debt
  item (f).)
- **Confirm pages** — inline HTML + 200/`{ redirect }` POST handler.
- **Tenant home** — `apps/server/src/routes/tenant-home.ts`.
- **Mailer port + dev adapter** — `ports/src/mailer.ts`,
  `adapters/node/src/mailer-stdout.ts`.
- **Mailer SMTP adapter** — `adapters/node/src/mailer-smtp.ts` with
  `close()` drain.
- **Email-log read** — `PostgresEmailLogStore`.
- **Cookie-based session** — `apps/server/src/middleware/cookie.ts`.
- **Tenant resolution** — `apps/server/src/middleware/tenant-resolution.ts`.
- **Audit event** — `Tenancy.SignupApproved` envelope appended on every
  approval.

## Known Debt

Items deferred from this slice. Each is a separate spec/PR.

(a) **`revokeOutstandingInvites` no-op.** The deps interface forces
the route to pass a callback, but the implementation is currently a
no-op because the identity module does not yet expose an
`Identity.Invite.Revoke` handler. Effect: prior magic-link tokens
remain valid until their natural ~7-day TTL after a re-approval
retry. Fix lands as a separate slice that adds the identity revoke
handler + projection.

(b) **Logging contract debt.** `console.log` JSON lines in
`signup-approve.ts` and both mailer adapters violate
[`crosscut/logging.md`](../../../../../crosscut/logging.md). The
slice did not introduce a logger seam; the cleanup happens after
`@atlas/logging` lands.

(c) **Worker dispatcher parity.** `policyCacheDispatcher`
(conditional, Cedar-specific) and `serverEventDispatcher`
(cross-process SSE) are still missing from
`apps/projection-worker/src/tenant-loop.ts`. Cross-process IPC is
required to fix the SSE one properly. Phase 2/3 follow-up.

(d) **Default plan / quota attachment.** Tenants are created with no
plan attached. Needs a `quotas/cpu-budget` capability spec before
Compute slice 5.

(e) **BDD `.feature` for signup.** The BDD harness is currently
sim-only; the slice did not extend the harness to drive the real
`apps/server`. The integration test fills the coverage gap for now.

(f) **Adapter construction leak.** `issueInviteForTenant` in
`apps/server/src/routes/signup.ts` constructs adapters inline
rather than reading them off `AppState`. Separate refactor slice.

(g) **Production SMTP credentials.** `SmtpConfig` does not yet have
`auth.user` / `auth.pass` fields (env vars `SMTP_USERNAME` /
`SMTP_PASSWORD`). When a real SMTP provider is wired up,
credentials must come through the secrets domain, not via env-var
loaders directly.

## What's NOT in Scope

Each item below is a separate spec/PR if/when it lands:

- **Tenant home dashboard.** Welcome stub stays as-is; the real
  dashboard is Slice 2.
- **HTML email.** Plaintext only — smtp4dev renders it fine.
- **Production SMTP provider adapter.** Same `Mailer` interface; a
  future `MailerSendgrid` / `MailerSes` adapter ships when needed.
- **Production SMTP credentials.** See Known Debt (g) — auth fields
  on `SmtpConfig` plus secrets-domain wiring deferred until a real
  provider lands.
- **Rate limiting on `/signup`.** Hardening slice.
- **Bounce / failure handling.** smtp4dev never bounces; the real
  adapter must, but separately.
- **Self-service approval / email verification before admin sees
  it.** Today admin must approve every signup. Self-service is a
  policy decision for later.
- **SPA-shell replacement of the inline HTML pages.** Slice 2/3.
- **`atlasctl signup` / `atlasctl push`.** Slice 3+.
- **Real frontend deploy via k3s + kaniko + Caddy.** Slice 5.

## Files Touched (post-implementation)

Grouped by surface.

### Adapters
- **NEW** `adapters/node/src/mailer-smtp.ts` — `SmtpMailer implements Mailer`
  with `send()` + `close()`.
- **CHANGED** `adapters/node/src/index.ts` — adds the `SmtpMailer` export.
- **CHANGED** `adapters/node/package.json` — adds `nodemailer` runtime
  dep + `@types/nodemailer` dev dep.
- **CHANGED** `adapters/node/.eslintrc` (or root ESLint config) —
  guard restricting `nodemailer` imports to adapter-node.

### Ports
- **CHANGED** `ports/src/mailer.ts` — adds optional `close?():
  Promise<void>`.
- **CHANGED** `ports/CLAUDE.md` — adds `Mailer` to the Port Catalogue
  and the Implementer↔Consumer Map (server-only consumer).

### Modules
- **CHANGED** `modules/tenancy/src/handlers/signup-approve.ts` — deps
  gained `revokeOutstandingInvites` and `appendEvent`; emits
  `Tenancy.SignupApproved` envelope on approve.
- **NEW** `modules/tenancy/test/signup-approve.test.ts` — 4 tests.

### Server
- **CHANGED** `apps/server/src/routes/signup.ts` — `/signup/confirm`
  POST returns `200 { redirect }`; a11y polish on confirm page.
- **CHANGED** `apps/server/src/routes/admin-signups.ts` —
  `requireAdmin` enforces the `admin` role even under
  `TEST_AUTH_ENABLED=true`; passes new callbacks into
  `handleSignupApprove`.
- **CHANGED** `apps/server/src/middleware/principal.ts` (or wherever
  `parseDebugPrincipal` lives) — accepts 4-segment
  `user:<id>:<tenantId>:<roles>` form.
- **CHANGED** `apps/server/src/bootstrap.ts` — picks `SmtpMailer`
  when `MAILER_DRIVER=smtp`; `shutdown()` awaits `mailer.close?.()`.
- **CHANGED** `apps/server/src/config.ts` — `mailerDriver` + `smtp`
  config block.

### Worker
- **CHANGED** `apps/projection-worker/src/tenant-loop.ts` — adds
  `identityDispatcher` to the dispatcher chain.

### Tests
- **NEW** `adapters/node/test/mailer-smtp.test.ts` — 8 cases.
- **NEW** `modules/tenancy/test/signup-approve.test.ts` — 4 cases.
- **CHANGED** `tests/integration/public-signup.itest.ts` — primary
  loop hardened (9 fixes: I3 replay test skipped pending revoke wiring,
  I2 negative test added, `email_log` row assertion, `COOKIE_DOMAIN`
  precondition, `*.localhost` Windows note, `ORG_NAME` regex escaped
  to a `toContain` assertion, etc.).

### Infra
- **NEW** `infra/compose/compose.smtp4dev.yml` — smtp4dev service
  declaring `atlas-dev` as an external network.

### Specs / Docs
- **CHANGED** `PORTS.md` — adds 1025 (SMTP) and 5080 (smtp4dev UI).
- **CHANGED** `specs/LEXICON.md` — adds `SignupRequest`, `MagicLink`,
  `InviteToken`, `Mailer` entries.
- **CHANGED** `specs/normative_requirements.md` — adds REQ-MAILER-001
  and REQ-MAILER-002.
- **CHANGED** `specs/domains/approvals/README.md` — scope note
  distinguishing workflow approvals from tenancy signup approval.
- **CHANGED** `specs/domains/tenancy/capabilities/public-signup/README.md`
  — this file.

## Things That DON'T Change

- **`EmailMessage` shape** — `to`, `subject`, `body`, `tenantId`,
  `correlationId`, `tags?` — no new fields.
- **`Mailer.send` signature** — `send(EmailMessage) →
  MailerSendResult` is unchanged. `close?()` is purely additive
  (optional, no existing caller needs to change).
- **`control_plane.email_log` schema** — same row shape across
  drivers. The SMTP adapter inserts with the same columns.
- **`handleSignupSubmit` / `handleInviteAccept`** — unchanged.
- **`/signup`, `/api/v1/signup`, admin-signups route surfaces** —
  unchanged (only `/signup/confirm` changed its response shape).
- **`tenant-resolution` middleware** — unchanged.
- **Cookie-domain handling** — unchanged.
- **Default `MAILER_DRIVER`** — stays `stdout`. Existing tests + dev
  flows that don't bring smtp4dev up keep working.

## Acceptance

- **Adapter test** — `adapters/node/test/mailer-smtp.test.ts` ▸ 8
  cases covering: `send` writes `email_log` with `correlation_id`;
  `messageId` round-trips when SMTP supplies one; `messageId`
  generated when SMTP doesn't; `transport.sendMail` called with
  `to/subject/text` matching `EmailMessage`; `X-Atlas-Correlation-Id`
  header set; transport errors propagate; `close()` drains the pool;
  `close()` is idempotent.
- **Module test** — `modules/tenancy/test/signup-approve.test.ts` ▸
  4 cases: happy path appends `Tenancy.SignupApproved`; mailer
  rejection surfaces error and does not mark approved; idempotency on
  retry calls `revokeOutstandingInvites` then re-mints; an
  already-approved signup is rejected.
- **Integration test** —
  `tests/integration/public-signup.itest.ts` ▸ primary loop (signup →
  smtp4dev → magic link → tenant home), I2 negative test
  (non-admin principal → 403), I3 replay test (skipped pending full
  revoke wiring per Known Debt (a)).
- **Boundary checks** — `pnpm typecheck` + `pnpm deps:check` +
  `pnpm lint` + `pnpm test` green. `SmtpMailer` MUST NOT be imported
  by any module under `/modules` (enforced by dep-cruiser
  `modules-no-adapters` rule + ESLint `no-restricted-imports`
  `nodemailer` guard).
- **Manual e2e (documented, not automated)** — submit signup, see
  email in smtp4dev UI at `http://localhost:5080`, click link,
  land signed-in on `<slug>.localhost:3000`.

## Cross-References

- Vision: [`specs/vision.md`](../../../../vision.md)
- Domain: [`specs/domains/tenancy/`](../../README.md)
- Capability template: [`specs/_capability-template.md`](../../../../_capability-template.md)
- Worked example (sibling capability):
  [`specs/domains/tenancy/capabilities/custom-domains/README.md`](../custom-domains/README.md)
- Lifecycle: [`specs/lifecycle.md`](../../../../lifecycle.md)
- Architecture invariants: [`specs/architecture.md`](../../../../architecture.md)
- Lexicon (terms added in this slice):
  [`specs/LEXICON.md`](../../../../LEXICON.md)
- Normative requirements (REQ-MAILER-001 / REQ-MAILER-002):
  [`specs/normative_requirements.md`](../../../../normative_requirements.md)
- Approvals scope note (workflow approvals vs. signup approval):
  [`specs/domains/approvals/README.md`](../../../approvals/README.md)
- Logging contract (debt context for item (b)):
  [`crosscut/logging.md`](../../../../../crosscut/logging.md)
- Mailer port: [`ports/src/mailer.ts`](../../../../../ports/src/mailer.ts)
- Stdout mailer: [`adapters/node/src/mailer-stdout.ts`](../../../../../adapters/node/src/mailer-stdout.ts)
- SMTP mailer: [`adapters/node/src/mailer-smtp.ts`](../../../../../adapters/node/src/mailer-smtp.ts)
- Approve handler:
  [`modules/tenancy/src/handlers/signup-approve.ts`](../../../../../modules/tenancy/src/handlers/signup-approve.ts)
- Public signup routes:
  [`apps/server/src/routes/signup.ts`](../../../../../apps/server/src/routes/signup.ts)
- Admin signup routes:
  [`apps/server/src/routes/admin-signups.ts`](../../../../../apps/server/src/routes/admin-signups.ts)
- Tenant home: [`apps/server/src/routes/tenant-home.ts`](../../../../../apps/server/src/routes/tenant-home.ts)
- Tenant resolution middleware:
  [`apps/server/src/middleware/tenant-resolution.ts`](../../../../../apps/server/src/middleware/tenant-resolution.ts)
- Projection worker tenant loop:
  [`apps/projection-worker/src/tenant-loop.ts`](../../../../../apps/projection-worker/src/tenant-loop.ts)
- smtp4dev compose:
  [`infra/compose/compose.smtp4dev.yml`](../../../../../infra/compose/compose.smtp4dev.yml)
- Integration test:
  [`tests/integration/public-signup.itest.ts`](../../../../../tests/integration/public-signup.itest.ts)
- Adapter test:
  [`adapters/node/test/mailer-smtp.test.ts`](../../../../../adapters/node/test/mailer-smtp.test.ts)
- Module test:
  [`modules/tenancy/test/signup-approve.test.ts`](../../../../../modules/tenancy/test/signup-approve.test.ts)
