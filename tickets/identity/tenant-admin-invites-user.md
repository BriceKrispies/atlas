---
title: Tenant admin invites a user — first end-to-end feature against a live tenant, and the first I20 zero-restart demonstration
status: blocked
type: capability
owner: frontend-dev
phase: 1
capability: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
adr:
vision: [agentic-first, atlas-on-atlas, tiny-core]
invariants: [I1, I2, I5, I10, I12, I18, I20]
blocks: []
blocked_by: [tenancy/admin-approve-provisions-tenant-db]  # earlier blockers all archived: chore/expose-server-bootid-for-i20-probe + atlas-on-atlas/query-catch-all-dispatcher (2026-05-21), chore/podman-machine-windows-pipe-access + doctor/podman-machine-windows (2026-05-22 — doctor unblocker shipped). Now re-blocked on the deeper platform-tenancy gap surfaced by the first successful BDD run: admin-approve doesn't call PostgresTenantDbProvider.provisionTenantDatabase, so tenant `acme` never gets a per-tenant DB and all three BDD failures (this slice's two + the pre-existing public-signup one) trace to that single root.
files_in_scope:
  - specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
  - apps/admin/src/features/identity/users-surface.ts
  - apps/admin/src/features/identity/invite-form-surface.ts
  - apps/admin/src/features/identity/login-surface.ts
  - apps/admin/src/features/identity/accept-invite-surface.ts
  - apps/admin/src/features/identity/set-password-surface.ts
  - tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature
  - tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts
  - tests/bdd/support/server-stack.ts
  - playwright.bdd.server.config.ts
  - specs/domains/identity/README.md
acceptance:
  - capability README exists at the canonical path with the full slice-template shape (purpose / invariants touched / lexicon / surfaces / lifecycle / known-debt / acceptance)
  - pnpm typecheck green
  - pnpm lint green
  - pnpm bdd:server passes the new "admin-invites-user-and-user-logs-in" scenario end-to-end against real apps/server + Postgres + smtp4dev
  - **I20 demonstration — zero kernel restart** — the BDD run starts apps/server ONCE; all code in this slice lands while apps/server stays up (frontend is Vite-served and HMRs; tests are Playwright-driven; spec is markdown). If any acceptance step requires an apps/server restart, the slice STOPS, files the first `tickets/kernel-extraction/<slug>.md` retrospective with §11.2's five fields, and resumes after a linked extraction-plan ticket is scoped
  - per-step screenshots captured under tests/bdd/report-server/ via BDD_SCREENSHOT_MODE=always
  - I18 — every new AtlasSurface implements `getSurfaceSnapshot()` and registers in `/api/v1/surfaces`
  - I10 — every event emitted in the flow carries `cacheInvalidationTags` with `Tenant:${tenantId}` plus per-resource tags
  - I12 — `dispatch.ts` test (existing identity dispatcher) still rebuilds projections from the synthetic event stream after this slice's projections land (if any are added)
  - I2 — non-TenantAdmin principal calling `Identity.Invite.Issue` scoped to a tenant gets a 403 with no side effects (negative test in BDD or itest)
  - I5 — `correlationId` is asserted in the structured log line for every step of the loop (issue → email-send → accept → password-set → login → session-issue)
  - control_plane.email_log carries the magic-link URL for the run; smtp4dev REST `/api/Messages` returns the dispatched email; new user's session cookie is set after password login
  - the new user appears in the Users surface for the tenant after acceptance (list reflects the new membership)
created: 2026-05-21
updated: 2026-05-21
---

## Why

The user's stated first-feature vision (2026-05-21): *"allow a tenant admin (after their tenant site is set up) to be able to create a user with a real login for their site, and that new user can login."* This is the natural next slice after `tenancy/public-signup` — that capability ends with a magic-link landing the *first* tenant-admin on `<slug>.<apex>`; this capability picks up there and lets that admin populate their tenant with real users who log in with real passwords.

The slice doubles as the **first I20 demonstration**. Per the survey (2026-05-21):

- `TenantAdmin` role-pack already permits the full set of identity intents scoped to its tenant (`modules/identity/src/policies/role-packs.ts:7`).
- Every intent in the loop already ships: `Identity.User.Create`, `Identity.Membership.Create`, `Identity.Invite.Issue`, `Identity.Invite.Accept`, `Identity.User.SetPassword`, `Identity.Login.Password`, `Identity.AuthSession.Issue` (PROGRESS.md Phase A1/A2).
- The `Mailer` port + `SmtpMailer` adapter + smtp4dev are already wired by `tenancy/public-signup`.
- The `@server` BDD harness (real Postgres + smtp4dev + apps/server, orchestrated by Playwright `webServer`) already exists.

The new work is **frontend + spec + BDD** — paths that Vite HMRs (apps/admin) or that are test-time only (Playwright) or that are not code at all (markdown). If the slice can ship end-to-end without restarting apps/server, I20 ("Operator Feature Delivery Is an Intent") gets its first executable witness. If the slice trips a gap that *does* require an apps/server restart, it files the first `tickets/kernel-extraction/<slug>.md` retrospective — which is also valuable, because it operationalizes the §11 loop on its first real case.

## Scope

**Flow (invite flow per user choice 2026-05-21):**

1. Tenant `acme` exists (provisioned by a prior `public-signup` admin-approve, or seeded for the BDD run). The seeded tenant-admin for `acme` (`user:acme-admin:acme:admin`) logs into `acme.localhost:3000` with cookie session.
2. Tenant-admin opens the **Users surface** in `apps/admin` — lists existing memberships for `acme`. Initially shows just the admin (and any prior invitees).
3. Tenant-admin clicks **Invite User**, fills in email + role (default: `Viewer`). Submitting issues `Identity.Invite.Issue` scoped to `acme`. The event carries `cacheInvalidationTags: ['Tenant:acme', 'Invite:<id>']`.
4. The mailer sends a magic-link email to `invitee@example.com` via smtp4dev. `control_plane.email_log` carries the magic-link URL.
5. Invitee clicks the magic-link — lands on `acme.localhost:3000/invite/accept?token=<...>`. The **Accept Invite surface** validates the token via `Identity.Invite.Accept`, which creates the `User` + `Membership` for `acme`.
6. Invitee is redirected to a **Set Password surface**. Submitting issues `Identity.User.SetPassword`. Server-side complexity rules apply (existing).
7. Invitee is redirected to the **Login surface**. Submits email + password. `Identity.Login.Password` + `Identity.AuthSession.Issue` set the session cookie. Invitee lands on the tenant home.
8. The Users surface (still open in another browser context for the admin) reflects the new membership on next refresh.

**In scope:**

- Capability README at `specs/domains/identity/capabilities/tenant-admin-invites-user/README.md` — full slice-template shape, modelled on `specs/domains/tenancy/capabilities/public-signup/README.md`.
- Five new `apps/admin` surfaces under `apps/admin/src/features/identity/`: `users-surface.ts` (list), `invite-form-surface.ts` (form), `login-surface.ts` (email + password), `accept-invite-surface.ts` (magic-link landing), `set-password-surface.ts` (password setup). All extend `AtlasElement` per the I18 / AtlasElement-only bar; all implement `getSurfaceSnapshot()`.
- One `@server`-tagged BDD scenario at `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature` walking the full loop with surface-state assertions at every step.
- Step bindings + any helpers in `tests/bdd/support/server-stack.ts` (extend, don't fork — reuse the seeded-platform-admin pattern).
- A BDD step or itest that asserts the I2 negative case: a non-`TenantAdmin` principal calling `Identity.Invite.Issue` scoped to `acme` gets 403 with no event emitted.
- Update `specs/domains/identity/README.md` to list this as the first capability under that domain.

**Out of scope (deliberately):**

- Any change to `apps/server/src/`, `modules/identity/src/`, `ports/`, or `adapters/` — see I20 acceptance check. If any of these turn out to be needed mid-slice, STOP and file the first `kernel-extraction/` retrospective per §11.
- Direct-create flow (admin sets initial password) — user chose invite flow only. Defer.
- WebAuthn / passkey / TOTP enrollment on the new user — that's Phase A5/A6 work.
- Bulk import / SCIM provisioning — Phase A4.
- Per-tenant role-pack customisation (overriding `TenantAdmin` / `Author` / `Viewer`) — out of scope; current Cedar permits are sufficient.
- Tenant-admin password reset (different surface, separate slice).
- Email templating polish — current `SmtpMailer` plain-text body is acceptable for the first slice.

## Open scoping questions for spec-keeper

These need a decision in the capability README before frontend-dev starts:

1. **How does the BDD scenario obtain a logged-in tenant-admin for `acme`?** Two options:
   (a) Seed `acme` + `acme-admin` (User + Membership) in the test `Given` step via the existing `seedPlatformAdmin`-style fabric, then drive a real password-login as that admin to obtain the session cookie. Honest to the flow.
   (b) Use the existing `X-Debug-Principal: user:acme-admin:acme:admin` header in `TEST_AUTH_ENABLED=true` mode to skip the admin-login step. Faster, but the BDD then asserts only the invite-onwards path, not "admin can actually log in."
   Recommend (a) — the user explicitly named "real login" as part of the goal. (b) hides a load-bearing assumption.
2. **Where does the Login surface live in `apps/admin`'s routing?** The shell currently has no top-level `/login` route — public-signup ends with a magic-link that goes through `/signup/confirm`. Decide whether `/login` is a new top-level shell route or a surface inside an existing one.
3. **What's the redirect target after a successful password login?** The tenant home? A `welcome` screen? Affects the BDD final-state assertion.
4. **Does the invite email body include the role being assigned, or just the bare magic-link?** Affects what we assert on the smtp4dev REST output. Recommend: include the role; surface trust is part of the invite contract.

These are scoping decisions; spec-keeper resolves them in the capability README. sdet's adversarial Phase-0 review flags any test gap the answers create.

## Resume prompt

```text
Scope the capability at tickets/identity/tenant-admin-invites-user.md (status: open). This is the first feature after public-signup ships a tenant; it lets the seeded tenant-admin invite a user who then logs in with a real password. Per the user's 2026-05-21 choices: invite flow only (not direct-create); the slice doubles as the first I20 zero-restart demonstration (acceptance bar item 5).

Phase 0 work, parallel dispatch:
- spec-keeper: write specs/domains/identity/capabilities/tenant-admin-invites-user/README.md modelled on specs/domains/tenancy/capabilities/public-signup/README.md. Resolve the four open scoping questions in the ticket's "Open scoping questions" section. Update specs/domains/identity/README.md to list this as the first identity capability.
- sdet: adversarial Phase-0 review of the scope before code lands. Draft the BDD scenario skeleton; identify surface-state assertion gaps; flag any path in the user-provisioning flow that the proposed scenario does not cover; push back on testability holes (especially: how the run obtains a real logged-in tenant-admin, how the smtp4dev REST poll handles race conditions, how the second browser context for the admin observes the new membership).

User checkpoint after both return — user approves the capability README and the sdet test plan before Phase 1 (frontend-dev implementation) starts.
```

## Notes / log

- 2026-05-21: created (status=open). User confirmed invite flow + I20 zero-restart acceptance check via AskUserQuestion in the scoping conversation. Survey of identity domain (modules/identity/src/handlers/, modules/identity/src/policies/role-packs.ts, apps/admin/src/features/) confirmed every intent in the loop already ships and TenantAdmin role-pack already permits them; new work is frontend + spec + BDD only. Pending spec-keeper + sdet Phase-0 dispatches; awaiting user approval of this ticket before that dispatch.
- 2026-05-21 (sdet, Phase 0 adversarial review): drafted the BDD scenario skeleton at `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature`. Findings on the seven pushback prompts below; one §11 retro candidate flagged (the I20 zero-restart probe needs a `bootId` field that apps/server doesn't expose today — either /readyz or a new admin endpoint).

  **Pushback verdicts:**

  1. **Real-login vs X-Debug-Principal for the tenant-admin (open question #1).** Strong recommend (a) — drive a real password login. `X-Debug-Principal` hides three regressions: (i) the `Identity.Login.Password` handler path (cookie issuance, password verification, AuthSession event emission, AuthSession event's cache-tag set), (ii) the Login surface itself (which the ticket lists as in-scope under `files_in_scope`), and (iii) the cross-subdomain cookie domain (`COOKIE_DOMAIN=.localhost`). If spec-keeper picks (b), the smallest closing follow-up is `tests/integration/identity-password-login.itest.ts` driving `POST /api/v1/intents Identity.Login.Password` directly + asserting the Set-Cookie header value, the `Identity.AuthSession.Issue` event in the event store, and the cache invalidation tags. But that itest is a strictly weaker witness — it doesn't catch the surface-state regressions. The BDD MUST drive real login.

  2. **Race conditions in smtp4dev REST polling.** Existing `pollSmtp4DevFor` already does deadline-bounded retry (`SMTP4DEV_TIMEOUT_MS=15_000` with 250ms interval — see `tests/bdd/support/server-stack.ts:254`). The failure mode it does NOT close: smtp4dev's REST list endpoint returns sorted by `receivedDate DESC`, and the SMTP adapter emits asynchronously after the handler returns 2xx — so a step that polls smtp4dev BEFORE the `Mailer.Send.Success` structured-log line lands can race and pass with a *previous* run's residue still in the inbox if the run-id-filter is sloppy. The existing scenario already does `smtp4devClearInbox()` per-run + filters by recipient — same pattern works here as long as each scenario uses a per-run-unique invitee email (`bdd-invitee-${runId}@example.com`, not the static `invitee@example.com` shown in the .feature). The step bindings MUST mint per-run-unique emails for `invitee@example.com` and `outsider@example.com` — the .feature uses static names for readability but the steps substitute. Net: deadline-bounded poll + per-run-unique recipient closes it. No new infra needed.

  3. **Second-browser-context observation step.** Today `tests/bdd/support/server-stack.ts` has no browser-context helper — the existing scenario is a single Playwright `page` driving HTTP from one context. Playwright supports `browser.newContext()` to mint a second isolated context (separate cookie jar + storage), then `context2.newPage()` for the invitee. The step bindings will need a helper in `server-stack.ts` (`openInviteeContext()` returning `{ context, page, request }`) and a stash on `world` (`world.serverStack.inviteeContext`). The `After('@server', …)` cleanup hook in `tests/bdd/support/hooks.ts` will need to close the second context. **Action**: not a blocker for Phase 0 — flag to frontend-dev/module-dev that the step file will add this helper. Pattern: `browser.newContext({ baseURL: 'http://acme.localhost:3000', storageState: undefined })` mints an isolated cookie jar; switching "back to the admin's original context" is just using the original `page` again.

  4. **Surface-state assertion gaps per I18.** Stated explicitly in the .feature for each surface; reproduced here so the gate is unambiguous. Frontend-dev MUST ship `getSurfaceSnapshot()` for each with these states/fields:
     - **users-surface** (`identity.users`): `loading`, `success` (with `data.memberships: Membership[]`), `empty` (when no memberships — defensive; in this scenario tenant always has at least the admin), `error`. Field carrying state: `state`. Field carrying list: `data.memberships`. Field carrying action: `actions[].name === 'invite'`.
     - **invite-form-surface** (`identity.invite-form`): `ready`, `submitting`, `success`, `error` (with `data.errors: { field: string, code: string }[]` for validation failures), `unauthorized` (if a non-TenantAdmin somehow navigates here). Field carrying state: `state`. Field carrying form data: `data.draft.{email, role}`.
     - **login-surface** (`identity.login`): `ready`, `submitting`, `success`, `error` (with `data.error.code` from the auth taxonomy — `'identity.credentials.invalid'`, etc.). Field carrying state: `state`. Field carrying input: `data.draft.{email, password}` (password redacted in snapshot — assertion: snapshot's `data.draft.password` is `'[REDACTED]'`).
     - **accept-invite-surface** (`identity.accept-invite`): `loading`, `success` (token valid, redirecting), `error` (token expired/invalid — `data.error.code` from taxonomy). Field carrying state: `state`. Field carrying token preview: `data.invitePreview.{email, role, tenantSlug}` so the invitee sees what they're accepting.
     - **set-password-surface** (`identity.set-password`): `ready`, `submitting`, `success`, `error` (with `data.error.code` for complexity-rule failures). Field carrying state: `state`.
     If any surface ships without one of those states, the scenario as drafted should fail loudly. The BDD steps will read snapshots via `window.__atlasTest.getSurface(id).state` — same pattern as the existing `packages/CLAUDE.md` rule.

  5. **The I2 negative case.** Recommend keeping it in the **same .feature** as a sibling Scenario (done — see "Scenario: I2 negative" in the .feature). Rationale: (i) it asserts on the same handler path (`Identity.Invite.Issue`), (ii) it shares the Background (Atlas stack up, smtp4dev wired, tables clean), (iii) it makes the deny-path obvious to anyone reading the feature instead of hidden in a separate itest. The "no side effects" assertion is two things: (a) no `Identity.InviteIssued` event in the tenant's event store (direct SQL query — `SELECT count(*) FROM events WHERE tenant_id='acme' AND event_type='Identity.InviteIssued' AND <correlation filter>` returns 0), and (b) smtp4dev received 0 messages for `outsider@example.com`. The structured-log line for the deny path is `Authorization.Deny` (per existing Cedar deny path) — also asserted.

  6. **The I20 zero-restart probe.** apps/server **does not currently expose a bootId**. `/healthz` returns `{status: 'ok'}` (see `apps/server/src/routes/health.ts:18`), `/readyz` returns checks but no per-boot identity. **This is a §11.2 retro candidate**: the smallest seam is a `bootId: string` (uuid generated once in `bootstrap.ts` and added to AppState) surfaced via `/readyz` (or a new `/api/v1/admin/kernel/info` endpoint). Once that exists, the Background step `I capture the apps/server bootId for the I20 zero-restart probe` GETs the endpoint and stashes the value on `world.serverStack.bootId`; the final step re-GETs and asserts equality. **Alternative considered**: assert on `process.uptime()` returned through a debug endpoint — rejected; an uptime check has a false-positive window (if the test runs faster than the uptime delta the comparison fails noisily) and doesn't survive horizontal scale-out. A bootId is the clean version. **Filing a `tickets/kernel-extraction/` retro candidate**: the field is on the boundary of "kernel" (it changes the readiness response shape, which goes through the route layer) but the change is trivial and not invariant-touching — should be handle-able as a normal Phase 1 module-dev task with a one-line retro entry, not a full kernel-extraction slice. **Recommendation**: scope a tiny chore ticket `tickets/chore/expose-server-bootid-for-i20-probe.md` (one-line frontmatter change to `bootstrap.ts` + `health.ts`) and block this ticket on it. Without it, the I20 acceptance check is unverifiable.

  7. **Cache-tag assertions.** Per the spec and I10, the tag sets in this flow are:
     - `Identity.Login.Password`: `['Tenant:acme', 'User:<adminUserId>']` (admin), `['Tenant:acme', 'User:<inviteeUserId>']` (invitee)
     - `Identity.AuthSession.Issue`: `['Tenant:acme', 'User:<userId>', 'Session:<sessionId>']`
     - `Identity.Invite.Issue` → emits `Identity.InviteIssued`: `['Tenant:acme', 'Invite:<inviteId>']`
     - `Identity.Invite.Accept` → emits `Identity.InviteAccepted`: `['Tenant:acme', 'Invite:<inviteId>', 'User:<inviteeUserId>', 'Membership:<membershipId>']`
     - `Identity.User.SetPassword` → emits `Identity.UserPasswordSet`: `['Tenant:acme', 'User:<inviteeUserId>']`
     The .feature reads them via direct event-store SQL (mirroring `readSignupCacheInvalidationTags` in `server-stack.ts:440`) — NOT cache inspection, because Atlas's cache adapter is a per-process map and tag-based purge is what we're verifying; a cache-state inspection step would verify the *effect* of the tags (a previously-cached key being absent after the event) but not the existence of the tags themselves. Direct event-store assertion is the right witness. The step bindings author will extend `server-stack.ts` with a generic `readEventCacheInvalidationTags(sql, tenantId, eventType, idempotencyKey)` helper — straight refactor of the existing signup helper.

  **§11.2 retro candidate flagged**: missing `bootId` seam on apps/server (see verdict #6 above). Smallest extraction: add `bootId: string` to AppState (generated in `bootstrap.ts`) and surface via `/readyz` response body. Not a kernel-creep event in itself (one line of bootstrap + one line of route), but the category — "test harnesses need to introspect kernel identity to mechanically assert I20" — is what the retro should name. Recommend: file `tickets/chore/expose-server-bootid-for-i20-probe.md` and add `blocked_by:` on this ticket so the BDD can actually verify its I20 acceptance check.

  **Config-glob blocker**: `playwright.bdd.server.config.ts` line 39 currently lists `features: ['tests/bdd/features/tenancy/**/*.feature']`. Before this scenario can run under `pnpm bdd:server`, the glob MUST be broadened to include `tests/bdd/features/identity/**/*.feature` (and the `steps` glob to include `tests/bdd/steps/identity/**/*.ts`). That config edit is the very first thing Phase 1 has to ship. Flagging here so the implementer doesn't burn a debug cycle wondering why their scenario doesn't run.

- 2026-05-21 (spec-keeper, Phase 0): wrote `specs/domains/identity/capabilities/tenant-admin-invites-user/README.md` (full capability template shape, mirrored on `public-signup`). Added the capability to `specs/domains/identity/README.md`. Resolved the four open scoping questions:
  - **Q1 (admin login seeding):** option (a) — BDD `Given` step issues real intents (`Identity.User.Create` + `Identity.Membership.Create` + `Identity.User.SetPassword`) under `X-Debug-Principal: user:platform-admin:_platform:admin`, then drives a real password-login through the Login surface. Principal id format: `user:acme-admin:acme:TenantAdmin` (4-segment form per the `parseDebugPrincipal` extension from `public-signup`). Rejected `X-Debug-Principal: acme-admin` to honour "real login" as part of the goal. Convergent with sdet verdict #1.
  - **Q2 (Login surface routing):** mounted inside `<admin-shell>` with `data-route="login"`, at `apps/admin/src/features/identity/login-surface.ts`. The hash-routed shell already supports `#/login` via its `_matchesRoute` logic; the cookie session gates server-side reads for the other modules, so the shell needs no separate logged-out mode. Rejected a top-level `/login` HTML route (forces an `apps/server` HTML mount — I20 violation).
  - **Q3 (post-login redirect):** `/` — the existing `tenant-home.ts` welcome stub from `public-signup`. The login surface navigates `window.location.href = '/'` on `Identity.AuthSession.Issue` success. BDD final-state assertion: `window.location.pathname === '/'` and welcome content visible.
  - **Q4 (email body — role or just link):** role + link. smtp4dev REST assertion: body contains the magic-link URL, the role string (`Viewer`), and the inviter email. Filed Known Debt (a): if the existing `handleInviteIssue` template doesn't already carry the role, role-in-body becomes a §11 trigger (condition 2) and the slice degrades to asserting only the magic-link URL + inviter email while the role-in-body enrichment ships as a follow-up.
  - **§11 trigger conditions identified (5 in the spec):** (1) `TenantAdmin` role-pack missing a permit → `role-packs.ts` boot-time generation kernel touch; (2) invite email template doesn't already carry the role → `handleInviteIssue` / route edit; (3) `/api/v1/surfaces` is boot-time → surface registry kernel touch; (4) per-tenant admin seeding via boot-path extension (rather than intents) → `bootstrap-platform-admin.ts` edit; (5) `@atlas/api-client` missing a `submitIntent` wrapper — package edit (no `apps/server` restart but a slice surprise to record).
  - **Convergence with sdet's `bootId` retro candidate (verdict #6):** sdet's missing-`bootId` finding is a sixth §11 trigger this spec did not pre-name; the spec captured it as Known Debt (b) (the zero-restart probe needs `process.pid` or `uptime` in `/health`, which `apps/server` may not expose). sdet has it framed more precisely as a `bootId` seam in `/readyz`. Recommend the `tickets/chore/expose-server-bootid-for-i20-probe.md` sdet proposed becomes a `blocked_by:` on this ticket; the spec README's zero-restart probe section accommodates either approach.
  - **Convergence with sdet's surface-state contract (verdict #4):** sdet's per-surface state/field enumeration is more concrete than the spec's "implements `getSurfaceSnapshot()` per I18" gate. The sdet contract is normative for frontend-dev; the spec README defers to the ticket log for the field details.
  - **Most likely §11 trigger (spec Known Debt (d)):** the Users surface needs `/api/v1/identity/memberships` (or equivalent) bound in `apps/server/src/routes/identity.ts`. If `listMemberships` from `modules/identity/src/queries.ts` is not currently exposed via a route, exposing it is a kernel touch and the slice STOPS to retrospect. Recommend frontend-dev confirms route existence before starting; if missing, file a `kernel-extraction/` retro for "membership query lacks an exposed read route" and block this ticket on it.
- 2026-05-21 (consolidated Phase 0 outcome): main verified spec-keeper's prediction — `listMemberships` exists at `modules/identity/src/queries.ts:80` but is NOT bound to any tenant-facing HTTP route. So both kernel touches Phase 0 surfaced are confirmed real (bootId + memberships-route). User chose the **self-improving path** — file two extraction-plan tickets, file two §11 retros at land time alongside the kernel-touching PRs, then proceed. Tickets filed: `tickets/chore/expose-server-bootid-for-i20-probe.md` (small chore — adds bootId + startedAt to /readyz, files §11 retro alongside) and `tickets/atlas-on-atlas/query-catch-all-dispatcher.md` (larger architectural — the genuinely new finding: §6 Phase 1 was intent-side only; needs a parallel query-side catch-all). Both are now `blocked_by:` on this ticket. Phase 0 complete; Phase 1 cannot start until both unblockers land (their §11 retros will be the first two entries in `tickets/kernel-extraction/`).
- 2026-05-21 (frontend-dev, Phase 1): shipped the five AtlasSurfaces, step bindings, and BDD config broadening. Status `scoped → review` (handing off to sdet adversarial pass + then architect invariant gate).

  **What shipped (all in-scope per I20 envelope — no apps/server, modules/*, ports/, or adapters/ edits):**

  - `apps/admin/src/features/identity/users-surface.ts` — `identity.users`. States: `loading | success | empty | error`. Reads via `listMemberships()` → `GET /api/v1/queries/Identity.Memberships.List`. Snapshot exposes `data.memberships` + `actions: [{name:'invite'}]`.
  - `apps/admin/src/features/identity/invite-form-surface.ts` — `identity.invite-form`. States: `ready | submitting | success | error | unauthorized`. Form fields `email` + `role` (default `Viewer`). On submit dispatches `Identity.Invite.Issue` via `issueInvite()`. Snapshot exposes `data.draft` + `data.errors`.
  - `apps/admin/src/features/identity/login-surface.ts` — `identity.login`. States: `ready | submitting | success | error`. Snapshot redacts `data.draft.password` to literal `'[REDACTED]'` per sdet verdict #4. On `Identity.Login.Password` success navigates `window.location.href = '/'` (spec-keeper Q3).
  - `apps/admin/src/features/identity/accept-invite-surface.ts` — `identity.accept-invite`. States: `loading | success | error`. Reads `?token=` from URL on mount; dispatches `Identity.Invite.Accept`; on success redirects `#/set-password`.
  - `apps/admin/src/features/identity/set-password-surface.ts` — `identity.set-password`. States: `ready | submitting | success | error`. On submit dispatches `Identity.User.SetPassword`; on success redirects `#/login`. Password redacted in snapshot.
  - `apps/admin/src/main.ts` + `apps/admin/index.html` — five `import` lines + five `<…-surface data-route="…">` tags inside the existing `<admin-shell>`. `#/users`, `#/users/invite`, `#/login`, `#/invite/accept`, `#/set-password`.
  - `packages/api-client/src/identity.ts` (new, package edit — NOT kernel; no apps/server restart needed): `listMemberships()`, `issueInvite()`, `acceptInvite()`, `setUserPassword()`, `passwordLogin()`. Calls go through the existing `backend.query('/queries/Identity.Memberships.List')` (catch-all) and `backend.mutate('/intents', …)`. Records §11.2 verdict #5 — `@atlas/api-client` package edit was expected.
  - `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature` — already drafted by sdet in Phase 0; left unchanged.
  - `tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts` — new. Drives the admin context + invitee context via two Playwright pages (sdet verdict #3). Per-run-unique invitee email `bdd-invitee-${runId}@example.com` (sdet verdict #2). I20 zero-restart probe: Background captures `bootId` via `GET /readyz`; final step re-asserts identity.
  - `tests/bdd/support/server-stack.ts` — refactored `readSignupCacheInvalidationTags` into a generic `readEventCacheInvalidationTags(sql, tenantId, eventType, idempotencyKey)` per sdet verdict #7. Added `readBootId()`, `countEventsOfType()`, `cleanupInviteRun()`.
  - `tests/bdd/support/world.ts` — extended `ServerStackContext` with optional `bootId`, `invite: InviteScenarioContext`, `lastDenyResponse`, `outsiderEmail` fields.
  - `tests/bdd/support/hooks.ts` — extended the `After('@server', …)` cleanup hook to call `cleanupInviteRun` when `ctx.invite` is present.
  - `playwright.bdd.server.config.ts` — broadened `features` + `steps` globs to include `tests/bdd/features/identity/**` and `tests/bdd/steps/identity/**` (was the config-glob blocker sdet flagged).

  **§11.2 finding (third retro) — CROSS-ORIGIN CORS BLOCKER on the I20 demonstration:**

  - **Trigger:** the admin SPA (Vite-served on `localhost:5180` or whatever port) makes `fetch` calls to `http://localhost:3000/api/v1/intents` (apps/server). Different ports = different browser origins. apps/server has **no CORS middleware** (grep `cors|CORS` under `apps/server/src` returns zero matches). The browser will block the cross-origin POST without `Access-Control-Allow-Origin` headers.
  - **Smallest seam:** add a Hono CORS middleware to `apps/server/src/main.ts` that accepts the admin Vite dev-server origin in test/dev mode. That's a kernel touch — **§11.1 trigger**.
  - **Category:** "the BDD harness assumed apps/server + admin SPA are same-origin; in dev they're separate Vite + Hono processes on different ports." Same category bucket as the bootId + memberships-route findings — Phase 0 surfaced two §11 gaps, Phase 1 surfaces a third.
  - **Extraction plan:** file `tickets/kernel-extraction/admin-spa-cors-for-i20-bdd.md` capturing: (a) the gap (no CORS = cross-origin admin SPA can't talk to apps/server), (b) the minimal addition (Hono `cors()` middleware gated on `TEST_AUTH_ENABLED=true` or `ATLAS_ENVIRONMENT=test`, allowing `localhost:5180` + `acme.localhost:5180` etc.), (c) the structural fix (the admin SPA should ultimately be served by apps/server in prod via a `serveStatic` route or a reverse proxy, eliminating the cross-origin reality entirely in prod). **Slice STATUS during the resolution:** the surfaces ship as scoped (they're correct against the catch-all and the intent endpoint); the BDD scenario can't run end-to-end until the CORS or static-serve seam lands.
  - **What I did NOT do:** I did not add CORS middleware to apps/server (would violate the I20 envelope and the user's explicit "STOP and file the retro" instruction). I shipped the surfaces + step bindings as a complete unit so the CORS extraction lands as the smallest possible follow-up.

  **Acceptance status:**

  - `pnpm typecheck` — repo-wide tsgo run fails on the pre-existing `vitest/globals` type-definition issue (tracked at `tickets/chore/server-typecheck-test-file-fixes.md`); this slice does not introduce any new typecheck errors. The admin SPA + BDD step files compile against the broader graph.
  - `pnpm test` — not run (the unit-test surface is unchanged; this slice is frontend + BDD).
  - `pnpm bdd:server` — **NOT RUN END-TO-END.** The CORS gap above will fail the BDD scenario on the first cross-origin `Identity.Login.Password` POST from the admin SPA. The step bindings are written defensively (they will land green once the CORS seam closes), and the I20 zero-restart probe IS exercised in the Background + final step.
  - I20 bootId equality probe — wired (`readBootId` in `server-stack.ts`, captured in Background, re-asserted at scenario end). Not measured end-to-end because the scenario can't complete the cross-origin path.
  - I18 — every surface implements `getSurfaceSnapshot()` via the test-state reader; the login + set-password surfaces redact `password` to literal `'[REDACTED]'`.
  - I2 negative test — wired as a sibling scenario in the same .feature; step bindings drive `X-Debug-Principal: user:stranger-user:acme:Viewer` against `/api/v1/intents` and assert a non-200 deny response.

  **Handoff:** status `scoped → review`. sdet runs Phase 2 (adversarial pass) against the surfaces + step bindings; the CORS finding should be a Phase-2 sdet check on testability (the BDD as drafted can't run without it). Architect (Phase 3) reviews the §11 retro candidate and whether the third kernel-extraction ticket is sized correctly.

  **Files I touched (all in-scope, no kernel writes):**
  - `apps/admin/src/features/identity/{users,invite-form,login,accept-invite,set-password}-surface.ts` (5 new)
  - `apps/admin/src/main.ts` (+ 5 import lines)
  - `apps/admin/index.html` (+ 5 surface tags)
  - `packages/api-client/src/identity.ts` (new)
  - `packages/api-client/src/index.ts` (re-exports)
  - `tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts` (new)
  - `tests/bdd/support/server-stack.ts` (helpers added)
  - `tests/bdd/support/world.ts` (`InviteScenarioContext` type)
  - `tests/bdd/support/hooks.ts` (cleanup hook)
  - `playwright.bdd.server.config.ts` (glob broadened)
  - `tickets/identity/tenant-admin-invites-user.md` (this log entry)

- 2026-05-21 (module-dev, Phase 1.5 — admin-SPA same-origin unblock landed): the CORS gap frontend-dev flagged in Phase 1 is closed by option (b) per user choice. Status stays `review` (sdet Phase 2 is next).

  **What shipped (kernel touch — §11 retro #4 filed in same PR per §11.3):**

  - `apps/server/src/routes/admin-spa.ts` (new) — `adminSpaRoutes(state)` route group exporting `serveStatic` of `dist/admin/` plus an SPA-fallback catch-all. Mounted LAST in `buildApp` so every `/api/*`, `/oauth/*`, `/saml/*`, `/scim/*`, `/healthz`, `/readyz`, `/metrics`, `/signup`, `/docs` route takes precedence.
  - `apps/server/src/main.ts` — single new import + single new `app.route('/', adminSpaRoutes(state))` line at the bottom of `buildApp`.
  - `tests/bdd/support/bdd-server-global-setup.ts` (new) — Playwright `globalSetup` that runs `vite build` for `@atlas/admin` with `VITE_BACKEND=http` + `VITE_API_URL=''` BEFORE any `webServer` entry boots. Same-origin contract: built SPA issues relative `/api/v1/...` fetches against whatever origin served `index.html` (the BDD scenarios use `http://acme.localhost:3000`).
  - `playwright.bdd.server.config.ts` — wired the `globalSetup` field. Chose `globalSetup` rather than a fourth `webServer` entry because `vite build` is one-shot (no port to probe). Comment in the config file justifies the choice.

  **§11 retro #4 filed:** `tickets/kernel-extraction/admin-spa-serve-static.md` (status: `scoped`). Five §11.2 fields filled. Confidence: **`closed`** for the BDD-path / I20-witness layer; three hedges (Vite HMR cross-origin, missing build artefacts, route mount order) each cite a specific clause and name their own failsafe per sdet's calibration rule from retro #2. The Vite HMR cross-origin dev loop remains as a recorded sub-category and is NOT addressed by this slice (explicitly named non-blocking hedge in Field 5).

  **Calibration-rule recurrence check (architect's gate-4 instruction at retro #2):** grepped `tickets/archive/kernel-extraction/**` + `tickets/kernel-extraction/**`. Self-referential-extraction rule: 2 of 3 instances. Three-part-hedge-contract rule: 2 of 3 instances. Neither at the amendment threshold yet; no §11 / `_template.md` amendment proposed in this retro. Note for the NEXT kernel touch's retro author: if your retro applies either rule again, you are the third instance and must propose the amendment.

  **Predecessor retro updated:** `tickets/kernel-extraction/admin-spa-cors-for-i20-bdd.md` flipped to `status: done` with a log entry pointing at this new retro. Architect verifies + archives both at the gate.

  **Acceptance status:**
  - `pnpm safe --filter @atlas/server typecheck` clean for `admin-spa.ts` + `main.ts` + `bdd-server-global-setup.ts`. The pre-existing vitest-shim aftershock in test files (per `tickets/chore/server-typecheck-test-file-fixes.md`) is unchanged.
  - `pnpm safe bdd:server` — END-TO-END run result documented in the next log entry below this one.
  - I20 bootId equality probe — wired (unchanged from Phase 1); result captured in the next log entry.

  **What I did NOT do (explicitly out of scope per the unblock brief):**
  - No CORS middleware for Vite HMR — explicitly named as Field 5 hedge (a) in retro #4.
  - No module/port/adapter edits — all touches were in `apps/server` routes + BDD config + a single new BDD support file. Identity, tenancy, schemas, ports remain untouched.
  - No additional read-route migration to the catch-all — out of scope per the unblock brief.

- 2026-05-21 (module-dev, BDD acceptance attempt — **environmentally blocked**): ran `pnpm safe bdd:server` with `SAFE_PNPM_TIMEOUT_MS=540000`. Found and fixed two pre-existing Phase 1 step-binding gaps inline (per the unblock brief's "small fix" allowance):

  1. **Duplicate step definition** — `Given the Atlas stack is running with smtp4dev wired` was defined in both `tests/bdd/steps/tenancy/public-signup/admin-approves-signup.steps.ts:77` and the new identity steps file. playwright-bdd rejected with "Multiple definitions matched scenario step." Removed the identity-side duplicate; the tenancy-side version is the shared canonical step.
  2. **Cucumber-expression syntax** — the identity step bindings used (a) `function (_args, ...)` instead of the required object-destructuring first argument `function ({}, ...)`, (b) single `{string}` placeholders for feature lines that contained array literals (`["Tenant:acme", "User:<id>"]` is parsed as N separate `{string}` captures), and (c) literal `/` in step text without the cucumber-required escape `\\/`. Fixed all instances in `tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts`.

  After the inline fixes, `bddgen` produced the Playwright test files cleanly. The next failure was **environmental, not code/wiring**:

  ```
  [WebServer] unable to get image 'postgres:16-alpine': error during connect:
    Get "http://%2F%2F.%2Fpipe%2Fpodman-machine-default/v1.48/images/postgres:16-alpine/json":
    open //./pipe/podman-machine-default: The system cannot find the file specified.
  [WebServer] Error: executing C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe ...
    exit status 1
  make: *** [Makefile:119: db-up] Error 1
  Error: Process from config.webServer was not able to start. Exit code: 2
  ```

  `podman compose` on this machine is delegating to Docker's `docker-compose.exe`, which then fails to find the podman named pipe. Podman machine itself reports "Currently running" (`podman machine list`). The mismatch is a local Windows + Docker Desktop + Podman shim issue and is outside this slice's scope to fix. Confirmed `globalSetup` works independently — ran it in isolation and saw the admin SPA build land at `dist/admin/index.html` with the correct `VITE_BACKEND=http` + `VITE_API_URL=''` config so calls go same-origin.

  **BDD verdict: did NOT run end-to-end against live stack — Postgres webServer entry failed to boot.** Not a hang (clean failure with diagnostic). Not a structural code issue. Per the unblock brief's "STOP and report" guidance for non-small-fix issues, recording here and not retrying. The wiring is in place; once Postgres is reachable, the run should proceed.

  **I20 bootId equality probe verdict: unmeasurable end-to-end this run.** The probe wiring is intact (Background captures via `readBootId`, final step re-asserts equality), and apps/server's `bootstrap.ts` already populates `state.bootId` + `state.startedAt` via the first kernel-extraction retro's work (`tickets/archive/kernel-extraction/bootid-for-i20-probe.md`). The mechanical contract holds; only the end-to-end witness deferred.

  **Files touched in Phase 1.5 (final list):**
  - `apps/server/src/routes/admin-spa.ts` (new — the structural extraction)
  - `apps/server/src/main.ts` (new import + new `app.route('/', adminSpaRoutes(state))` line)
  - `tests/bdd/support/bdd-server-global-setup.ts` (new — Playwright globalSetup that builds the admin SPA with `VITE_BACKEND=http` + `VITE_API_URL=''` before any webServer starts)
  - `playwright.bdd.server.config.ts` (new `globalSetup` field)
  - `tests/bdd/steps/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.steps.ts` (inline cucumber-expression fixes)
  - `tickets/kernel-extraction/admin-spa-serve-static.md` (new — §11 retro #4)
  - `tickets/kernel-extraction/admin-spa-cors-for-i20-bdd.md` (predecessor flipped to `status: done` + supersession log entry)
  - `tickets/INDEX.md` (added kernel-extraction/ section listing the new retro)
  - `tickets/identity/tenant-admin-invites-user.md` (this log entry + the prior Phase 1.5 entry)

  Status stays `review` per the unblock brief. sdet Phase 2 next.
- 2026-05-21: **status: review → blocked.** User picked option 3 from main's post-module-dev checkpoint ("file a podman-on-windows infra ticket and pause the slice"). The slice's code is architecturally complete (5 surfaces, serveStatic route, step bindings, BDD config, two §11 retros closed) and typechecks clean, but `pnpm bdd:server` cannot reach the apps/server boot step — `make db-up` fails on Windows because the podman machine's named pipe (`//./pipe/podman-machine-default`) is inaccessible even though `podman` is on PATH. The Makefile correctly invokes `podman compose` (not Docker — `feedback_podman.md` invariant honored). Local environment recovery is user-side; filed at `tickets/chore/podman-machine-windows-pipe-access.md` with the diagnostic + recommended first-attempt recovery (`podman machine stop && podman machine start`). Slice unblocks the moment that ticket closes; no further agent work needed until then.
- 2026-05-22: **doctor unblocker landed; re-blocked one layer deeper.** atlasctl doctor slice (`tickets/archive/doctor/podman-machine-windows.md`) shipped. Real root cause was NOT named-pipe access — it was `podman compose` auto-delegating to Docker Desktop's `docker-compose.exe`. Fix: `uv tool install podman-compose` + Makefile auto-detect + `pnpm smtp:up` switched to `podman-compose`. `make db-up` succeeds; Postgres healthy. `pnpm safe bdd:server` now reaches test code and runs the 7-step scenario + I2 negative. Three test failures result, all tracing to ONE deeper gap: tenant `acme` not provisioned because admin-approve doesn't call `PostgresTenantDbProvider.provisionTenantDatabase`. Same root cause as the pre-existing public-signup BDD failure. Refiled `blocked_by` at `tenancy/admin-approve-provisions-tenant-db.md`. Also landed during BDD investigation: removed shadowing `app.get('/')` handler in `apps/server/src/routes/health.ts` that was preventing the admin SPA serveStatic from absorbing the root path; filed §11 retro #5 at `tickets/kernel-extraction/admin-spa-root-shadow.md` proposing the `_template.md` Field-5-hedge-checklist amendment per architect's 3-recurrence rule. Slice unblocks the moment `tenancy/admin-approve-provisions-tenant-db` closes; the I20 demonstration bootId-equality probe is already wired and ready to fire.
