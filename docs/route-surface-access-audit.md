# Route/Surface Access Audit

Investigation pass — no code changes proposed in this document beyond the
audit itself. All claims reference concrete files. Date snapshot: 2026-05-05.

## Current routing structure

There is one HTTP boundary (Invariant **I1**, [`specs/architecture.md:118`](../specs/architecture.md)).

- Server entry that builds the Hono app — `apps/server/src/main.ts:35-75`.
- Routes are declared as **factory exports** under `apps/server/src/routes/`,
  one file per route group:
  - `apps/server/src/routes/health.ts` — `/`, `/healthz`, `/readyz`
  - `apps/server/src/routes/metrics.ts`
  - `apps/server/src/routes/identity.ts` — `identityRoutes(state)` (invite
    accept, session refresh, session logout) AND `identityAuthedRoutes(state)`
    (sessions list, session revoke). Two factories from the same file.
  - `apps/server/src/routes/identity-idp.ts`
  - `apps/server/src/routes/oauth.ts`
  - `apps/server/src/routes/saml.ts`
  - `apps/server/src/routes/scim.ts`
  - `apps/server/src/routes/intents.ts` — `POST /api/v1/intents`
  - `apps/server/src/routes/catalog.ts`
  - `apps/server/src/routes/authz.ts`
  - `apps/server/src/routes/content-pages.ts`
  - `apps/server/src/routes/events.ts`
  - `apps/server/src/routes/mfa.ts`
  - `apps/server/src/routes/debug.ts`
- Mounting in `main.ts` is **two anonymous groups**:
  - “Public” group (no principal middleware) — `main.ts:38-56`: health, metrics,
    identity (public flows), oauth, scim, saml.
  - “Authenticated” group — `main.ts:59-72`: a sub-Hono with
    `principalMiddleware(state)` applied, then intents, catalog, authz,
    content-pages, events, identity-authed, identity-idp, mfa, and (gated by
    `state.config.testAuth.*`) debug.
- There is **no declarative routing table** and **no route-level access
  attribute**. The split between public and authed is encoded only by which
  variable a `app.route('/', ...)` call appends to (`app` vs `authed`).
- No file-path routing convention. Each handler is wired explicitly in Hono
  (`apps/server/CLAUDE.md:80-86`).

Frontend routing (separate concept — these are SPA shell hash routes, not
HTTP routes):

- `apps/admin/src/shell/AdminShell.ts:10-20` — hardcoded `MODULES` list,
  hash-based dispatch, child elements with `data-route` attributes
  (`AdminShell.ts:265-309`).
- `apps/authoring/src/authoring-app.ts:19-24` — `ROUTES[]` array, `history.pushState`.
- `apps/sandbox/src/sandbox-app.ts` — registry-driven sidebar (per
  `apps/CLAUDE.md:53-58`).

Frontend SPAs all extend `AtlasSurface` for their shell and route to child
custom elements. None of the three frontends declares route-level auth.

The module manifest schema *does* define `uiRoute` declarations but they are
empty in practice:

- Schema: `specs/schemas/contracts/module_manifest.schema.json` (`uiRoute`
  block — `routeId`, `path`, `componentId`, `navLabel`,
  `requiredCapabilities`). **No `accessMode` field.**
- TypeScript mirror: `packages/platform-core/src/manifest.ts:46-49`
  (`UiRouteDeclaration { path, component }`).
- All three concrete manifests under `specs/domains/.../module.manifest.json`
  carry `"uiRoutes": []`.

## Current surface/page model

Yes — Atlas has a surface abstraction at the frontend layer.

- Base class `AtlasSurface` in `packages/core/src/component.ts` (extends
  `AtlasElement`). Documented in `packages/core/CLAUDE.md:86-129`.
- A surface owns `SurfaceState` (`loading | empty | success | error |
  unauthorized`) and provides `surfaceId` to descendants for stable test IDs.
- The `unauthorized` state already exists conceptually
  (`packages/core/CLAUDE.md:88` — `SurfaceState`).
- Surface contract spec — `specs/frontend/surface-contract.md:54-58`. Already
  defines an `AuthSpec`:
  ```
  AuthSpec { required: boolean; roles: string[]; permissions: string[] }
  ```
  This exists as a spec field; it is **not enforced anywhere in code today**
  and not present in any concrete manifest.
- Surface contract examples are listed in
  `specs/frontend/access-control-planning.md:60-78` (`admin.access.*`).

There is **no server-side surface concept**. On the backend a "surface" is
not a runtime entity; it is a frontend term used by the test harness
(`@atlas/test-state`, `packages/CLAUDE.md` "Reading surface state from BDD
steps"). HTTP routes do not currently have a notion of "this route belongs to
surface X".

## Current authn/authz flow

- AuthN: `apps/server/src/middleware/principal.ts:304-615` —
  `principalMiddleware(state)`. Order:
  1. Resolve `hostTenantId` from Host header
     (`principal.ts:322-327` → `tenant-resolution.ts:85-101`).
  2. Cookie session if no bearer (`principal.ts:336-378`).
  3. `X-Debug-Principal` header — only when `TEST_AUTH_ENABLED=true`
     (`principal.ts:381-413`).
  4. Bearer schemes (ApiKey / AuthSession access token / OAuth access token)
     in `tryBearerSchemes` (`principal.ts:145-229`).
  5. JWT fallback — per-tenant IDP-driven via `findActiveProviderByIssuer`,
     legacy global JWKS as a backstop (`principal.ts:432-571`).
- The middleware always sets `c.set('principal', ...)` on success and emits
  `errorResponse(c, 'PRINCIPAL_INVALID', ..., 401|403, correlationId)` on
  failure. There is no “anonymous principal” branch — the absence of a valid
  credential always produces 401/403.

- AuthZ for **writes** runs inside the ingress pipeline:
  - Single chokepoint at `packages/ingress/src/submit-intent.ts:262-277`
    (`policyEngine.evaluate(...)`).
  - Order: tenant scope check (`submit-intent.ts:148-151`) → schema validation
    → idempotency → action lookup → policy evaluate → handler dispatch
    (`submit-intent.ts:142-280`).
  - This is where Invariants **I2** (authz before execution) and **I4**
    (deny-overrides-allow) live in code.
  - Engine is wired in `apps/server/src/middleware/state.ts:172-218`
    (Cedar via `@atlas/adapter-policy-cedar` or stub via
    `@atlas/adapter-policy-stub`).
- AuthZ for **reads** is per-route opt-in via
  `packages/ingress/src/evaluate-read.ts:28-65`. There is NO middleware that
  forces every query route to call `evaluateRead` — `specs/lifecycle.md:131`
  flags this explicitly: *"Reads check authz only when the route calls a
  checkXRead helper."*
- No HTTP-route-level authorization. There is no `RequirePermission(...)`
  decorator and no per-route policy declaration.

## Current tenant resolution behavior

- Host-based resolver: `apps/server/src/middleware/tenant-resolution.ts:85-101`
  (`resolveHostTenant`). Backed by the `CustomDomainStore` port and a 60s
  positive+negative TTL cache (`tenant-resolution.ts:33-72`).
- The resolver is invoked **only** from inside `principalMiddleware`
  (`principal.ts:322-327`). `c.set('hostTenantId', ...)` happens there.
- Routes mounted in the **public** group never run principal middleware, so
  for them `c.get('hostTenantId')` is `undefined` unless the route reads it
  manually. `apps/server/src/routes/identity.ts:233-234` shows this fragility
  — it falls back to a `tenantId` query param when there is no host match
  and a comment flags it for cleanup ("Phase A2.10 wires this cleanly; for
  now we accept a `tenantId` query param as fallback").
- Tenant resolution is otherwise **driven from the JWT `tenant_id` claim**
  with a host-vs-claim cross-check
  (`principal.ts:585-598` — “Tenant scope mismatch between Host and JWT
  tenant_id claim” → 403).
- Tenant validation `isValidTenantId` (`principal.ts:67-72`) bounds the
  format. Invariants **I7** and **I9** assume the value is well-formed.
- A request that has neither Host-derived tenant nor JWT-claim tenant nor
  configured `state.config.tenantId` flows through; downstream code that
  needs a tenant errors out at first use.

There is no single "tenant resolution" middleware that runs ahead of route
handlers regardless of access mode. Today, tenant context resolution and
principal resolution are entangled in one middleware.

## Current public/anonymous behavior

Anonymous requests are supported only by **case-by-case mounting in the
public group** at `apps/server/src/main.ts:38-56`. Each public route handles
its own discipline:

- `healthRoutes` — wholly public, takes no input.
- `metricsRoutes` — public; `apps/server/src/main.ts:42` notes the assumption
  that Prometheus scrapes from inside the cluster perimeter.
- `identityRoutes` — `POST /api/v1/identity/invite/accept` is public because
  *the invite token is the auth* (`apps/server/src/routes/identity.ts:1-18`).
  The route reads `tenantId` from the request body and self-validates via
  `ensureTenantMigrated` (`identity.ts:121-132`).
- `oauthRoutes` — public; auth is `client_id`+`client_secret` in the body
  per RFC 6749 (`apps/server/src/routes/oauth.ts:11-20`).
- `samlRoutes` — public; the IdP signature on the ACS POST is the auth
  (`apps/server/src/routes/saml.ts:8-10`).
- `scimRoutes` — public mount, but the file applies its own
  `scimAuthMiddleware` on `/scim/v2/*`
  (`apps/server/src/routes/scim.ts:105`).

There is **no first-class "anonymous principal"**. The principal middleware
treats absence of a credential as a hard 401
(`principal.ts:438-457`). The `parseDebugPrincipal` parser does accept
`type=anonymous` (`principal.ts:51, 88-101`), but only when
`TEST_AUTH_ENABLED=true` AND the operator passes the header explicitly. So
anonymous-as-a-mode is technically wired for tests; in production it is not
reachable.

So the answer to "are anonymous requests supported, rejected, or
inconsistent?" is: **inconsistent**. Each public route is its own bypass
with its own implicit auth model. Anything that should be reachable
anonymously today must be added to the hand-mounted public group; nothing
checks that those routes also handle tenant resolution, idempotency, or
audit consistently.

## Best insertion point

**Introduce a single `AccessMode` type in `@atlas/platform-core`, applied
per-route at mount time in `apps/server/src/main.ts`, enforced by one new
middleware (`apps/server/src/middleware/access-mode.ts`) that owns the
`{ tenant resolution, principal resolution, anonymous-principal construction,
policy gate-or-skip }` decision tree.**

Why this point and not the others:

- It centralizes a decision that is already implicit in the
  `app` vs `authed` split at `apps/server/src/main.ts:38-72` — the same place
  the bug class lives.
- It does not introduce a new abstraction layer: `@atlas/platform-core`
  already owns shared types (`Principal`, `IngressError`, cache-key builders).
- It does not require touching `@atlas/ports` or `@atlas/ingress` — the
  ingress chokepoint stays as it is and continues to enforce **I2**.
- It leaves the module manifest's existing `uiRoute` declaration untouched
  for now; the front-end mapping (surface→mode) can be added to the
  manifest schema later as a non-breaking field. The same `AccessMode`
  union is reused by `specs/frontend/surface-contract.md` `AuthSpec`, so
  client-side guards and server-side gates share one vocabulary.
- It avoids defining a new port. Access-mode gating is request-flow logic,
  not a swappable infrastructure capability.

Not in modules, not in adapters, not in a new package. The shared type lives
in `platform-core`; the enforcement lives in the single ingress
(`apps/server`).

## Proposed minimal model

In `packages/platform-core/src/access-mode.ts` (new file):

```ts
export type AccessMode =
  | 'platform-public'        // no tenant, no principal
  | 'platform-admin'         // host/platform admin only
  | 'tenant-public'          // tenant resolved, anonymous principal allowed
  | 'tenant-authenticated'   // tenant resolved, real principal required
  | 'tenant-policy';         // tenant resolved, principal required, policy evaluated
```

Each route is declared with one `AccessMode`. The middleware decides:

| Mode | Tenant resolution | Principal | Policy gate |
|------|-------------------|-----------|-------------|
| `platform-public` | skipped | none | none |
| `platform-admin` | skipped | required, must satisfy `platform-admin` claim | yes (against the control-plane policy bundle) |
| `tenant-public` | required (Host-only) | synthesized anonymous Principal `{ principalId: 'anon', tenantId, attributes: { anonymous: true } }` | optional, route-declared |
| `tenant-authenticated` | required | real principal, no anonymous fallback | none beyond authn |
| `tenant-policy` | required | real principal | yes — `policyEngine.evaluate` (existing path) |

Two structural additions:

1. A `Principal.attributes.anonymous: boolean` flag (already a free-form
   `Record<string, unknown>` in
   `packages/platform-core/src/manifest.ts` and `Principal` definition;
   no schema change required).
2. A new claim `roles: ['platform-admin']` for host-admin principals,
   surfaced as a `Membership`-equivalent on the control-plane DB. This is
   what lets a host admin browse provisioning requests across tenants.

The route-mount API in `apps/server/src/main.ts` becomes:

```ts
mount(app, healthRoutes(state),     { mode: 'platform-public' });
mount(app, identityInviteRoutes(s), { mode: 'tenant-public'   });
mount(app, intentRoutes(state),     { mode: 'tenant-policy'   });
```

`mount` is the only call site that knows about `AccessMode`. Routes
themselves stay mode-agnostic; they read `c.get('principal')` and
`c.get('hostTenantId')` as today. The middleware guarantees those are
populated correctly for the declared mode.

## Files that would need to change later

**Type + helpers (one new file, one edit):**
- New: `packages/platform-core/src/access-mode.ts` — type + a
  `principalIsAnonymous(p)` helper.
- Edit: `packages/platform-core/src/index.ts` — re-export.

**Server enforcement (one new file, one edit, isolated split):**
- New: `apps/server/src/middleware/access-mode.ts` — single composed
  middleware factory `accessMode(mode, state)` that internally chains tenant
  resolution, principal resolution (or anonymous synthesis), and the
  optional policy gate for `platform-admin`.
- Edit: `apps/server/src/main.ts:35-75` — replace the `app` vs `authed`
  split with a uniform `mount(app, factory, { mode })` table.
- Edit: `apps/server/src/middleware/principal.ts` — extract the
  Host-resolution call (`principal.ts:322-327`) into a standalone
  `tenantResolutionMiddleware` so the access-mode middleware can call it
  for `tenant-public` without dragging in JWT/cookie logic.

**Routes whose mounting changes (no body changes expected):**
- `apps/server/src/routes/health.ts` → `platform-public`
- `apps/server/src/routes/metrics.ts` → `platform-public`
- `apps/server/src/routes/identity.ts` (invite-accept, refresh, logout)
  → `tenant-public`
- `apps/server/src/routes/oauth.ts` → `tenant-public`
- `apps/server/src/routes/saml.ts` → `tenant-public`
- `apps/server/src/routes/scim.ts` → `tenant-public` (its existing
  bearer middleware stays in place; the access-mode wrapper just stops
  forcing JWT/cookie auth)
- `apps/server/src/routes/intents.ts` → `tenant-policy`
- `apps/server/src/routes/catalog.ts` → `tenant-policy` (currently
  `tenant-authenticated` plus per-route `evaluateRead` calls — the new
  mode formalizes that)
- `apps/server/src/routes/authz.ts` → `tenant-policy`
- `apps/server/src/routes/content-pages.ts` → `tenant-policy`
- `apps/server/src/routes/events.ts` → `tenant-authenticated`
- `apps/server/src/routes/identity.ts` (`identityAuthedRoutes`),
  `identity-idp.ts`, `mfa.ts`, `debug.ts` → `tenant-authenticated`

**Provisioning-specific (new routes, future slice):**
- New: `apps/server/src/routes/provisioning.ts` — `POST
  /api/v1/provisioning/requests` mounted as `tenant-public` (or
  `platform-public` if pre-tenant; **unknown — see Tenant provisioning
  fit** below); admin-side `GET/PATCH` mounted as `platform-admin`.
- New: `modules/tenancy/` — provisioning request entity + handlers (does
  not exist today; `modules/` only has `authz`, `catalog`,
  `content-pages`, `identity`).
- New: `specs/domains/tenancy/capabilities/provisioning/README.md`.

**Spec changes (additive, non-breaking):**
- `specs/schemas/contracts/module_manifest.schema.json` — add optional
  `accessMode` to the `uiRoute` definition.
- `packages/platform-core/src/manifest.ts:46-49` — mirror the schema field.
- `specs/frontend/surface-contract.md:54-58` — replace or complement
  `AuthSpec.required: boolean` with the same `AccessMode` enum so client
  guards and server gates share one vocabulary.
- `specs/architecture.md` — add an entry under "Ingress Chokepoint Rules"
  (`specs/architecture.md:558-572`) noting that mode declaration precedes
  authn/tenant resolution.

**Frontend (deferred slice — not part of the first implementation pass):**
- `packages/api-client/` would need a way to pass an explicit
  `mode: 'tenant-public'` request when calling provisioning endpoints
  before the user has a session. **Unknown** — needs verification of how
  `@atlas/api-client/src/http/index.ts` currently constructs requests
  (not read in this audit).

## Tests that should prove safety

**Unit (Vitest):**
- `packages/platform-core/test/access-mode.test.ts` — every mode value is
  in the union; `principalIsAnonymous` semantics.
- `apps/server/src/middleware/access-mode.test.ts` (new):
  - `platform-public`: no Host lookup, no DB hit, no Principal.
  - `platform-admin`: rejects principals without the `platform-admin`
    role; calls the policy engine.
  - `tenant-public`: synthesizes an anonymous Principal carrying the
    Host-resolved `tenantId`; rejects when Host has no registered tenant.
  - `tenant-authenticated`: 401 when no credential; 403 when Host vs
    JWT-claim disagree (parity with `principal.ts:590-598`).
  - `tenant-policy`: end-to-end, deny path returns 403 with no side
    effects (Invariant **I2**).
- Negative tests asserting that a route declared `tenant-public` cannot
  bypass tenant scope (no `tenantId` in body should override the
  Host-derived one).

**Integration (server):**
- `apps/server/src/middleware/principal.test.ts` already exercises
  principal flows; extend with mode-aware cases.
- New: `apps/server/test/access-mode-route-table.test.ts` — asserts every
  registered route in `main.ts` declares one mode; fails the build if
  someone mounts a route without a mode. This is the structural guard
  that prevents future "implicit public bypass" bugs.

**BDD (Playwright + Gherkin) under `tests/bdd/features/tenancy/provisioning/`:**
- `tenant-provisioning-request.feature` — anonymous visitor submits a
  provisioning request on a `tenant-public` (or `platform-public`) route;
  request lands in the control-plane store; surface state is `success`.
- `host-admin-review.feature` — host admin reaches an admin surface
  declared `platform-admin`; non-admin principal is rejected with the
  surface in `unauthorized` state.
- `provision-tenant-on-approve.feature` — approval triggers tenant
  creation, initial admin invite emission, and post-approval state
  transitions.

**Contract tests:**
- `packages/contract-tests/` does not need a new port (no port is
  introduced), but a smoke test that asserts the `AccessMode` set is
  closed (no string literals slip in) belongs in
  `packages/platform-core/test/`.

## Risks / invariants

**Single ingress (Invariant I1, `specs/architecture.md:77-94`):**
preserved. All HTTP entry stays in `apps/server`. The proposal does not
add a new HTTP-exposing app; it formalizes how `main.ts` mounts the
routes that already live there. No new entry point.

**Authz before execution (Invariant I2, `specs/architecture.md:97-109`):**
preserved. For `tenant-policy` routes, the access-mode middleware does
not bypass `submitIntent`'s authz step (`submit-intent.ts:262-277`); it
runs upstream of it. For `tenant-public` routes, the synthesized
anonymous Principal still flows through the same intent path if the
route submits an intent — `policyEngine.evaluate` will see
`principal.attributes.anonymous=true` and policies decide. No code path
allows a write to dispatch without policy evaluation.

**Tenant isolation (Invariants I7, I9):** preserved. The middleware
populates `c.get('hostTenantId')` for every non-`platform-*` mode and the
existing Host-vs-claim cross-check (`principal.ts:585-598`) extends to
the synthesized anonymous Principal. Anonymous principals carry a
`tenantId`, so cache-key builds in
`packages/platform-core/src/cache-key.ts` (referenced from
`specs/lifecycle.md:81-88`) still include it.

**No side effects for unauthorized requests (I2 corollary):** preserved.
The middleware computes the access decision before any route handler
runs; on `platform-admin` denial it returns 403 before reaching the
handler factory body, mirroring `submit-intent.ts`'s deny-throw shape.

**No cross-tenant public cache pollution:** the most subtle risk. Routes
declared `tenant-public` MUST emit cache writes only against
tenant-scoped keys. Two mitigations:
1. The synthesized anonymous Principal carries `tenantId`, so any
   `cache-key.ts` builder will include it (Invariant **I9**).
2. Add a lint/test: `tenant-public` routes are forbidden from constructing
   a `PrivacyLevel: 'PUBLIC'` cache artifact (the manifest schema field is
   already explicit at `packages/platform-core/src/manifest.ts:13`). This
   is a one-shot guard in the access-mode middleware contract test.

**Risk that `platform-public` routes leak tenant data:** mitigated by
the type — `platform-public` mode does not populate `hostTenantId` or a
`Principal`, so any handler that tries to read tenant context fails
loudly. Health and metrics are already tenant-free.

**Risk of anonymous abuse (DoS, enumeration on `tenant-public`):** real
and not addressed by this proposal. Per-route rate limiting (mentioned
as a future feature in `specs/architecture.md:567` "Rate Limiting") and
captcha-style bot deterrence are separate work and should not be folded
into the access-mode change.

## Tenant provisioning fit

The provisioning use case maps cleanly onto the proposed mode set:

1. **Anonymous visitor lands on a signup page.** That page is a frontend
   surface (a candidate `apps/admin/src/features/...` or a new
   `apps/signup` shell — **unknown**, not investigated). The `POST` it
   makes goes to a new route declared `platform-public` (no tenant
   exists yet) — for example `POST /api/v1/provisioning/requests`. The
   middleware does no tenant resolution, no authn, and synthesizes no
   principal. The route writes a `ProvisioningRequest` row into the
   control-plane DB (`state.controlPlaneSql`, already in use at
   `apps/server/src/middleware/state.ts:158`).
2. **Host admin reviews requests.** A new admin surface declared
   `platform-admin` lists pending requests by reading the same
   control-plane table. The access-mode middleware enforces that only
   principals with the `platform-admin` role / claim reach the route;
   the policy engine decides whether the specific admin can see the
   specific request type.
3. **Approval provisions the tenant.** Approval submits an intent
   (`Tenancy.ProvisioningRequest.Approve` — does not yet exist; see
   `specs/domains/tenancy/README.md` "TBD" capabilities list). The
   handler creates the tenant, runs the migration runner that already
   exists in `bootstrap.ts` for `ensureTenantMigrated`, seeds the
   initial admin User + Membership entities, and emits an invite token.
4. **Initial admin accepts the invite.** Lands on the existing
   `tenant-public` route `POST /api/v1/identity/invite/accept`
   (`apps/server/src/routes/identity.ts:65-211`). No change required —
   that route is already designed to operate before the user has a
   session.

Without an explicit `AccessMode`, step 1 has to be "duct-taped" into the
public group at `main.ts:38-56` next to health and metrics, with no
structural guarantee that future routes added to the same group don't
accidentally start touching tenant data. With the proposed mode, step 1's
intent is declared, type-checked, and asserted by the route-table test.

**Unknowns called out:**
- Where the signup page lives (new app vs admin shell vs marketing site).
  Not investigated.
- How `@atlas/api-client` should differentiate calls that are pre-session
  from calls that require a session. Not investigated.
- Exact shape of the `platform-admin` claim — a `Membership` row in the
  control-plane DB, a JWT claim, or both. Out of scope for this audit;
  identity already supports per-tenant `Membership.roles`
  (`apps/server/src/middleware/state.ts:323-371`). Extending to a
  control-plane membership is a follow-up design call.
