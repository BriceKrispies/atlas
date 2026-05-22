# Capability: Tenant Admin Invites User

**Capability:** tenant-admin-invites-user
**Domain:** identity
**Status:** Draft. First slice after `tenancy/public-signup` and the **first
I20 zero-restart demonstration** — the slice ships entirely via frontend
(Vite-HMR), spec (markdown), and BDD (Playwright) paths; `apps/server`
stays up for the duration of the slice. The retrospective at `tickets/
kernel-extraction/` fires if any acceptance step proves to need an
`apps/server` restart (see [I20 Compliance Witness](#i20-compliance-witness)).

## Purpose

A seeded tenant-admin (the user landed by the `public-signup` magic-link)
opens their tenant's admin shell, opens the **Users surface**, invites a
new user by email + role, and receives confirmation that the invite has
been mailed. The invitee opens the email in smtp4dev, clicks the magic-
link, lands on **Accept Invite**, then **Set Password**, then **Login**,
and finally on the tenant home — signed in with a real password session.
The original admin's Users surface, refreshed, lists the new member.

This is the natural second slice of the platform: `public-signup` proves
that one external user can become a tenant's first admin; this capability
proves the platform supports the basic loop every multi-tenant SaaS owes
its customers — "let me add my colleagues." It is also the load-bearing
first end-to-end demonstration of [I20](../../../../architecture.md#i20-operator-feature-delivery-is-an-intent):
no kernel touch is required to ship a real, end-user-visible feature on
top of the substrate `public-signup` left behind.

## Invariants Touched

- **I1** — every HTTP call in the flow (`/api/v1/intents` for
  `Identity.Invite.Issue` / `Identity.Invite.Accept` /
  `Identity.User.Create` / `Identity.Membership.Create` /
  `Identity.User.SetPassword` / `Identity.Login.Password` /
  `Identity.AuthSession.Issue`, plus the Users-surface read endpoints)
  lands on `apps/server`. No new HTTP surface is added by any of the
  five `apps/admin` surfaces — they are SPA clients of the existing
  ingress. Satisfied by construction (the slice adds zero server-side
  code).
- **I2** — `Identity.Invite.Issue` and `Identity.Membership.Create` are
  TenantAdmin-scoped intents; `modules/identity/src/policies/role-packs.ts`
  already classifies the relevant `invite` / `create` verbs as writes
  and emits TenantAdmin permits for every manifest-declared write
  action. A BDD negative step asserts that a non-`TenantAdmin` principal
  (e.g. a `Viewer` membership of `acme`) hitting `Identity.Invite.Issue`
  scoped to `acme` receives 403 and **no** `Identity.InviteIssued`
  event is appended to `acme`'s event store.
- **I5** — `correlationId` flows from the surface (`fetch` headers via
  `@atlas/api-client`) through ingress, through `handleInviteIssue` →
  `mailer.send` → `email_log.correlation_id`, then on the user side
  through `handleInviteAccept` → `handleUserSetPassword` →
  `handlePasswordLogin` → `handleAuthSessionIssue`. The BDD scenario
  asserts the structured log line for each handler step carries the
  same `correlationId` per-leg (issue leg vs. accept-and-onwards leg —
  these are two separate request chains because the magic-link click is
  a fresh request).
- **I10** — every event emitted in the flow already carries
  `cacheInvalidationTags` per the existing identity handlers. The slice
  adds no new handlers, so no new tags. The BDD scenario asserts that
  the events on `acme`'s event store carry at least
  `['Tenant:acme', 'Invite:<id>']` for `Identity.InviteIssued`,
  `['Tenant:acme', 'User:<id>']` for `Identity.UserCreated`, and
  `['Tenant:acme', 'Membership:<id>']` for `Identity.MembershipCreated`
  (existing tag conventions; the test pins them so a regression that
  drops a tag fails this BDD scenario, not just identity unit tests).
- **I12** — no new projections; the existing `identityDispatcher`
  rebuilds the user / membership / invite projections from the same
  event stream. The dispatch-test (`modules/identity/test/dispatch.test.ts`)
  is unchanged and still gates the existing projections; this slice
  does not extend it.
- **I18** — the five new surfaces (`users-surface`, `invite-form-surface`,
  `login-surface`, `accept-invite-surface`, `set-password-surface`)
  each extend `AtlasSurface` and implement `getSurfaceSnapshot()` per
  the surface-introspection contract. Each registers in
  `/api/v1/surfaces` at boot (the surface registry is read at request
  time, so a Vite HMR replacement of the surface code refreshes the
  registry without restarting `apps/server`).
- **I20** — **first executable witness.** Every code path in
  `files_in_scope` is one of: frontend (Vite HMR), spec (markdown), or
  test (Playwright-only). The slice ships end-to-end without restarting
  `apps/server`. See [I20 Compliance Witness](#i20-compliance-witness)
  below for the file-by-file classification and the §11 trigger
  conditions that would force a retrospective.

## Lexicon

No new terms. The capability reuses the vocabulary `public-signup`
landed:

- `InviteToken`, `MagicLink`, `Mailer` (already in
  [`specs/LEXICON.md`](../../../../LEXICON.md)).
- `TenantAdmin`, `Viewer` — canonical role names from
  `modules/identity/src/policies/role-packs.ts`.
- `Membership` — the entity binding a `User` to a `Tenant` with a set
  of role names. Existing in the identity entity model.

No `LEXICON.md` change is part of this slice. If the BDD step language
introduces a new noun, it does **not** earn a lexicon entry — BDD step
text is local to its feature file.

## Surfaces

- **Handlers** — **none new.** The slice composes seven existing
  handlers from `modules/identity/src/handlers/`:
  `Identity.Invite.Issue` → `invite-issue.ts`,
  `Identity.Invite.Accept` → `invite-accept.ts`,
  `Identity.User.Create` → `user-create.ts`,
  `Identity.Membership.Create` → `membership-create.ts`,
  `Identity.User.SetPassword` → `password-set.ts`,
  `Identity.Login.Password` → `password-login.ts`,
  `Identity.AuthSession.Issue` → `session-issue.ts`.
- **Events emitted** — none new; the slice piggy-backs on the existing
  events emitted by the seven handlers above
  (`Identity.InviteIssued`, `Identity.InviteAccepted`,
  `Identity.UserCreated`, `Identity.MembershipCreated`,
  `Identity.UserPasswordSet`, `Identity.PasswordLoginSucceeded`,
  `Identity.AuthSessionIssued`).
- **Projections** — none new.
- **Queries** — none new; the Users surface reads via the existing
  identity query path (`listMemberships` / `getUser` from
  `modules/identity/src/queries.ts`, exposed under `routes/identity.ts`).
- **Ports** — none new.
- **Adapters** — none new.
- **Routes** — **none new.** All seven intents land at the existing
  `POST /api/v1/intents` endpoint dispatched through `routes/intents.ts`.
- **UI surfaces** — five new `AtlasSurface` subclasses in
  `apps/admin/src/features/identity/`:
  - `users-surface.ts` — list memberships for the active tenant; CTA
    button opens the invite form. `data-route="identity/users"`.
  - `invite-form-surface.ts` — email + role inputs; submit dispatches
    `Identity.Invite.Issue`. `data-route="identity/users/invite"`.
  - `login-surface.ts` — email + password; submit dispatches
    `Identity.Login.Password` + `Identity.AuthSession.Issue`. New
    top-level route. **Decision:** mounted as a `data-route="login"`
    child of the existing `<admin-shell>` (see [Open Scoping
    Questions](#open-scoping-questions-resolved) question 2 for the
    rationale). The unauthenticated shell renders only the login
    surface; the rest of the modules are nav-gated server-side via the
    cookie session, so the shell itself doesn't need a separate
    "logged-out" mode.
  - `accept-invite-surface.ts` — reads `token` from the URL,
    dispatches `Identity.Invite.Accept`. `data-route="invite/accept"`.
  - `set-password-surface.ts` — password + confirm inputs, dispatches
    `Identity.User.SetPassword`. `data-route="invite/set-password"`.
- **Migrations** — none.
- **Email body** — **Decision:** the invite email body includes the
  role being assigned and the magic-link URL (see [Open Scoping
  Questions](#open-scoping-questions-resolved) question 4). This is an
  in-handler string template change in
  `apps/server/src/routes/intents.ts`' invite-issue path — **NO, wait.**
  The email body is composed inside `modules/identity/src/handlers/invite-issue.ts`
  (or by the route that calls the handler) per the existing `public-signup`
  pattern. **If the existing invite-issue handler does not already
  template the role into the email body, the role-in-email decision
  becomes a kernel touch (it edits `apps/server` or `modules/identity`).**
  That is filed as Known Debt (a) below and is a §11 trigger condition;
  see [I20 Compliance Witness](#i20-compliance-witness). For the slice
  as scoped, the BDD assertion is on what the existing handler emits
  — the role-in-body assertion is asserted *if* the existing template
  carries the role; otherwise the assertion is "smtp4dev REST returns
  an email containing the magic-link URL," and the role-in-body
  enrichment is the follow-up ticket.

## End-to-End Flow

Reference: [`specs/lifecycle.md`](../../../../lifecycle.md) for the
canonical request shape. This section names only what is specific to
this capability.

1. The BDD scenario's `Given` step seeds tenant `acme` and a
   tenant-admin user `user:acme-admin:acme:admin` (see [Open Scoping
   Questions](#open-scoping-questions-resolved) question 1 for the
   seeding mechanism).
2. The admin browser context POSTs `Identity.Login.Password` +
   `Identity.AuthSession.Issue` against `acme.localhost:3000/api/v1/intents`
   via the **Login surface**. Server sets the cookie session.
3. The admin navigates to `acme.localhost:3000/#/identity/users` —
   the **Users surface** mounts, fetches `/api/v1/identity/memberships`,
   renders the membership list (initially: just the admin).
4. The admin clicks **Invite User**. The **Invite Form surface**
   mounts at `#/identity/users/invite`. The admin submits
   `invitee@example.com` + role `Viewer`. The submit dispatches
   `Identity.Invite.Issue` via the existing intent endpoint;
   `handleInviteIssue` mints an `InviteToken`, appends
   `Identity.InviteIssued` to `acme`'s event store, and the existing
   `signup-approve`-style mailer pathway sends the magic-link email
   through smtp4dev.
5. The BDD scenario polls smtp4dev's `/api/Messages` REST endpoint
   and asserts (a) exactly one new message addressed to
   `invitee@example.com`, (b) body contains the magic-link URL,
   (c) `control_plane.email_log` has a row with the same
   `correlationId`.
6. The BDD scenario's invitee browser context navigates to the
   magic-link URL. The **Accept Invite surface** mounts at
   `acme.localhost:3000/#/invite/accept?token=<...>`, dispatches
   `Identity.Invite.Accept`, which calls `Identity.User.Create` +
   `Identity.Membership.Create` internally via the existing handler
   composition; events `Identity.InviteAccepted`,
   `Identity.UserCreated`, `Identity.MembershipCreated` land on
   `acme`'s event store.
7. The Accept Invite surface redirects to `#/invite/set-password`.
   The **Set Password surface** mounts; invitee submits a password
   meeting complexity rules; `Identity.User.SetPassword` lands;
   `Identity.UserPasswordSet` is appended.
8. The Set Password surface redirects to `#/login`. The **Login
   surface** mounts; invitee submits email + password;
   `Identity.Login.Password` + `Identity.AuthSession.Issue` set the
   cookie session. **Redirect target after login:** `#/tenant-home`
   (an existing route served by the tenant-home stub from
   `public-signup`), per [Open Scoping
   Questions](#open-scoping-questions-resolved) question 3.
9. The admin browser context refreshes the Users surface;
   `listMemberships` reflects the new membership for `invitee@example.com`.

## What's Stubbed Today

Everything below the surface layer already exists from `public-signup`
and Phase A1/A2 identity:

- All seven identity handlers in `modules/identity/src/handlers/`.
- `TenantAdmin` Cedar permits via `buildRolePacksCedar` over the
  bundled module manifests.
- The `Mailer` port + `SmtpMailer` adapter + smtp4dev compose service.
- `control_plane.email_log` and the magic-link URL builder.
- Cookie-session middleware on `apps/server`.
- The `@server`-tagged BDD harness (real Postgres + smtp4dev +
  apps/server, orchestrated by Playwright `webServer`).
- The `<admin-shell>` hash-routed shell with `data-route`-driven
  child surfaces.
- `AtlasSurface` + `getSurfaceSnapshot()` + `registerTestState`
  pattern (already used by `PagesListPage` and `PolicyEditorPage`).
- `@atlas/api-client` for the `submitIntent` fetch wrapper from the
  frontend.

## What's NOT in Scope

- Direct-create flow (admin sets initial password without invite).
  User chose invite-only.
- WebAuthn / passkey / TOTP enrollment on the new user. Phase A5/A6.
- Bulk import / SCIM provisioning. Phase A4.
- Per-tenant role-pack customisation (overriding `TenantAdmin` /
  `Author` / `Viewer`). The existing Cedar permits suffice.
- Tenant-admin password reset (different surface).
- Email templating polish — plaintext `SmtpMailer` output is sufficient.
- Any change to `apps/server/src/`, `modules/identity/src/`, `ports/`,
  or `adapters/`. If a mid-slice gap forces an edit there, the slice
  STOPS and files a `tickets/kernel-extraction/<slug>.md` retrospective
  per [`always-on.md` §11](../../../../crosscut/always-on.md#§11-kernel-touch-retrospective).
  See [Known Debt](#known-debt) for the specific §11 trigger conditions
  this slice has already identified.

## File-by-File Plan

In execution order. Each path's I20 classification (`frontend`, `spec`,
or `test`) is named so the implementer can confirm the slice stays
inside its declared envelope.

1. **`specs/domains/identity/capabilities/tenant-admin-invites-user/README.md`**
   *(spec — this file)* — the scope, surface, flow, and known debt
   for the slice.
2. **`specs/domains/identity/README.md`** *(spec)* — list this
   capability under the Capabilities section.
3. **`apps/admin/src/features/identity/users-surface.ts`**
   *(frontend, Vite HMR)* — list membership read; renders
   memberships, exposes `getSurfaceSnapshot()` with `state: 'loading' |
   'ready' | 'error'`, data: `{ memberships[] }`.
4. **`apps/admin/src/features/identity/invite-form-surface.ts`**
   *(frontend, Vite HMR)* — email + role form; submits
   `Identity.Invite.Issue`; emits `state: 'idle' | 'submitting' |
   'sent' | 'error'`.
5. **`apps/admin/src/features/identity/login-surface.ts`**
   *(frontend, Vite HMR)* — email + password form; dispatches
   `Identity.Login.Password` + `Identity.AuthSession.Issue`;
   redirects to `#/tenant-home` on success.
6. **`apps/admin/src/features/identity/accept-invite-surface.ts`**
   *(frontend, Vite HMR)* — reads `token` from the URL search;
   dispatches `Identity.Invite.Accept`; redirects to
   `#/invite/set-password` on success.
7. **`apps/admin/src/features/identity/set-password-surface.ts`**
   *(frontend, Vite HMR)* — password + confirm; dispatches
   `Identity.User.SetPassword`; redirects to `#/login`.
8. **`apps/admin/src/main.ts`** *(frontend, Vite HMR)* — import the
   five new surfaces so their `customElements.define` calls run at
   boot. **No other change.** The `<admin-shell>` already renders
   `data-route`-bearing children via slot composition.
9. **`apps/admin/index.html`** *(frontend, Vite HMR)* — add five new
   `<users-surface data-route="identity/users">` /
   `<invite-form-surface data-route="identity/users/invite">` /
   `<login-surface data-route="login">` /
   `<accept-invite-surface data-route="invite/accept">` /
   `<set-password-surface data-route="invite/set-password">` tags
   inside the existing `<admin-shell>`.
10. **`tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature`**
    *(test, Playwright-only)* — sdet's Gherkin; the spec-keeper does
    not draft this. Outline only.
11. **`tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts`**
    *(test, Playwright-only)* — sdet's step bindings.
12. **`tests/bdd/support/server-stack.ts`** *(test, Playwright-only)*
    — extend with the tenant-admin seeding helper (see [Open Scoping
    Questions](#open-scoping-questions-resolved) question 1). **If
    the extension requires an edit to `apps/server/src/bootstrap-platform-admin.ts`**
    (e.g. seeding a per-tenant admin in the boot path rather than via
    intent calls from the BDD step), that edit is a §11 trigger — see
    [I20 Compliance Witness](#i20-compliance-witness).
13. **`playwright.bdd.server.config.ts`** *(test, Playwright-only)*
    — confirm the new feature file is picked up; no shape change
    expected.

The implementer (`frontend-dev`) drives steps 3–9. The sdet drives
steps 10–13 in parallel. The spec-keeper has written steps 1–2.

## Things That DON'T Change

- The seven identity handlers and their event payloads. The BDD
  scenario consumes them as-is.
- The Cedar role-pack generation in
  `modules/identity/src/policies/role-packs.ts`. The
  `TenantAdmin` action set is correct for this capability per the
  ticket survey.
- The `Mailer` port and `SmtpMailer` adapter. The email body
  composition is performed by the **caller** of `mailer.send` in
  `apps/server/src/routes/intents.ts` (or wherever invite-issue is
  wired); the slice does not touch that file.
- The `<admin-shell>`'s hash-routing and `data-route` dispatch logic.
- `/api/v1/intents` shape and `submitIntent` semantics.
- `control_plane.email_log` schema.

## Acceptance

- **Handler tests** — N/A. The slice adds no new handlers; existing
  handler tests in `modules/identity/test/` are unchanged.
- **Dispatch test (I12)** — N/A. No new projection; existing
  `modules/identity/test/dispatch.test.ts` continues to gate the
  identity dispatcher.
- **Contract test** — N/A. No port changed.
- **BDD scenario** —
  `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature`
  ▸ "tenant admin invites a user who logs in with a real password" —
  surface-state asserted at every step via
  `window.__atlasTest.getSurface(...)` for all five surfaces
  (`identity.users`, `identity.users.invite`, `identity.login`,
  `invite.accept`, `invite.set-password`). The scenario must include
  the I2 negative assertion (non-`TenantAdmin` principal → 403, no
  `Identity.InviteIssued` event appended). sdet authors the file.
- **Parity test** — N/A. No adapter touched.
- **I20 compliance check** — the BDD scenario asserts
  `apps/server`'s `process.pid` (or its `/health` uptime value) is
  identical at scenario start and scenario end. If the values differ,
  the slice has restarted the kernel mid-run and the slice STOPS.
  See [I20 Compliance Witness](#i20-compliance-witness).
- **Screenshots** — per-step screenshots captured under
  `tests/bdd/report-server/` via `BDD_SCREENSHOT_MODE=always`
  (existing infra).
- **`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm bdd:server`
  green.**

## I20 Compliance Witness

This slice is the **first executable witness** of
[I20](../../../../architecture.md#i20-operator-feature-delivery-is-an-intent).
The witness comprises three things: (a) every file in scope is a
non-kernel category, (b) a probe asserts `apps/server` did not restart
during the BDD run, and (c) the failure modes that would force a
§11 retrospective are named in advance so a mid-slice surprise is not
papered over.

### File classification

| File | I20 class | Rationale |
|---|---|---|
| `specs/domains/identity/capabilities/tenant-admin-invites-user/README.md` | spec | Markdown; no code. |
| `specs/domains/identity/README.md` | spec | Markdown; no code. |
| `apps/admin/src/features/identity/users-surface.ts` | frontend (Vite HMR) | New `AtlasSurface`; Vite-served. |
| `apps/admin/src/features/identity/invite-form-surface.ts` | frontend (Vite HMR) | New `AtlasSurface`; Vite-served. |
| `apps/admin/src/features/identity/login-surface.ts` | frontend (Vite HMR) | New `AtlasSurface`; Vite-served. |
| `apps/admin/src/features/identity/accept-invite-surface.ts` | frontend (Vite HMR) | New `AtlasSurface`; Vite-served. |
| `apps/admin/src/features/identity/set-password-surface.ts` | frontend (Vite HMR) | New `AtlasSurface`; Vite-served. |
| `apps/admin/src/main.ts` | frontend (Vite HMR) | Five new `import` lines for the surfaces above. |
| `apps/admin/index.html` | frontend (Vite HMR) | Five new tags under `<admin-shell>`. |
| `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature` | test (Playwright-only) | Gherkin; run by `pnpm bdd:server`. |
| `tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts` | test (Playwright-only) | Step bindings; run by `pnpm bdd:server`. |
| `tests/bdd/support/server-stack.ts` | test (Playwright-only) | Test harness extension; not loaded by `apps/server`. |
| `playwright.bdd.server.config.ts` | test (Playwright-only) | Test runner config. |

Every path classifies as `frontend`, `spec`, or `test`. None of the
paths are in [`always-on.md` §2](../../../../crosscut/always-on.md#§2-what-is-restart-required-the-kernel)'s
kernel surface. If the implementer adds a path outside this table
during execution, the slice STOPS and a §11 retrospective fires.

### Zero-restart probe

The BDD step
`Then the apps/server process did not restart during the scenario`
asserts the identity of `apps/server`'s `process.pid` (read via the
`/health` endpoint, which the public-signup slice already exposes; if
`pid` is not currently included in the health body, the BDD step
substitutes "uptime monotonically increased and never decreased,"
which is a strictly equivalent assertion for a single-replica deploy).
The step runs at scenario `Before` (capturing the baseline) and at
scenario end (asserting the baseline still holds). If the values
diverge, the scenario fails and the §11 trigger fires.

Implementation note: this is the **first** time the BDD harness has
needed to read `apps/server`'s pid/uptime; sdet's parallel work on
the step bindings owns the implementation choice (pid in health body
vs. uptime monotonicity). The spec mandates only that the assertion
exists and that its failure stops the slice.

### §11 trigger conditions (specific failure modes this slice has anticipated)

The following are pre-flagged kernel-touch risks. Hitting any of these
mid-slice triggers an immediate `tickets/kernel-extraction/<slug>.md`
retrospective per
[`always-on.md` §11](../../../../crosscut/always-on.md#§11-kernel-touch-retrospective)
and pauses the slice until the extraction-plan ticket is scoped.

1. **`TenantAdmin` role-pack misses a required action permit.** If
   the BDD scenario discovers that the `TenantAdmin` Cedar set
   excludes any of `Identity.Invite.Issue` /
   `Identity.Membership.Create` (etc.) for `acme`, the fix is an
   edit to `modules/identity/src/policies/role-packs.ts` — a module
   touch under `/modules`, restart-required to take effect because
   role-pack generation runs at boot via the seed runner. **Category:
   "policy-pack generation runs at boot, not at request."** Extraction
   plan: make `buildRolePacksCedar` runtime-callable from the bundle
   loader (§6 phase 6 territory).
2. **Invite email body does not include the role.** If
   `handleInviteIssue` (or its caller in `routes/intents.ts`)
   composes the email body without templating the role, the
   role-in-body decision becomes a kernel touch. **Category: "email
   templating lives inside the handler / route, not in a tenant
   declaration."** Extraction plan: move invite email body to a DSL
   declaration ([ADR 0007](../../../../decisions/0007-dsl-substrate-and-authoring-contract.md))
   so tenants can override the wording; platform-default ships as a
   declaration too.
3. **`/api/v1/surfaces` doesn't reflect new surfaces without a
   restart.** If the surface registry is read once at boot rather
   than per-request (against the live `customElements` registry),
   adding a new surface forces an `apps/server` restart for I18
   compliance. **Category: "surface registry is boot-time, not
   request-time."** Extraction plan: make the registry read-through
   to the live registry (or move the registry to be Vite-served HTML
   metadata that `apps/server` fetches per-request — the surface
   list is frontend data, not server data).
4. **Tenant-admin seeding for the BDD run requires a boot-path
   edit.** If `seedPlatformAdmin` is not generalisable to "seed a
   per-tenant admin for tenant X" via a BDD `Given` step issuing
   real intents, the only fix is an extension of
   `apps/server/src/bootstrap-platform-admin.ts` — a kernel touch.
   **Category: "tenant seeding is a boot-time concern, not a
   tenant-intent concern."** Extraction plan: expose a
   `Tenancy.Seed.TenantAdmin` intent the BDD harness can call
   directly; the boot-path seeder becomes a thin wrapper that
   issues the same intent. (This is also the recommended path for
   resolving [Open Scoping Questions](#open-scoping-questions-resolved)
   question 1 — see the answer below.)
5. **`@atlas/api-client` does not expose a `submitIntent` for one
   of the seven identity intents.** If any intent requires a new
   client-side wrapper that `@atlas/api-client` does not provide,
   that's a package edit. `@atlas/api-client` is in
   [`packages/`](../../../../../packages/), not `apps/server`, so
   it doesn't force an `apps/server` restart — but it does force a
   `pnpm install` / `pnpm build` for any consumer. **Category:
   "intent submission is package-level, not data-level."** Lower
   severity than 1–4 (no `apps/server` restart needed), but a slice
   surprise that we record per §11.2 anyway.

The list is exhaustive against the survey performed in the ticket;
new categories discovered during implementation are added by the
implementer at retrospective-filing time, not at acceptance time.

## Open Scoping Questions (Resolved)

The ticket flagged four questions. Each is resolved below with
rationale.

### 1. How does the BDD scenario obtain a logged-in tenant-admin for `acme`?

**Decision: option (a) — seed `acme` + `acme-admin` (User + Membership)
via real intents in the BDD `Given` step, then drive a real password-
login to obtain the session cookie.**

Mechanism: a BDD `Given the tenant "acme" exists with a tenant-admin
"acme-admin@example.com"` step issues, via the existing `/api/v1/intents`
endpoint and the `X-Debug-Principal: user:platform-admin:_platform:admin`
header (`TEST_AUTH_ENABLED=true`):

1. `Tenancy.SignupSubmit` + `Tenancy.SignupApprove` to provision
   tenant `acme` (the `public-signup` path), **or** a direct
   `Tenancy.Tenant.Create` if the BDD harness already exposes one;
   sdet picks the path that's faster to drive cleanly. The decision
   here doesn't affect the kernel-touch envelope because both paths
   are existing intents.
2. `Identity.User.Create` (email: `acme-admin@example.com`,
   userId: `acme-admin`).
3. `Identity.Membership.Create` (userId: `acme-admin`, tenantId:
   `acme`, roles: `['TenantAdmin']`).
4. `Identity.User.SetPassword` (userId: `acme-admin`, password: a
   BDD-known fixture password).

The BDD scenario then drives the **Login surface** with the seeded
credentials — a real password-login — to obtain the session cookie.
The honesty of "admin can actually log in" is part of the goal the
user named; we do not paper over it with `X-Debug-Principal`.

**Principal id format:** `user:acme-admin:acme:TenantAdmin` (4-segment
form, per the `parseDebugPrincipal` extension that landed in
`public-signup`). The seeded `User` row has
`userId=acme-admin`, the `Membership` carries
`roles=['TenantAdmin']` and `tenantId='acme'`.

**`X-Debug-Principal` rejected because:** it would skip the
`Identity.Login.Password` + `Identity.AuthSession.Issue` step on the
admin side. The user explicitly named "real login" as part of the
feature scope; bypassing the admin's password login hides a load-
bearing assumption. Option (a) costs more BDD wiring but produces a
test that exercises the same surface tenants will exercise.

**§11 risk:** if `seedPlatformAdmin` proves not generalisable to
"seed a per-tenant admin via the same boot pattern" and the BDD
harness can't drive the four intents cleanly via the existing
`X-Debug-Principal: platform-admin` path, the fallback is to extend
`apps/server/src/bootstrap-platform-admin.ts` to take a tenantId
parameter — and that's a kernel touch (trigger condition 4 above).
The mitigation: prefer the four-intent path; only fall back to
boot-path extension after exhausting the intent-driven approach.

### 2. Where does the Login surface live in `apps/admin`'s routing?

**Decision: a surface inside `<admin-shell>` with
`data-route="login"`, mounted alongside the other module surfaces.**

The `<admin-shell>` is hash-routed with `data-route` dispatch;
`#/login` is a legitimate hash that the existing router already
handles. The shell renders only the surface matching the current
hash, so the unauthenticated experience is: shell + login surface
+ everything else hidden by `data-route` non-match. The cookie
session, set on successful login, gates the actual server-side
data reads for the other module surfaces — the shell does not need
a separate "logged-out mode."

**File path:** `apps/admin/src/features/identity/login-surface.ts`,
registered in `apps/admin/index.html` as
`<login-surface data-route="login">` inside the existing
`<admin-shell>`.

**Alternative rejected:** a separate top-level `/login` route (with
its own HTML page bypassing `<admin-shell>`) would require either a
new Vite entry point or server-side HTML serving — the second forces
an `apps/server` edit and triggers I20 §11. The first is technically
possible but adds an entry point for negligible benefit; the hash-
routed approach is the same UX with zero new server code.

### 3. What's the redirect target after successful password login?

**Decision: `#/tenant-home` — an existing route served by the
tenant-home stub from `public-signup`.**

`apps/server/src/routes/tenant-home.ts` already serves a welcome
stub for the authenticated session on `<slug>.<apex>/`. The login
surface, on successful `Identity.AuthSession.Issue`, navigates
`window.location.href = '/'` so the server-side route renders. The
BDD final-state assertion: `window.location.pathname === '/'` and
the welcome content is visible.

**Alternative considered:** a dedicated `#/welcome` SPA surface.
Rejected because `tenant-home.ts` already exists and the second
welcome stub would be redundant.

### 4. Does the invite email body include the role being assigned?

**Decision: yes — the email body includes the role and the magic-link
URL.**

Rationale: surface trust is part of the invite contract. "You have
been invited to `acme` as a `Viewer`" tells the invitee what
permission level they're accepting before they click. Asserting it
in the BDD scenario closes the trust hole between "admin chose a
role" and "user accepted under that role."

**smtp4dev assertion contract:** the BDD step polls
`GET /api/Messages?recipient=invitee@example.com` and asserts the
returned message body contains (a) the magic-link URL hostname
`acme.localhost:3000`, (b) the role string `Viewer`, (c) the
inviter email `acme-admin@example.com`.

**§11 risk:** if the existing `handleInviteIssue` email template
does not already include the role, adding it is a server-side edit
(trigger condition 2 above). The mitigation strategy: sdet drafts
the BDD assertions; if the assertion on the role string fails
because the existing template doesn't carry the role, the slice
STOPS, files a `tickets/kernel-extraction/email-templating-as-dsl.md`
retrospective, and the role-in-body decision moves to a follow-up
slice. The remaining assertions (magic-link URL, inviter email)
hold even if role-in-body fires the retrospective — so the BDD
scenario degrades gracefully.

## Known Debt

Items that this slice has identified but is deliberately not fixing,
each filed as Known Debt rather than reactive scope creep:

(a) **Email body templating may require an `apps/server` /
`modules/identity` edit.** The role-in-body decision (question 4
above) is correct, but if the existing handler template does not
already carry the role, the role-in-body enrichment becomes a
kernel-touch follow-up rather than part of this slice. Filed as §11
trigger condition 2.

(b) **`apps/server`'s `/health` endpoint may not expose `process.pid`.**
The zero-restart probe needs either `pid` or `uptime` in the health
response. If neither is currently exposed, adding the field is an
`apps/server` edit — a kernel touch. The fallback is for the BDD
harness to track `apps/server` externally via the Playwright
`webServer` lifecycle. Filed as §11 trigger condition implicit in
the [Zero-restart probe](#zero-restart-probe) section.

(c) **Per-tenant admin seeding via intent vs. via boot path.** If
the BDD four-intent seeding path proves impractical, the fallback
extends `apps/server/src/bootstrap-platform-admin.ts` and triggers
a §11 retrospective. The clean fix is a `Tenancy.Seed.TenantAdmin`
intent (or equivalent generalisation of the existing seeder).

(d) **The Users surface's read endpoint may not exist.** The slice
assumes `/api/v1/identity/memberships` (or equivalent) is exposed
by `apps/server/src/routes/identity.ts`. If it is not, exposing it
is a server-side edit. The existing `listMemberships` query in
`modules/identity/src/queries.ts` is the source; the route binding
is the missing piece. **This is the most likely §11 trigger of the
five named above.** Mitigation: sdet's Phase-0 adversarial review
confirms or denies the route's existence before frontend-dev
starts; if it's missing, the slice scope expands to include
exposing the route, which **is** a kernel touch and forces the
retrospective per §11.

## Cross-References

- Domain: [`specs/domains/identity/README.md`](../../README.md)
- Architecture / invariants: [`specs/architecture.md`](../../../../architecture.md)
  (I1, I2, I5, I10, I12, I18, I20)
- Always-on contract:
  [`specs/crosscut/always-on.md`](../../../../crosscut/always-on.md)
  (§2 kernel surface, §11 retrospective)
- Capability template:
  [`specs/_capability-template.md`](../../../../_capability-template.md)
- Worked example (sibling slice — public-signup):
  [`specs/domains/tenancy/capabilities/public-signup/README.md`](../../../tenancy/capabilities/public-signup/README.md)
- Lifecycle: [`specs/lifecycle.md`](../../../../lifecycle.md)
- Lexicon: [`specs/LEXICON.md`](../../../../LEXICON.md)
- Role packs:
  [`modules/identity/src/policies/role-packs.ts`](../../../../../modules/identity/src/policies/role-packs.ts)
- Identity handlers:
  [`modules/identity/src/handlers/`](../../../../../modules/identity/src/handlers/)
- Platform-admin seeder:
  [`apps/server/src/bootstrap-platform-admin.ts`](../../../../../apps/server/src/bootstrap-platform-admin.ts)
- Admin shell:
  [`apps/admin/src/shell/AdminShell.ts`](../../../../../apps/admin/src/shell/AdminShell.ts)
- Ticket:
  [`tickets/identity/tenant-admin-invites-user.md`](../../../../../tickets/identity/tenant-admin-invites-user.md)
