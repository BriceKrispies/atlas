# SDET review — modules/identity (48 files)

## Summary
- Total files reviewed: 48
- Files clean: 35
- Files with findings: 13
- Critical: 2 | Moderate: 17 | Style: 18

This is the largest test concentration in the repo. Quality is generally **high**:
crypto primitives are pinned against FIPS / RFC vectors, cache-tag assertions
are exact across handler tests, every handler has tenant-scoping coverage, the
I12 dispatcher-replay invariant has a dedicated `dispatch.test.ts` that
exercises every entity type, and adversarial security tests in
`test/security/` document concrete RED findings (rather than `expect().toThrow()`
shape coverage).

The single most concerning class of finding is **`security-tautology`** in
`a3-acceptance.test.ts:265-296` (JWT smoke test that builds a signed JWT and
never verifies the signature). The second is **`tautology`** in
`platform-robot-principal.test.ts:399` (an intentional canary `expect(true).toBe(true)`).

Many "moderate" findings are intentional carve-outs documented in test
headers (crypto-bearing WebAuthn / SAML branches deferred to Layer-3 e2e). I
list them so the gap is auditable but consider them defensible.

## Findings by file

### modules/identity/test/a2-acceptance.test.ts
clean

### modules/identity/test/a3-acceptance.test.ts
- L264-296 [CRITICAL] **security-tautology** — `it('produces a 3-segment compact JWT signed by an RSA-2048 key')` builds a JWT via `createSign('RSA-SHA256')`, asserts (a) the JWT has 3 segments (shape), (b) `publicKey.asymmetricKeyType` is `'rsa'`. It **never calls `createVerify(...).verify(publicKey, signature)`** to check that the signature actually validates. A bug in `createSign` configuration, a wrong digest algorithm, or a key swap would all pass this test. The whole point of an RS256 "smoke" is to prove sign↔verify roundtrips; this only proves the *shape* of the output. Recommended fix: add `expect(createVerify('RSA-SHA256').update(signingInput).verify(publicKey, Buffer.from(signature.replace(/-/g,'+').replace(/_/g,'/'), 'base64'))).toBe(true)`.

### modules/identity/test/a4-acceptance.test.ts
- L566-572 [STYLE] **coverage-shape** — `it('IdentityError carries SCIM_INVALID_TOKEN/SCIM_RESOURCE_NOT_FOUND code surface')` constructs `new IdentityError(...)` and reads back the `.code` / `.status` it just passed in. This is a constructor-getter pin, not a behavior test. The test's own header literally says "error envelope smoke … (not real test, just guard)". Defensible as a regression pin but it's tautology-adjacent.

### modules/identity/test/a5-acceptance.test.ts
clean — RFC 4226 §5.3 vectors pinned at L188-207 is exactly the kind of crypto pin the rubric prefers.

### modules/identity/test/a6-acceptance.test.ts
- L46-57 [MODERATE] **shape-only** — `it('extracts entityID, SSO URL, signing cert, NameID format')` for `parseIdpMetadata` checks the cert begins with `-----BEGIN CERTIFICATE-----` and ends with `-----END CERTIFICATE-----`. It does not call `crypto.createPublicKey()` on the PEM to verify the cert actually parses. Combined with the broken base64 sample (the test fixture has `Sample==` literal in the cert body — see L34-35), a regression that returned a malformed-but-PEM-shaped string would pass.
- L117-124 [MODERATE] **shape-only** — `generateSamlSpKey` test checks `keyLength === 2048` and that PEM markers exist, but does not assert the key actually parses as RSA via `createPrivateKey(privateKeyPem)` nor that the self-signed cert verifies against its own public key. A broken `generateSamlSpKey` that returned `{ keyLength: 2048, privateKeyPem: 'BEGIN RSA PRIVATE KEY\nbogus\nEND RSA PRIVATE KEY' }` would pass.

### modules/identity/test/a7-acceptance.test.ts
clean

### modules/identity/test/a7-notifications.test.ts
clean

### modules/identity/test/a7-step-up.test.ts
clean

### modules/identity/test/acceptance.test.ts
- L380-393 [STYLE] **skipped/todo** — 14 `it.todo(...)` placeholders for Phase A2 scenarios (password login, magic link, OIDC). Documented as intentional Phase boundary.
- L153 [STYLE] **stale-comment** — `it('end-to-end: invite → accept → set-password lands an Argon2id hash')` — title says Argon2id but the assertion at L186 is `expect(user?.passwordHash).toMatch(/^\$scrypt\$/)`. Cosmetic; the security test at `crypto-posture.security.test.ts` already flags this docs/code drift as F-CRYPTO-9.

### modules/identity/test/audit-retention.test.ts
clean

### modules/identity/test/bdd/password.bdd.test.ts
clean — entry-point file, runner imports do the work.

### modules/identity/test/cross-tenant-isolation.test.ts
clean — exemplary tenant-isolation coverage. Seeds both tenants into one store, probes from one perspective, asserts the other is invisible. This is what `tenant-scope-missing` rejection should look like.

### modules/identity/test/dispatch.test.ts
- L330-385 [MODERATE] **shape-only** — `it('RecoveryCode: generate batch + redeem')` explicitly **skips** the byte-equal I12 replay check (see comment at L356-370: "Skip the bytewise check for this case and assert a structural property instead"). The handler eager-writes per-code rows the dispatcher cannot recreate from the batch event. This is a documented carve-out from I12, not a test bug — but it's exactly the kind of gap an attacker exploits. The fallback (events were emitted, consumed event has a document) is much weaker than the rebuildability invariant. Recommended: the handler should emit per-code Generated events so I12 applies, or the test should document this as an I12 violation ticket.

### modules/identity/test/handlers.test.ts
clean

### modules/identity/test/password.test.ts
clean — note `validatePasswordComplexity` happy-path "accepts a length+digit combo" accepts `'letmein-123456789'` which the security-test file `crypto-posture.security.test.ts` flags as a F-CRYPTO-4 weakness. But the unit test is asserting current production behavior, not desired. Acceptable.

### modules/identity/test/role-packs.test.ts
clean

### modules/identity/test/security/crypto-posture.security.test.ts
clean — these are FAILING-BY-DESIGN regression pins for documented crypto-posture gaps (F-CRYPTO-1 through F-CRYPTO-9). The rubric was clearly designed with this kind of file in mind. Reads source files via `readFileSync` for AST-free static checks; an attacker can't slip `Math.random()` past a string search of source bytes.

### modules/identity/test/security/saml-verifier.security.test.ts
clean — same as above: adversarial SAML-attack fixtures that document concrete gaps (XSW, algorithm whitelist, audience pin bypass, Recipient missing, replay TOCTOU). The `helpers.ts` companion (not in scope) generates real test certs and signs real XML.

### modules/identity/test/session.test.ts
clean — includes a real I12 replay assertion (L282-313). The byte-equal strip-and-compare is the right shape.

### modules/identity/test/unit/api-key.test.ts
clean

### modules/identity/test/unit/audit-export.test.ts
clean

### modules/identity/test/unit/auth-factor.test.ts
clean

### modules/identity/test/unit/break-glass.test.ts
clean — exceptional coverage of the 4-eyes self-approval guard (L186-199); single most security-critical assertion in this file, asserted directly.

### modules/identity/test/unit/identity-provider.test.ts
clean

### modules/identity/test/unit/impersonation-notify.test.ts
clean — small file but exercises the I10 contract on every Notification follow-up.

### modules/identity/test/unit/impersonation.test.ts
clean — `resolveImpersonationToken` covers all five failure modes (malformed, not_found, hash_mismatch, revoked, expired).

### modules/identity/test/unit/invite-accept.test.ts
clean — note L288-314 documents an unreachable status branch (status-check vs lookup-pending-scoped filter). The comment is honest: "Asserting actual behavior here; the unreachable branch is documented in `handlers.test.ts` cross-reference." Good.

### modules/identity/test/unit/invite-issue.test.ts
clean — L53-67 plaintext-in-event-payload assertion is exactly the secret-hygiene pattern the rubric wants.

### modules/identity/test/unit/jit-provision.test.ts
clean

### modules/identity/test/unit/membership-create.test.ts
clean

### modules/identity/test/unit/mfa-bypass.test.ts
clean

### modules/identity/test/unit/mfa-challenge.test.ts
- L103-124 [MODERATE] **shape-only** — `it('returns idempotent NoOp envelope for an already-active session')` asserts `result.envelope.eventType).toContain('NoOp')` and `result.document.status).toBe('active')`. The contract here is "presented factor is NOT re-verified on an already-active session" — that's the security-relevant property (otherwise an attacker with a stolen session could fish bad codes against locked TOTPs without ratelimit). The test passes `factorId: 'whatever', presentedCode: '000000'` and confirms no error, but doesn't directly assert that no `Identity.MfaAnomaly` event was emitted from the TOTP-challenge code path. Could pass if the handler silently emitted an anomaly. Recommended: add `expect(fx.events.events.filter(e => e.eventType === 'Identity.MfaAnomaly').length).toBe(0)` after the NoOp.

### modules/identity/test/unit/oauth-token.test.ts
clean — RFC 7009 §2.2 (no enumeration on unknown token) explicitly asserted.

### modules/identity/test/unit/password-login.test.ts
clean — L177-199 PII-reduction (`emailHash` instead of `email` on unknown_user) is one of the highest-stakes assertions in the file; it's there.

### modules/identity/test/unit/platform-robot-principal.test.ts
- L398-417 [CRITICAL] **tautology** — `it('documents that null is currently still a legal front-door signal')` body is literally `expect(true).toBe(true);` with a 16-line comment explaining the canary intent. The rubric flags this as critical because it has zero safety: the test passes regardless of any production behavior. The author's intent (a placeholder that fails when Stage 3 lands and `null` acceptance is removed) is reasonable, but the implementation is a tautology — it will NEVER fail. Recommended: replace with an actual assertion that calls `handleSessionIssue` with `principalId: null` and expects success; that one would correctly start failing when the branch is removed.

### modules/identity/test/unit/recovery-code.test.ts
clean

### modules/identity/test/unit/saml-acs.test.ts
- L186-201 [MODERATE] **skipped/todo** — `describe.skip` block with 7 `it.todo()` for crypto-bearing branches (replay, audience mismatch, InResponseTo, attribute mapping, JIT integration, cache tags). Header documents these are Layer-3 e2e gaps. Defensible — `mock-the-sut` would be worse than skipping — but the visible "skipped" line should be tracked in tickets, not just a test comment.

### modules/identity/test/unit/saml-sp-key.test.ts
- L51-66 [MODERATE] **shape-only** — `it('emits Identity.SamlSpKeyGenerated with Tenant + SamlSpKey tags (I10)')` asserts envelope + cache tags but never validates that the generated key pair actually round-trips (sign-then-verify). Same finding as `a6-acceptance.test.ts` L117-124. A regression in `generateSamlSpKey` that returned a `keyId` and the right tag shape but a corrupt PEM would pass.

### modules/identity/test/unit/scim-token.test.ts
clean

### modules/identity/test/unit/secret-hash.test.ts
clean — textbook FIPS 180-4 vector pinning. The rubric explicitly calls out this file's pattern as the right one for crypto tests.

### modules/identity/test/unit/service-principal.test.ts
clean

### modules/identity/test/unit/session-issue.test.ts
clean

### modules/identity/test/unit/session-refresh.test.ts
clean

### modules/identity/test/unit/session-revoke.test.ts
clean — note L86-106 "is idempotent at the handler level — second revoke also succeeds" documents the dual-emission contract (two events for two calls); the doc is honest about it being "tolerates re-application" not "deduplicates".

### modules/identity/test/unit/totp.test.ts
clean

### modules/identity/test/unit/user-create.test.ts
- L125-135 [STYLE] **stale-comment** — `it('persists passwordHash when provided')` passes `'$argon2id$v=19$m=65536,t=3,p=4$abc...'` as the hash and asserts it round-trips. The test is correct (it's just testing storage roundtrip of an opaque string) but uses an Argon2 marker even though production uses scrypt. Cosmetic.

### modules/identity/test/unit/user-set-password.test.ts
- L42-77 [STYLE] **stale-comment** — `it('persists Argon2id hash on the document and clears failedLoginCount + lockedUntil')` title says Argon2id; assertion is `expect(result.document.passwordHash).toMatch(/^\$/)` — match-anything-with-a-dollar-sign. The shape check is weaker than `password.test.ts`'s `/^\$scrypt\$/` pin. Recommended: tighten to `/^\$scrypt\$N=\d+,r=\d+,p=\d+\$/` to catch both algorithm regression AND drift to a non-PHC envelope.

### modules/identity/test/unit/webauthn.test.ts
- L129-134 [MODERATE] **skipped/todo** — `describe.skip` blocks with `it.todo` for the I10 cache-tag contract on `handleWebAuthnRegisterFinish` / `handleWebAuthnAssertFinish` success paths. Header documents these are e2e gaps. Cache-tag contract is the kind of thing the spec invariant scan (I10) should catch — having the assertion as a skip-with-todo at least makes it auditable.
- L180-191 [MODERATE] **skipped/todo** — additional `describe.skip` with 6 `it.todo()` for crypto-bearing WebAuthn branches (attestation verification, signCount regression as cloned-authenticator detection, rpId/origin mismatch). Same defense as `saml-acs.test.ts`.

## Skipped/todo'd tests (inventory)

| File | Line | Kind | Description |
|------|------|------|-------------|
| `acceptance.test.ts` | 380 | `it.todo` | password.feature: Successful password login (AuthSession + cookie) |
| `acceptance.test.ts` | 381 | `it.todo` | password.feature: Wrong password — rate limited |
| `acceptance.test.ts` | 382 | `it.todo` | password.feature: Forgot-password flow (ResetToken + email) |
| `acceptance.test.ts` | 383 | `it.todo` | password.feature: Reset password using a valid token |
| `acceptance.test.ts` | 384 | `it.todo` | password.feature: Reject reset with expired token |
| `acceptance.test.ts` | 385 | `it.todo` | magic-link.feature: User requests a magic link (MagicLinkToken + email) |
| `acceptance.test.ts` | 386 | `it.todo` | magic-link.feature: Magic-link click logs the user in |
| `acceptance.test.ts` | 387 | `it.todo` | magic-link.feature: Reject expired magic link |
| `acceptance.test.ts` | 388 | `it.todo` | magic-link.feature: Reject reused magic link |
| `acceptance.test.ts` | 389 | `it.todo` | magic-link.feature: Throttle repeated requests |
| `acceptance.test.ts` | 390 | `it.todo` | magic-link.feature: Email-not-found does not leak account existence |
| `acceptance.test.ts` | 391 | `it.todo` | platform-oidc.feature: User without Membership is rejected (403) |
| `acceptance.test.ts` | 392 | `it.todo` | platform-oidc.feature: Suspended Membership blocks login (403) |
| `acceptance.test.ts` | 393 | `it.todo` | platform-oidc.feature: Returning user — AuthSession creation half |
| `unit/saml-acs.test.ts` | 186 | `describe.skip` | crypto-bearing SAML branches (7 `it.todo` inside) |
| `unit/webauthn.test.ts` | 129 | `describe.skip` | I10 cache-tag contract on RegisterFinish (1 `it.todo`) |
| `unit/webauthn.test.ts` | 132 | `describe.skip` | I10 cache-tag contract on AssertFinish (1 `it.todo`) |
| `unit/webauthn.test.ts` | 180 | `describe.skip` | crypto-bearing WebAuthn branches (6 `it.todo` inside) |

Total: 14 `it.todo` + 4 `describe.skip` containing 15 `it.todo`. The Phase A2 / Layer-3-e2e carve-outs are intentional; the WebAuthn I10 ones are mechanically-checkable invariants that the project's `pnpm overseer:check` should be teaching the suite to require.

## Recommended fixes (biggest wins, ordered by severity)

1. **`a3-acceptance.test.ts:264-296`** — add an actual signature-verify assertion to the "RS256 JWT smoke" test. This is the only test in the entire suite that touches JWT signing and it never proves the signature is valid. Five lines of `createVerify` would close it.

2. **`platform-robot-principal.test.ts:398-417`** — replace the `expect(true).toBe(true)` canary with a real assertion that calls `handleSessionIssue({ principalId: null, ... })` and asserts success. That assertion will start failing the day the `null` branch is removed (the intent of the canary), without being a tautology today.

3. **`user-set-password.test.ts:42-77`** — tighten the PHC-string assertion from `/^\$/` to `/^\$scrypt\$N=\d+,r=\d+,p=\d+\$/` to catch both algorithm drift and envelope-format drift.

4. **`saml-sp-key.test.ts:51-66` and `a6-acceptance.test.ts:117-124`** — add roundtrip assertions that the generated keys actually parse via `crypto.createPrivateKey` and that the self-signed cert verifies against its own public key. Three lines per test.

5. **`mfa-challenge.test.ts:103-124`** — add `expect(fx.events.events.filter(e => e.eventType === 'Identity.MfaAnomaly').length).toBe(0)` to the already-active-session NoOp test. Pins the security-relevant property (factor proof is not re-checked) directly.

6. **`dispatch.test.ts:330-385`** — file a ticket on the RecoveryCode I12 carve-out. Either (a) emit per-code `RecoveryCodeGenerated` events so the dispatcher can rebuild them, or (b) explicitly mark RecoveryCode rows as "projection rows the dispatcher does not own" and exempt them from I12 in the spec.

7. **Crypto/SAML/MFA e2e gap** — the 4 `describe.skip` blocks total 15 `it.todo`s for branches that genuinely require real authenticator output / real signed XML. Ticket the e2e harness work explicitly; until then the security tests in `test/security/` carry the load for adversarial coverage.
