# Project Progress

> Snapshot of what's implemented, what's in flight, and what's planned.
> The Rust prototype under `/crates`, `/tools/cli`, `/apps/control-plane`,
> `/tests/blackbox` was deleted on 2026-05-04. TypeScript is the only
> implementation; cite `modules/`, `packages/`, `apps/`, `adapters/`, `ports/`
> in evidence.

- **Last updated:** 2026-05-04
- **Stack:** Node + browser TypeScript, hexagonal (ports/adapters), CQRS, event-sourced projections.

---

## Architecture Invariants — Status

| Inv | Statement | Status | Evidence |
|---|---|---|---|
| I1 | Single ingress chokepoint | Done | `apps/server/src/index.ts`, `packages/ingress/src/submit-intent.ts` |
| I2 | Authz before execution | Done | `packages/ingress/src/submit-intent.ts:186-306` |
| I3 | Idempotency before dispatch | **In flight** | Currently checks non-empty key only; lookup-and-replay landing in A2-hardening |
| I4 | Deny-overrides-allow | Done | `modules/authz/src/policy/evaluate.ts`, `adapters/policy-cedar/` |
| I5 | Correlation propagation | Done | Threaded via `IntentHandlerContext.correlationId` everywhere |
| I7 | Tenant isolation in search | Done | Search adapters accept `tenantId` in scope |
| I9 | Tenant in cache keys | Done | `cacheTagDispatcher` + handwritten `cacheInvalidationTags` per event |
| I10 | Event-driven cache invalidation | Done | Tag-based purging in `apps/server/src/middleware/state.ts` |
| I12 | Rebuildable projections | Done | Each module's `dispatch.ts` rebuildable from `EventStore` history |

---

## Identity / Auth — Phase Status

The identity module is the largest active surface. Phase numbering tracks
the original implementation plan; later phases are planned but not started.

### Phase A1 — Core entities + password foundation (Done)
- `User`, `Membership`, `InviteToken` entities on the L3 substrate
- `Identity.User.Create`, `Identity.Membership.Create`
- `Identity.Invite.Issue` / `Identity.Invite.Accept` (magic-link redemption)
- `Identity.User.SetPassword`, `Identity.Login.Password`
- Argon2id hashing + password complexity, per-user lockout (5 fails / 15 min)
- Platform OIDC principal resolution by `primaryIdpSubject`
- Role hydration from `Membership.roles`
- Tests: `modules/identity/test/acceptance.test.ts`, `password.test.ts`

### Phase A2 — Sessions (Done)
- `AuthSession` entity with refresh-token rotation
- `Identity.AuthSession.Issue / Refresh / Revoke / RevokeAllForUser`
- N=1 reuse-detection → `Identity.SessionAnomaly` + `RevokeAllForUser`
- Idle + hard timeouts, concurrent-session cap with oldest-first eviction
- Cookie session validation: `apps/server/src/middleware/principal.ts`
- Tests: `modules/identity/test/session.test.ts`, `a2-acceptance.test.ts`

### Phase A2.4 — Per-tenant session policy (Done)
- `SessionPolicy` resolver hook
- `session-lifetime.ts` — `checkSessionLifetime`, `touchSessionLastSeen`

### Phase A2.7-A2.9 — Service credentials (Done)
- `ApiKey` entity + `Create / Rotate / Revoke` (bearer `atlas_<keyId>_<secret>`, Argon2id)
- `ServicePrincipal` + `Create / SetScopes / Disable`
- `OAuthAccessToken` entity + RFC 6749 client_credentials grant
  - Issued + revoked via dedicated `/oauth/token` and `/oauth/revoke` routes
  - Direct exports (`oauthIssueToken`, `oauthRevokeToken`) — not wired through the intent registry
- Tests: `modules/identity/test/a2-acceptance.test.ts`

### Phase A2-hardening — In flight
Security review (2026-05-04) flagged several gaps in the implemented surface.
Tracked as a hardening pass before any new auth method lands:

- Replace `Math.random()` in `modules/identity/src/ids.ts` with crypto-secure RNG
- Real I3 idempotency replay-protection in `packages/ingress/src/submit-intent.ts`
- Fix `RevokeAllForUser` synthetic-envelope idempotency key + `userId` mislabel
- Reject (don't coerce) invalid `SessionEndReason` values
- Wire session revocation into `handlePasswordSet` (session-fixation reset)
- Thread `principalId` into session handlers + assert against target `userId`
- Generation counter in `AuthSessionDocument` for N-deep reuse-detection
- Zod `.strict()` payload validation per handler entry
- `acceptedEmail` binding + tenant assertion on `Identity.Invite.Accept`
- Defensive `session.tenantId === cmd.tenantId` cross-check on refresh/revoke
- Collapse user-enumerable error codes at the HTTP boundary
- Drop `email` from `LoginRejected` payload on `unknown_user` rejects

### Phase A3 — Federated OIDC (Planned)
- `jose`-based JWT validator against tenant-configured JWKS
- OIDC code flow + state/nonce/PKCE
- Magic-link login (separate from invite redemption)
- Password reset issue/redeem
- Principal enforcement on suspended / no-membership users

### Phase A4 — SCIM + audit (Planned)
- SCIM 2.0 user/group provisioning
- Audit event emission from identity module
- Per-tenant role packs (custom roles atop platform defaults)

### Phase A5 — TOTP MFA (Planned)
- `AuthFactor` entity, RFC 6238 TOTP enroll/verify, recovery codes (HMAC w/ pepper)

### Phase A6 — WebAuthn / passkeys (Planned)
- `@simplewebauthn/server` integration, credential storage, challenge ceremony

### Phase A7 — Risk engine (Planned)
- Anomaly signals: refresh-reuse, IP drift, velocity, impossible-travel
- Step-up auth hooks

### Phase A8+ — SAML, delegated admin (Planned)

---

## Other Modules

| Module | Package | Status |
|---|---|---|
| `authz/` | `@atlas/authz` | Done — Policy CRUD (draft / active / archived), Cedar bundle integration via `adapters/policy-cedar` |
| `catalog/` | `@atlas/catalog` | Done — Taxonomies, families, variants, attributes, search, seed-package import |
| `content-pages/` | `@atlas/content-pages` | Done — Page CRUD + render-tree projection |

The 23 other domain stubs in `specs/domains/` have no module code yet — specs
are the source of truth until they land here.

---

## Infrastructure

| Component | Status | Evidence |
|---|---|---|
| Hono HTTP server | Done | `apps/server/src/index.ts` |
| Postgres adapter (event store + entity store) | Done | `adapters/node-postgres/` |
| IndexedDB adapter (browser sim) | Done | `adapters/idb/` |
| Cedar policy adapter | Done | `adapters/policy-cedar/` |
| Stub policy adapter | Done | `adapters/policy-stub/` (deny-by-default tests / dev) |
| Inline projection worker | Done | `apps/server/src/middleware/state.ts` |
| Async projection worker | Done | `apps/projection-worker/src/tenant-loop.ts` |
| Spec validation CLI | Done | `make spec-check` |
| Compose stack (Postgres dev) | Done | `infra/compose/`, `make db-up` |
| K8s manifests | Missing | `infra/k8s/` placeholder |

---

## Frontend

`AtlasElement` base class + `AtlasSurface` top-level surfaces with signal-based
state. Apps: `apps/admin`, `apps/authoring`, `apps/sandbox`. Component library
in `packages/design`. See `packages/CLAUDE.md` for the constitutional rules.

| Surface | Status |
|---|---|
| `packages/core` (AtlasElement, signals, html template) | Done |
| `packages/design` (component library) | Done — actively grown |
| Admin shell | Wired |
| Authoring shell | Wired |
| Sandbox / playground | Wired |

---

## Cross-cutting Gaps

- **Message bus / async outbox.** Inline + async dispatchers exist but no Kafka/NATS adapter.
- **Per-tenant database isolation.** Single Postgres today; tenancy is a column, not a schema.
- **Rate limiting at ingress.** Per-user lockout exists; no IP/global throttle middleware.
- **Break-glass admin access.** Spec-only.
- **`atlasctl` CLI.** Rust prototype deleted; TS rewrite TBD.

---

## Spec ↔ Code Drift

Several specs still reference the deleted Rust prototype. The
`specs/domains/identity/authn.md`, `specs/domains/authorization/authz.md`,
`SYSTEM_MAP.md`, and this file are being refreshed in the same hardening pass.
If you find a spec citing `crates/`, `cargo`, or `axum`, it is stale — trust
the code.
