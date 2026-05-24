---
title: SDET adversarial review — bogus-test rollup
status: rollup
type: review
generated_at: 2026-05-22
git_head: ea08453
---

# SDET review rollup — flagged tests across the repo

8 parallel `sdet` agents reviewed **all 212 `*.test.ts` files** under `adapters/ apps/ modules/ packages/ ports/`. Each batch used the same severity rubric (**critical / moderate / style**) plus batch-specific Atlas-aware checks (security-tautology, i9-guard-bypassed, cache-tags-not-asserted, auth-bypass-not-tested, etc.).

Per-batch reports: [`01-adapters.md`](./01-adapters.md) · [`02-modules-identity.md`](./02-modules-identity.md) · [`03-modules-other-ports.md`](./03-modules-other-ports.md) · [`04-packages-small-dsl.md`](./04-packages-small-dsl.md) · [`05-packages-observability-core.md`](./05-packages-observability-core.md) · [`06-packages-widget-stack.md`](./06-packages-widget-stack.md) · [`07-apps-non-server.md`](./07-apps-non-server.md) · [`08-apps-server.md`](./08-apps-server.md)

## Headline

| Batch | Files | Clean | Critical | Moderate | Style |
|-------|------:|------:|---------:|---------:|------:|
| 01 adapters | 35 | 27 | 2 | 4 | 2 |
| 02 modules/identity | 48 | ~40 | 2 | ~5 | ~3 |
| 03 modules/other + ports | 10 | 4 | 1 | 6 | — |
| 04 packages small+dsl | 24 | ~20 | 1 | ~3 | 0 |
| 05 obs + platform-core | 26 | 21 | 1 | 2 | 1 |
| 06 widget-stack | 15 | 13 | 0 | 2 | 0 |
| 07 apps non-server | 31 | 16 | 4 | 8 | 3 |
| 08 apps/server | 23 | ~15 | 3 | ~5 | — |
| **Total** | **212** | **~156** | **14** | **~35** | **~9** |

**~74% of tests look genuine.** ~26% have something worth flagging. **14 are critical** (zero-safety) — the actionable list.

## Critical findings (full inventory)

The bar for "critical": this test provides effectively zero safety. It would pass against a broken implementation, an empty implementation, or a regressed implementation. **Fix or delete these before doing anything else.**

### 1. Disabled tests masquerading as coverage

| File | Issue | Why critical |
|------|-------|--------------|
| `apps/server/src/middleware/principal.test.ts` | Entire file is `describe.skip` (lines 125, 138) | The file reviewers would assume covers the principal middleware's auth contract has zero active assertions. Coverage is only incidental via `principal-logging.test.ts`. |
| `apps/authoring/test/page-editor-preview.test.ts` | 100% `test.skip` — 350 lines of harness scaffolding | Zero executing assertions for the preview surface |
| `apps/authoring/test/page-editor-inspector.test.ts` | 4 central tests skipped | toggleSection, applyPreset, copy/paste round-trip, multi-select edits — all the inspector behaviors the file claims to cover |
| `apps/authoring/test/page-editor-outline.test.ts` | `moveWidget` integration skipped | Masks a documented `this`-binding bug in `state.ts` with no ticket |
| `adapters/node/test/cache-tenant-guard.test.ts` | Three `@ts-expect-error` directives marking a "RED PHASE" test | If currently passing, either the feature shipped (clean the directives) or the test is masquerading as red |

### 2. No-DB / no-runtime silent green

| File | Issue | Why critical |
|------|-------|--------------|
| `adapters/node/test/event-store-prepared.test.ts` | `const HAS_DB = ... \|\| true` plus per-test `if (!tenantSql) return;` | A no-DB environment reports four green tests with zero assertions executed. The DB-guard is **inverted** by `\|\| true`. |

### 3. Security tautology

| File | Issue | Why critical |
|------|-------|--------------|
| `apps/server/**` (repo-wide gap) | **No test asserts `X-Debug-Principal` is rejected when `testAuth.enabled=false`.** `principal-logging.test.ts:42` hard-codes `enabled: true`; every route test stamps `principal` via stub middleware, bypassing `principalMiddleware`. | A production auth-bypass regression honoring debug-principal would not be caught anywhere. |
| `modules/identity/test/a3-acceptance.test.ts:264-296` | Signs an RS256 JWT, asserts 3 segments + `asymmetricKeyType === 'rsa'`, but **never calls `createVerify`** to validate the signature round-trips | The only JWT-signing test in the suite. A regression in `createSign` config or a key-swap would pass green. |
| `modules/identity/test/platform-robot-principal.test.ts:398-417` | Test body is literally `expect(true).toBe(true)` | Stage-3 canary intent but zero safety |

### 4. Tautological assertion idioms

| File | Issue | Why critical |
|------|-------|--------------|
| `packages/dsl-expression/src/evaluator.test.ts` (L25-35, L85-94, L96-108) | Systematic `expect(r.ok && true).toBe(true)` collapses to `expect(r.ok).toBe(true)` on every boolean / comparison / logical-op case | The evaluator could return wrong booleans, fail to short-circuit, or return `true` for the literal `false` — suite still passes. Fix with an `unwrap()` helper across the file. |
| `apps/server/src/middleware/state.test.ts` | Asserts on hand-maintained `REQUEST_DISPATCHER_CHAIN_NAMES` string constants rather than introspecting real `composeDispatchers(...)` output | Drift between the constant array and the actual composed call stack stays green |
| `packages/widgets/test/data-table/filter-core.test.ts:80-89` | Test titled "function column accessor is honoured" actually verifies the OPPOSITE — locks in that function-key accessors are silently ignored | Mirror-implementation: the test name is a lie about the assertion |

### 5. Invariant marker not asserted

| File | Issue | Why critical |
|------|-------|--------------|
| `packages/platform-core/src/cache-key.test.ts:92-107` | Missing-tenant-tag test asserts `e.kind === 'InvalidPrivacyConfiguration'` but never reads `e.invariant === 'I9'` | The `CacheError` constructor takes `'I9'` as its third argument and the marker is load-bearing for the I9 invariant. Test suite is blind to it. Two adjacent moderate findings (`MissingRequiredKeyPart`, `USER`-privacy) also skip the readback. |

### 6. Bogus by inline-stub redirection

| File | Issue | Why critical |
|------|-------|--------------|
| `ports/test/analytics-store.test.ts` | Round-trip tests exercise an inline `StubAnalyticsStore` defined in the test file, not `InMemoryAnalyticsStore` from `@atlas/ports` | The port's only concrete implementation has zero behavioral coverage. Red-phase scaffold that never got switched to the real SUT after green. |

### 7. CLI subprocess coverage gap

| File | Issue | Why critical |
|------|-------|--------------|
| `apps/atlasctl/test/cli.test.ts` | Only `--help` and `version --json` are subprocess-tested | The HTTP-bound commands (`health`, `intents submit`) have zero end-to-end coverage. Coverage hole vs. bogus assertions but treated as critical given user-facing surface. |

## Recurring patterns (cross-batch themes)

1. **Skip culture.** `it.skip` / `describe.skip` / `test.skip` used to park work without an open ticket. Five separate files hit by this. Recommendation: **either delete the skipped block or attach a ticket id to every `.skip`**; a lint rule could enforce.
2. **Shape-only on event envelopes.** Several module-handler tests check `envelope.type` and event payload keys but skip `envelope.cacheInvalidationTags` for non-Created events (content-pages Update/Delete; authz archive). I10 violations would slip through.
3. **JWT / SAML cryptography asserted by side-effect.** SP key generation tests verify the function returned PEM-looking bytes but never roundtrip-parse them (`saml-sp-key.test.ts`, `a6-acceptance.test.ts`). JWT signing tests skip `createVerify`. Crypto regressions stay green.
4. **Mirror-implementation as documentation.** `state.ts`'s dispatcher chain is duplicated as a string constant in the test; the test asserts the constant matches itself. This pattern showed up multiple times — it gives reviewers a false sense of "the chain is tested".
5. **`waitForTimeout` as rejection assertion.** `apps/authoring/test/edit-drag-drop.test.ts` uses `waitForTimeout(300)` + assert-no-change to "verify" drag-rejection. Racy — assertion passes even if the rejection takes 301ms.
6. **`@ts-expect-error` RED-PHASE markers that may have flipped.** Found in `cache-tenant-guard.test.ts`. There's no mechanical check that distinguishes "still red" from "feature shipped — clean up markers".

## Exemplary tests — use as templates

When fixing or writing new tests, copy patterns from these:

- **`modules/identity/test/secret-hash.test.ts`** — crypto pinning against RFC vectors
- **`modules/identity/test/cross-tenant-isolation.test.ts`** — exhaustive tenant-isolation coverage
- **`modules/identity/test/break-glass.test.ts:186-199`** — 4-eyes self-approval guard
- **`modules/identity/test/session.test.ts:282-313`** — real I12 byte-equal replay
- **`modules/identity/test/password-login.test.ts:177-199`** — PII-reduction (emailHash) assertion
- **`modules/repository/test/dispatch.test.ts`** — model I12 rebuild test (mentioned by the modules/other batch as the pattern to copy)
- **`apps/server/test/intents.test.ts`** — real Hono app, I2/I3/I5/I7/I10/I12 named and exercised
- **`apps/server/test/admin-signups-provisioning.test.ts`** — behavioral over shape-only
- **`apps/admin/.../pages-list.test.ts`** — empty/success/error/loading/retry coverage (the asymmetric sibling `policies-list.test.ts` falls short)
- **`apps/atlasctl/test/doctor.test.ts`** — exemplary CLI test
- **`packages/core/src/signals.test.ts`** — exemplary reactive-primitive coverage
- **`packages/logging/src/redaction.test.ts:116-140`** — verifies redaction fires end-to-end via pipeline

## Status (2026-05-22)

The `.skip` / `.todo` ban landed:

- `.semgrep/atlas-invariants.yml` ▸ `atlas-no-skipped-tests` — error-severity rule banning `it.skip` / `it.todo` / `test.skip` / `test.todo` / `describe.skip` / `describe.todo` / `xit` / `xtest` / `xdescribe` across `adapters/ apps/ modules/ packages/ ports/ tests/ bundles/`. Two narrow documented exemptions (`tests/integration/**`, `modules/identity/test/bdd/runner.ts`) — see the rule body for the reason.
- Every previously-skipped test was **converted, not deleted** — `it.skip(name, fn)` lost its `.skip` (body runs); `it.todo(name)` became `it(name, function () { throw new Error('TODO: implement this test'); })` so the gap shows up red in the report instead of silent green.
- Env-gated suites (parity tests, adapter tests) refactored to `if (cond) { describe(...) } else { describe('… (skipped: ENV not set)', () => {}) }` — same behavior, no `.skip` syntax.
- One bogus `test.skip('name', fn)` in `tests/integration/public-signup.itest.ts:353` and one body-only-skip in `tests/integration/auth/saml-sso.itest.ts:119` both converted to real failing tests.

## Recommended fix order

1. **Unskip or convert.** Look at every `.skip` / `.todo` in the 14 critical list. The current state already converted them — running the test suite will now show explicit red failures where previously silent skips lived. Either fix the test now (preferred) or convert further as needed.
2. **Add the `X-Debug-Principal` strict-mode rejection test.** This is the single highest-leverage fix — one test in `apps/server/src/middleware/principal.test.ts` that sets `testAuth.enabled=false` and asserts the header is ignored. Once added, unskip the rest of `principal.test.ts`.
3. **Fix the `HAS_DB || true` inversion** in `event-store-prepared.test.ts` — change to `HAS_DB && tenantSql` guard, and skip-with-reason when no DB rather than passing silently.
4. **JWT and SAML round-trips.** Add `createVerify` to `a3-acceptance.test.ts`; round-trip-parse SP key/cert in `saml-sp-key.test.ts`.
5. **Introduce `unwrap()` in dsl-expression tests** and rewrite the `r.ok && true` tautologies as `expect(unwrap(r)).toEqual(expected)`.
6. **Read back `e.invariant === 'I9'`** in cache-key tests.
7. **Switch ports/analytics-store test to the real `InMemoryAnalyticsStore`** instead of the inline stub.
8. **Cache-tag assertions on non-Created envelopes** — content-pages Update/Delete, authz archive.
9. **Mirror-implementation purge.** Rewrite `state.test.ts` to introspect actual `composeDispatchers(...)` output. Fix the `filter-core.test.ts` misnamed test.
10. **CLI subprocess coverage** — extend `apps/atlasctl/test/cli.test.ts` to drive `health` and `intents submit` end-to-end with a stub server.

After this list, move into moderate findings (~35) per batch report.

## Closing the loop

These findings should each become a ticket in `tickets/testing-floor/sdet-review/fixes/` (or roll up into one fix-set ticket). Once landed, re-run the same 8 sdet sweeps to confirm the critical list shrank to zero. The `pnpm test-coverage:inventory:check` baseline gate catches coverage drift; this rollup catches assertion-quality drift — they're complementary.
