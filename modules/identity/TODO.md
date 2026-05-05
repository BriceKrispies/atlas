# `@atlas/identity` — Remaining Work

Snapshot as of 2026-05-05. Phases A1 → A7 of the Tier 3 auth build are
landed at the **module layer** (entities + handlers + dispatcher +
queries + acceptance tests) — what's left is mostly wiring into
`apps/server`, the IDB sim, the BDD harness, plus a handful of
explicitly-deferred polish items.

The full plan + sequencing rationale lives at
`C:\Users\Brice\.claude\plans\yes-mossy-galaxy.md`. This file is the
short list — every item below is something an agent can pick up cold.

---

## Phase A2 — Sessions, browser auth, service principals

- **A2.12b — Wire identity into `apps/sim`.** The IDB sim today only
  loads catalog + content-pages. Register `identityHandlerRegistry`,
  add `identityDispatcher` to the dispatcher chain, surface identity
  intents/queries on `window.__atlas`. Sessions in sim flow through
  the entity store; cookie payload returns in-band.
- **A2.12c — Playwright BDD step defs.** Drive the three @phase-a1 +
  14 @phase-a2 feature scenarios via the sim. End state:
  `pnpm bdd --grep @phase-a2` runs Phase A2 acceptance through the IDB
  browser harness.

> Vitest acceptance (`a2-acceptance.test.ts`) already covers every
> scenario end-to-end against in-memory adapters. The Playwright
> harness is a different *layer* of confidence (full browser, real
> IDB, full event roundtrip) — lift A2.12b/c when BDD coverage
> becomes a priority.

---

## Phase A3 — Federated OIDC

- **A3.10 — A3 BDD wiring.** Same shape as A2.12b/c: sim wiring +
  Playwright step defs for the federated-oidc scenarios. Vitest
  acceptance already passes.

---

## Phase A5 — MFA stack

- **KMS integration for TOTP secret encryption at rest.** Today
  `crypto/totp.ts` derives the per-tenant key from a process-wide root
  key (`encryptionKeyIdForTenant`). The trust model assumes the DB is
  compromised but process memory is not. Production wants per-tenant
  keys stored in an external KMS (AWS KMS / GCP KMS / HashiCorp Vault)
  with rotation. Same shape applies to `samlEncryptedPrivateKey` on
  `SamlSpKeyDocument`.

---

## Phase A6 — SAML 2.0

- **SAML Single Logout (SLO).** A6 shipped SP-initiated AuthnRequest
  + ACS only. SLO needs an `/sso/saml/<tenantId>/slo` endpoint, a
  signed LogoutRequest builder, and AuthSession revocation on
  inbound LogoutResponse.
- **Assertion-replay cleanup job.** `SamlAssertionReplay` entities
  carry an `expiresAt`; the verify-check filters on it correctly,
  but rows linger forever today. Needs a periodic cron-shape that
  deletes expired replay records (cheap — same shape the
  audit-export worker uses).
- **External security review.** Per the plan: required before
  production ship of the SAML stack. xml-crypto / @xmldom /
  fast-xml-parser are the riskiest single component — XML signature
  ceremonies have a long tail of historical CVEs.

---

## Phase A7 — Risk engine + impersonation + break-glass

A7 is **fully landed** at the entity + handler + route + acceptance
layers. The remaining items are deeper integrations that depend on
adjacent platform work.

- **Notification consumer (A7.3 follow-up).** The notifications
  dispatcher (`identityNotificationDispatcher`) emits structured
  `Notifications.*` events at `retention:7y` / `retention:10y` for
  every Impersonation/BreakGlass transition. The actual delivery
  consumer (email + pager router) lives in the future
  `notifications` domain — no A7-specific work remaining.
- **Risk gate middleware integration (A7.7 follow-up).** The risk
  scorer + step-up gate (`evaluateRiskGate`, `acknowledgeStepUp`) +
  `AuthSession.riskAcknowledgedUntil` field are landed and unit-
  tested. The principal middleware does NOT yet call
  `evaluateRiskGate` per request. Wiring needs:
    1. compute `RiskSignals` from request headers (IP, UA, geo
       probe — geo currently a stub),
    2. resolve tenant policy thresholds,
    3. on `step_up` decision: respond 401 `RISK_STEP_UP_REQUIRED`
       and force the user through `Identity.MfaChallenge.Submit`,
    4. on `hard_deny`: respond 403 `RISK_HARD_DENIED`,
    5. update the MFA challenge handler to call
       `acknowledgeStepUp` on success and persist the session.
  This is ~150 LOC in `principal.ts` + `mfa-challenge.ts` and a
  follow-up integration test. Deferred because it touches three
  middleware seams that are easier to land in a focused slice.
- **Retention-tag platform cleanup job (A7.8 follow-up).** The
  audit-export pipeline already enforces the floor at export time
  (`shouldExportEvent`). A separate periodic cleanup job that walks
  the events table and deletes rows past `effectiveRetentionDays`
  hasn't been built yet — when it lands, every delete MUST gate
  through `effectiveRetentionDays(retentionTag, tenantOverride)` to
  keep `retention:7y` / `retention:10y` non-shortenable.
- **Break-glass role composition into Principal.** Active break-
  glass grants (`resolveActiveGrants`) need to be folded into
  `principal.attributes.breakGlassRoles` / `breakGlassGrantId` by
  the principal middleware so authz / Cedar can use them. Deferred
  with the A7.7 middleware slice.
- **Impersonation `readonlyResourceTypes` enforcement.** The
  attribute is propagated onto the Principal via the impersonation
  bearer scheme, but the action dispatcher does not yet refuse
  mutating actions whose target type is in the list. Wire into
  `submit-intent.ts`'s authz step before handler dispatch.
- **External security review.** Per the plan: required before
  production ship of break-glass — it's the highest-stakes audit
  surface.

---

## Cross-cutting / dep removal

User preference: avoid third-party dependencies where the swap cost
is reasonable. Tracked here so it doesn't drift.

- **Production `jose` swap in `apps/server/src/middleware/principal.ts`.**
  The `modules/identity` test usage of `jose` was already swapped to
  Node `crypto.createSign` / `generateKeyPairSync`. The production
  OIDC verify path still uses `jose` — replacing requires:
  - `alg=none` defense (jose handles this; rolling our own MUST
    refuse `alg=none` unconditionally),
  - JWKS cache (jose's `createRemoteJWKSet` does this; we'd need a
    lightweight equivalent),
  - remote fetch with bounded refetch on `kid`-miss (Phase A3.4
    already implements the cache shape — extend it).
- **`fast-xml-parser` → in-house SAX parser.** Cheap eventually
  (~1-2 weeks) but lower priority than the production-jose swap.
- **`node-forge` → Node stdlib + ASN.1 DER.** Node has key gen; the
  cert issuer (X.509 self-signed for SAML SP metadata) is the real
  cost (~2-3 weeks of ASN.1 DER work).
- **`@simplewebauthn/server`.** **KEEP.** CBOR + COSE + attestation
  formats. Replacing = 6-8 weeks + ongoing FIDO spec tracking.
- **`xml-crypto` + `@xmldom/xmldom`.** **KEEP.** XML signature
  verify. Plan explicitly flagged this as the riskiest component to
  replace — rolling our own is precisely the path the plan says NOT
  to take.

---

## Apps / surfaces still missing

- **`apps/admin` — identity-aware screens.** Today admin shells have
  no identity-management surface. Needs: user list, membership
  editor, invite issue + revoke, session list per user, MFA factor
  inventory, IdP configuration, SCIM token issue, impersonation
  start (operator-side), break-glass issue + approve queue.
- **`apps/authoring` — login surface.** Same auth backend, different
  shell. Currently relies on test-auth.

---

## What's already DONE (the floor)

For agents picking this up: the following all ship green at the
module layer with vitest acceptance, no regressions:

| Phase | Surface |
|-------|---------|
| A1 | User / Membership / InviteToken; password login; magic-link; lockout; role packs |
| A2 | AuthSession (refresh + reuse-detect); cookie + CSRF; ApiKey (Argon2id-class hashes via scrypt); ServicePrincipal; OAuth client_credentials + revoke; multi-scheme principal middleware |
| A3 | IdentityProvider (kind=oidc); per-tenant JWKS cache; per-tenant JWT validation; JIT provisioning; group→role mapping; IdP HTTP routes |
| A4 | SCIM 2.0 (Users/Groups/discovery); SCIM bearer auth; AuditExportConfig + worker; retention tagging on every event |
| A5 | AuthFactor (TOTP + WebAuthn-MFA + passkey); RecoveryCode; MfaBypass; MFA challenge flow on AuthSession; last-factor protection |
| A6 | IdentityProvider (kind=saml); SamlSpKey; IdP metadata import; AuthnRequest builder; SAML response verifier (XML signature + replay + audience + skew); SamlAssertionReplay; SAML JIT; SP metadata + ACS routes |
| A7 | ImpersonationSession; BreakGlassGrant (incl. 4-eyes approval state machine); RiskScorer + decideFromScore + step-up gate (`evaluateRiskGate` + `acknowledgeStepUp` + `AuthSession.riskAcknowledgedUntil`); A7.9 HTTP routes (impersonation + break-glass) with PlatformSupport / TenantAdmin role enforcement, strict input validation (URL scheme allow-list, role-name regex, duration caps); impersonation bearer scheme in principal middleware; A7.3 notifications dispatcher; A7.8 audit-export retention floor |

Test baseline as of 2026-05-05: 76 files / 769 tests pass at the
root; 4 files / 33 tests pass at `apps/server`; 0 regressions across
the suite.
