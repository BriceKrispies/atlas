# Capability: Public Signup

**Domain:** tenancy
**Status:** **Stubbed.** The signup → approval → magic-link → login flow
is fully wired end-to-end against the `Mailer` port; today the dev
adapter writes magic links to stdout. This capability adds an SMTP
adapter + `smtp4dev` so the email is *visible* in a real inbox UI, and
adds a Playwright integration test that drives the loop against the
real `apps/server`.

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
  authed group via `principalMiddleware`. Already satisfied.
- **I3** — `handleSignupApprove` is idempotent at every step
  (tenant.create existence-check, customDomains.add unique-index
  tolerance, mark-approved last). A retry after a crash on mailer-send
  re-mints the token and re-mails — acceptable: the previous token is
  unused.
- **I5** — `correlationId` flows from `correlationIdFor(c)` →
  `handleSignupSubmit` → `handleSignupApprove` → `issueInvite` →
  `mailer.send`. The SMTP adapter MUST persist `correlation_id` to
  `control_plane.email_log` (parity with `StdoutEventMailer`).
- **I9** — no new cache keys.
- **I10** — no new cache invalidation tags. The existing
  `Identity.InviteIssued` and `Identity.InviteAccepted` events
  carry the right tags.

## Lexicon

No new terms. Reuses **signup request**, **magic link**,
**invite token** (already in `specs/LEXICON.md`).

## Surfaces

What this capability changes, by surface:

- **Handlers** — none. Reuse `handleSignupSubmit`,
  `handleSignupApprove`, `handleInviteAccept`,
  `handleInviteIssue`.
- **Events emitted** — none new. `Identity.InviteIssued` +
  `Identity.InviteAccepted` already exist.
- **Projections / Queries** — none new.
- **Ports** — none new. Reuses `Mailer`
  (`ports/src/mailer.ts`).
- **Adapters** — **NEW** `adapters/node/src/mailer-smtp.ts` —
  `SmtpMailer implements Mailer`, mirrors `StdoutEventMailer`'s
  `control_plane.email_log` insert so the in-app mailbox panel keeps
  working.
- **Routes** — none changed. `/signup`, `/api/v1/signup`,
  `/api/v1/admin/signups/:id/approve`, `/signup/confirm` are already
  in place at `apps/server/src/routes/signup.ts` and
  `apps/server/src/routes/admin-signups.ts`.
- **UI surfaces** — none new. The existing inline HTML pages stay
  (per slice-1 scoping decision; SPA replacement is a future slice).
- **Migrations** — none. `control_plane.email_log` already exists
  and is shared across mailer drivers.
- **Infra** — **NEW** `smtp4dev` service in
  `infra/compose/compose.dev.yml`. SMTP `localhost:1025`, web UI
  `http://localhost:5080`.
- **Server config** — **NEW** env vars `MAILER_DRIVER` (`stdout|smtp`,
  default `stdout`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`. Strict-mode
  validation: `smtp` driver requires host + port + from.
- **Bootstrap** — `apps/server/src/bootstrap.ts` picks the mailer based
  on `config.mailerDriver`. Default unchanged (`stdout`); opt-in
  `smtp` for the dev/itest stack.

## End-to-End Flow

The architectural seam is already complete. This capability changes
**only step 4f** (where the email lands).

1. Public visitor `GET /signup` → inline HTML form
   (`routes/signup.ts:204`).
2. Submits form → `POST /api/v1/signup` → `handleSignupSubmit` inserts
   a `pending` row in `control_plane.signup_requests`. Returns 202.
3. Admin (any authed principal in `TEST_AUTH_ENABLED=true` mode)
   `POST /api/v1/admin/signups/:id/approve`
   (`routes/admin-signups.ts:93`).
4. `handleSignupApprove`
   (`modules/tenancy/src/handlers/signup-approve.ts`):
   a. tenant row created in `control_plane.tenants`.
   b. custom-domain `<slug>.<apex>` registered.
   c. tenant DB provisioned via `ensureTenantProvisioned` callback.
   d. `issueInvite` callback mints an `InviteToken` in the tenant DB
      via `handleInviteIssue` + `identityDispatcher`.
   e. Email body composed inside the handler (lines 161-167) around
      the URL returned by `buildMagicLinkUrl` callback.
   f. **`mailer.send({...})` — TODAY: `StdoutEventMailer`. AFTER
      THIS CAPABILITY (when `MAILER_DRIVER=smtp`): `SmtpMailer`
      delivers to smtp4dev.**
   g. signup row flipped to `approved`.
5. Visitor opens smtp4dev (`http://localhost:5080`), sees the email,
   clicks the magic-link → `GET /signup/confirm` HTML page.
6. Clicks "Sign in" → `POST /signup/confirm` → `handleInviteAccept` →
   session cookie set on apex domain → 303 to `<slug>.<apex>/`.
7. `routes/tenant-home.ts` serves the welcome stub for the
   authenticated session.

## What's Stubbed Today

The seam is fully wired:

- **Form + submit** — `apps/server/src/routes/signup.ts` (inline
  HTML form, `POST /api/v1/signup`).
- **Admin approve** — `apps/server/src/routes/admin-signups.ts:93`
  (passes `mailer: state.mailer` + `buildMagicLinkUrl` callback).
- **Approve handler** — `modules/tenancy/src/handlers/signup-approve.ts`
  (constructs subject + body, calls `mailer.send`).
- **Invite mint** — `issueInviteForTenant`
  (`apps/server/src/routes/signup.ts:357`) — wraps
  `handleInviteIssue` + `identityDispatcher`.
- **Confirm pages** — `apps/server/src/routes/signup.ts:250-347`
  (HTML page + POST handler that calls `handleInviteAccept` and 303s
  to tenant home).
- **Tenant home** — `apps/server/src/routes/tenant-home.ts`
  (welcome stub at `GET /` per tenant host).
- **Mailer port + dev adapter** — `ports/src/mailer.ts`,
  `adapters/node/src/mailer-stdout.ts` (writes to stdout AND
  `control_plane.email_log`).
- **Email-log read** — `PostgresEmailLogStore` (read-only surface for
  a future in-app mailbox).
- **Cookie-based session** — `apps/server/src/middleware/cookie.ts`
  (Domain=apex so the 303 to `<slug>.<apex>` carries the cookie).
- **Tenant resolution** — `apps/server/src/middleware/tenant-resolution.ts`
  (Host header → tenant id via `custom_domains` lookup).

## What's NOT in Scope

Each item below is a separate spec/PR if/when it lands:

- **Tenant home dashboard.** Welcome stub stays as-is; the real
  dashboard (apps list, "create app" CTA) is Slice 2.
- **HTML email.** Plaintext only — smtp4dev renders it fine.
- **Production SMTP.** Same `Mailer` interface; a future
  `MailerSendgrid` / `MailerSes` adapter ships when needed. This
  slice only adds the dev driver.
- **Rate limiting on `/signup`.** Hardening slice.
- **Bounce / failure handling.** smtp4dev never bounces; the real
  adapter must, but separately.
- **Self-service approval / email verification before admin sees
  it.** Today admin must approve every signup. Self-service is a
  policy decision for later.
- **SPA-shell replacement of the inline HTML pages.** Slice 2/3.
- **`atlasctl signup` / `atlasctl push`.** Slice 3+.
- **Real frontend deploy via k3s + kaniko + Caddy.** Slice 5.

## File-by-File Plan

In execution order. Steps 1-3 are pure additions; step 4 wires the
new adapter behind an opt-in env var; step 5 is the validation harness.

1. **`infra/compose/compose.dev.yml`** — append `smtp4dev` service
   (image `rnwood/smtp4dev:v3`, ports `1025:25` SMTP, `5080:80`
   web UI). Same network as the existing dev services.

2. **`adapters/node/package.json`** — add `nodemailer` runtime dep
   and `@types/nodemailer` dev dep.

3. **`adapters/node/src/mailer-smtp.ts`** — `SmtpMailer implements Mailer`:
   - constructor takes `(sql, transport: nodemailer.Transporter, fromAddress)`
   - `send(msg)` calls `transport.sendMail({ from: fromAddress, to, subject, text: body, headers: { 'X-Atlas-Correlation-Id': correlationId } })`
   - mirrors `StdoutEventMailer`'s `email_log` insert (same row shape,
     same `console.log` JSON line for log-streamer parity)
   - returns `{ messageId, sentAt }`. SMTP-supplied `messageId` if
     available, generated otherwise.

4. **`adapters/node/src/index.ts`** — add `export { SmtpMailer } from './mailer-smtp.ts';`

5. **`apps/server/src/config.ts`** — add to `AppConfig`:
   - `mailerDriver: 'stdout' | 'smtp'` (default `'stdout'`)
   - `smtp: { host: string; port: number; from: string } | null`
   - strict-mode validation: when `mailerDriver === 'smtp'`,
     `SMTP_HOST` + `SMTP_PORT` + `SMTP_FROM` MUST be set, else throw.

6. **`apps/server/src/bootstrap.ts`** — pick mailer:
   ```
   const mailer: Mailer = config.mailerDriver === 'smtp' && config.smtp
     ? new SmtpMailer(controlPlaneSql, createTransport({
         host: config.smtp.host, port: config.smtp.port,
       }), config.smtp.from)
     : new StdoutEventMailer(controlPlaneSql);
   ```
   Log the chosen driver on boot ("mailer driver: smtp" /
   "mailer driver: stdout").

7. **Root `package.json`** — add a `stack:up` convenience script:
   ```
   "stack:up": "podman compose -f infra/compose/compose.control-plane.yml -f infra/compose/compose.dev.yml up -d"
   ```
   And `stack:down` for the inverse.

8. **`tests/integration/public-signup.itest.ts`** — Playwright spec
   driven by `playwright.itest.config.ts`:
   - Pre-condition: stack is up (smtp4dev healthy at `:5080/api/Messages`).
   - Submit signup → assert 202 + "Submitted" UI message.
   - POST approve via `X-Debug-Principal` (admin) → assert 200.
   - Poll `GET http://localhost:5080/api/Messages?recipient=<email>`
     until a message arrives (max 5s, 250ms interval).
   - Extract magic-link URL from message body via regex
     `/http:\/\/localhost:3000\/signup\/confirm\?token=[^\s]+/`.
   - `page.goto(magicLinkUrl)`, click "Sign in", wait for navigation.
   - Assert URL host is `<slug>.localhost`, body contains "Welcome"
     OR the welcome-stub assertion shape, session cookie present.

## Things That DON'T Change

The seam contract — if any of these have to move, the slice is
exceeding its scope:

- **`Mailer` interface** (`ports/src/mailer.ts`) — `send(EmailMessage)
  → MailerSendResult` stays exactly as is. No new methods.
- **`EmailMessage` shape** — `to`, `subject`, `body`, `tenantId`,
  `correlationId`, `tags?` — no new fields.
- **`control_plane.email_log` schema** — same row shape across
  drivers. The SMTP adapter MUST insert with the same columns.
- **`handleSignupApprove`** — body construction (lines 161-167) and
  the `mailer.send` call shape do not change. Domain-pure.
- **`handleSignupSubmit` / `handleInviteAccept`** — unchanged.
- **`/signup`, `/signup/confirm`, admin-signups routes** — unchanged.
- **`tenant-resolution` middleware** — unchanged.
- **Cookie-domain handling** — unchanged.
- **Default `MAILER_DRIVER`** — stays `stdout`. Existing tests + dev
  flows that don't bring smtp4dev up keep working.

## Acceptance

- **Adapter contract test (NEW)** —
  `adapters/node/test/mailer-smtp.test.ts` ▸ "send writes to email_log
  with correlation id" — boots an in-process SMTP capture (e.g.
  `smtp-server` test double or just spy on the transport) and
  asserts:
  - `transport.sendMail` called with `to/subject/text` matching
    `EmailMessage`.
  - row inserted into `control_plane.email_log` with the same
    `messageId` returned from `send`.
  - `correlation_id` column set.
- **Integration test (NEW)** —
  `tests/integration/public-signup.itest.ts` ▸ "signup → smtp4dev →
  magic link → tenant home" — full Playwright loop described in step
  8 above. Runs under `pnpm test:integration`.
- **Existing handler/dispatch tests** —
  `modules/tenancy/test/signup-approve.test.ts` and
  `modules/identity/test/dispatch.test.ts` — unchanged. No domain
  edits.
- **Boundary checks** — `pnpm typecheck` + `pnpm deps:check` +
  `pnpm lint` green. `SmtpMailer` MUST NOT be imported by any
  module under `/modules` (already enforced by dep-cruiser
  `modules-no-adapters` rule + ESLint `no-restricted-imports`).
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
- Mailer port: [`ports/src/mailer.ts`](../../../../../ports/src/mailer.ts)
- Stdout mailer (sibling adapter):
  [`adapters/node/src/mailer-stdout.ts`](../../../../../adapters/node/src/mailer-stdout.ts)
- Approve handler:
  [`modules/tenancy/src/handlers/signup-approve.ts`](../../../../../modules/tenancy/src/handlers/signup-approve.ts)
- Public signup routes:
  [`apps/server/src/routes/signup.ts`](../../../../../apps/server/src/routes/signup.ts)
- Admin signup routes:
  [`apps/server/src/routes/admin-signups.ts`](../../../../../apps/server/src/routes/admin-signups.ts)
- Tenant home: [`apps/server/src/routes/tenant-home.ts`](../../../../../apps/server/src/routes/tenant-home.ts)
- Tenant resolution middleware:
  [`apps/server/src/middleware/tenant-resolution.ts`](../../../../../apps/server/src/middleware/tenant-resolution.ts)
- Architecture invariants: [`specs/architecture.md`](../../../../architecture.md)
