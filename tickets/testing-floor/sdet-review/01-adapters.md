# SDET review — adapters (35 files)

Read-only adversarial review of every `*.test.ts` under `adapters/`. Many
files are thin contract-suite wrappers (`cacheContract(factory)` etc.) and
contain no `expect` of their own — that is by design (the assertions live
in `@atlas/contract-tests/src/<port>.ts`) and is NOT bogus. They are flagged
only if the wrapper has additional defects (e.g. the contract suite is
gated behind a `HAS_DB === true` literal that always evaluates to true, or
the factory pre-cleans state in a way that hides real adapter bugs).

## Summary

- Total files reviewed: 35
- Files clean: 27
- Files with findings: 8
- Critical: 4 | Moderate: 6 | Style: 4

## Findings by file

### adapters/idb/test/cache.test.ts
clean (thin contract wrapper)

### adapters/idb/test/catalog-state-store.test.ts
clean (thin contract wrapper)

### adapters/idb/test/compression.test.ts
clean (thin contract wrapper)

### adapters/idb/test/control-plane-registry.test.ts
clean (thin contract wrapper)

### adapters/idb/test/event-store.test.ts
clean (thin contract wrapper)

### adapters/idb/test/projection-store.test.ts
clean (thin contract wrapper)

### adapters/idb/test/search-engine.test.ts
clean (thin contract wrapper)

### adapters/idb/test/secret-store.test.ts
clean (thin contract wrapper)

### adapters/idb/test/multi-tab-stress.test.ts
- L144 [MODERATE] weak-assertion — `it('cross-tab cache writes + invalidations leave a consistent state')` asserts `expect(aPurged + bPurged).toBe(8)`, then immediately `expect(aPurged).toBeGreaterThanOrEqual(0)` and `expect(bPurged).toBeGreaterThanOrEqual(0)`. Both lower-bound assertions are trivially true for any non-negative integer return (the type system already guarantees `number`); the test comment promises "no double-counting" but a return of `aPurged=8, bPurged=0` and the bogus return `aPurged=12, bPurged=-4` would both pass since the `===8` sum is the only real check. Tighter would be `expect(aPurged).toBeLessThanOrEqual(8); expect(bPurged).toBeLessThanOrEqual(8)` plus the sum.

### adapters/idb/test/worker-source.test.ts
clean

### adapters/node/test/compression.test.ts
clean (thin contract wrapper)

### adapters/node/test/control-plane-registry.test.ts
clean (thin contract wrapper)

### adapters/node/test/crypto.test.ts
clean (thin contract wrapper)

### adapters/node/test/secret-store.test.ts
clean (thin contract wrapper)

### adapters/node/test/cache-tenant-guard.test.ts
- L33–73 [CRITICAL] mirror-implementation / RED-PHASE drift — Three of the four `it()` bodies use `@ts-expect-error` to push a `privacy:` field the implementation does not accept yet. Per the file docblock at L27 "RED PHASE: this file is expected to fail compilation today." A test that is *expected* to fail compilation is not running and provides no safety. If it currently compiles, then either (a) the `@ts-expect-error` directives are unused (TS6133) and the test *should* be failing compilation right now, blocking the suite, or (b) the feature landed and the directives were never cleaned up — in either case nobody is being told. Verify: either ship the `privacy` field and strip the directives, or convert these to `test.skip` with a ticket so they don't masquerade as passing tests.
- L78 [STYLE] skipped/todo — `test.skip('TEST_TENANT_DB_URL not set — skipping Postgres I9 guard tests')` is the documented skip pattern; flagged for the inventory only.

### adapters/node/test/cache.test.ts
- L13 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/catalog-state-store.test.ts
- L13 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/custom-domain-store.test.ts
- L88–101 [MODERATE] tenant-scope-missing-edge — `it('list returns rows for one tenant only')` inserts rows for both `TENANT_A` and `TENANT_B`, then asserts `list(A)` has 2 rows and `list(B)` has 1. It does NOT assert that A's rows are missing from `b`, only that B's row count is 1. If the SUT returned `b`'s expected hostname *plus* an A-tenant row (length 2, wrong contents) the count assertion would still fail — but the intent ("isolation") is undertested. Adding `expect(a.map(r => r.tenantId)).toEqual([TENANT_A, TENANT_A])` and the equivalent for `b` would harden the isolation claim. As-is, this is moderate because the count + hostname comparison ARE checked separately.
- L19 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/event-store.test.ts
- L13 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/projection-store.test.ts
- L13 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/repository-store.test.ts
- L17–32 [MODERATE] tenant-scope-missing — the contract suite's cross-tenant isolation test is documented as DROPPED in this factory (no `freshOtherTenant`). The docblock explains the connection-level rationale, but no adapter-local test substitutes a tenant-isolation assertion. The `tenant-db-provider.test.ts` (f-d) covers data isolation via `entities`, but the repository tables (`repository_objects`, etc.) are not exercised by that test, so any future `WHERE tenant_id = ?` regression specific to repository queries would slip through every Postgres test we run.
- L35 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/search-engine.test.ts
- L13 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/worker-source.test.ts
clean — strong assertions on event delivery, cursor persistence, and close semantics, with timeouts that fail loud rather than hang.

### adapters/policy-cedar/test/cache-invalidation.test.ts
clean — every test asserts both the populated set AND that the other branch (`invalidatedAll === 0` or `invalidated === []`) did not fire.

### adapters/policy-cedar/test/cedar-check-cli.test.ts
- L66–73 [CRITICAL] passes-with-empty-impl — `test('engine.validate flags a policy that references a non-existent action')`. The branch logic is `if (answer.type === 'success') { expect(answer.validationErrors.length).toBeGreaterThan(0); } else { expect(answer.errors.length).toBeGreaterThan(0); }` — but if `validate` returns `{type:'failure', errors:[<unrelated parser bug>]}` on a totally healthy policy too, this test still passes. The "non-existent action" claim is the whole point; nothing here pins that the error MESSAGE actually mentions the action name (the sister test `schema-generator.test.ts:151–157` does this correctly with `toMatch(/NoSuchAction|undeclared action/i)`). Recommend mirroring that regex.

### adapters/policy-cedar/test/cedar-policy-engine.test.ts
clean — strong, behavior-anchored assertions. The `cache invalidation` test (L164–192) is particularly good: it asserts the *cached* lookup returns the OLD result, then asserts the *invalidated* lookup returns the NEW result, so a no-op `invalidate()` implementation would fail.

### adapters/policy-cedar/test/schema-generator.test.ts
- L82–84 [MODERATE] weak-assertion — `test('inferred resource entity types when manifest forgets to list them')` asserts only `expect(ns.entityTypes['Foo']).toBeDefined()`. If the generator inferred `Foo` as `{ shape: 'wrong' }` or `null`, this still passes. A `.toEqual({})` (matching the pattern in the L65–73 User-entity test) would catch a wrong-shape regression.
- L141–161 [MODERATE] either-or branch swallows — the policy-fails-validation test uses the same either-or branching as the cedar-check-cli test; here the message regex IS present in the success branch (L157), but the failure branch (`expect(answer.errors.length).toBeGreaterThan(0)` at L160) accepts ANY parse error for any reason. Recommend asserting the message regex in BOTH branches.

### adapters/seed-memory/test/contract.test.ts
clean — the contract suite carries the assertions; the three adapter-local regression pins (L102–155) check real behavior with values, not just shape.

### adapters/policy-stub/test/stub-policy-engine.test.ts
clean (thin contract wrapper)

### adapters/node/test/tenant-db-provider.test.ts
- L504–514 [MODERATE] mock-call-count-only / over-pinned-implementation-detail — `it('(f4) concurrent provisionTenantDatabase calls for the same tenant are de-duped')` asserts `aProvisioned.length === 1` and `bProvisioned.length === 0`. The accompanying comment at L502 explicitly notes that "the looser `a + b === 1` assertion was satisfied by either ordering" — so the test pins WHICH caller wins the inFlightProvision race, which is implementation-detail of `Promise.all`'s dispatch order, not contract. A future Node update that flips Promise.all ordering would break the test without breaking the contract. Recommend reverting to `expect(aProvisioned.length + bProvisioned.length).toBe(1)` and keeping the prose comment.
- L529–531 [CRITICAL] try-swallow shape — the f4-clear-on-reject path uses `await expect(...).rejects.toBeInstanceOf(TenantNotFoundError)`. Good for that line. But Step 3 (L539–543) only asserts `result.dbName` and `result.created` — it does NOT verify that the in-flight map slot was actually cleared (the SUT could be returning a hit from a different code path). A direct assertion like `expect((provider as any).inFlightProvision.has(TENANT_A)).toBe(false)` post-resolution would actually exercise the clear; without it, this test could pass if the clear-on-reject never happens but the second call goes through a totally different code path.
- L59 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/mailer-smtp.test.ts
- L184–191 [MODERATE] tenant-scope-missing on error path — `it('throws and skips email_log insert when SMTP rejects')` asserts `calls.length === 0` (good — no phantom row), but does NOT assert that the rejected message's body (which may contain magic-link credentials) is not logged to stdout. The stdout mailer has a credential-leak regression guard; the SMTP mailer's failure path should at minimum confirm no `console.log` happens during the error path. Without it, a future refactor that logs the body on send-failure (a common "for debugging" trap) would pass this test.

### adapters/node/test/mailer-stdout.test.ts
clean — the body-leak regression test (L128–157) is exemplary: asserts NOT a property, NOT a substring of the raw line, AND verifies the non-secret fields are still present. This is the right shape for a credential-leak guard.

### adapters/policy-cedar/test/audit-emitter.test.ts
clean — every payload field is value-checked, not shape-checked.

### adapters/node/test/dsl-artifact-store.test.ts
- L29–34 [CRITICAL] mock-the-sut / pre-clean hides bugs — the factory unconditionally runs `DROP TABLE IF EXISTS public._atlas_dsl_*` before every test. The docblock argues this exercises lazy bootstrap "on every test rather than once," which is fine — BUT it also means an adapter bug where bootstrap silently fails to create the table on the second call (e.g., a one-shot init flag that doesn't reset across instances) would be masked. A `DROP TABLE IF EXISTS` in the factory hides "init-once" bugs that production would hit on the second tenant DB. Recommend at least one test that does NOT drop the tables, so the cross-instance bootstrap path is exercised honestly.
- L21 [STYLE] skipped/todo — documented HAS_DB skip pattern; inventory only.

### adapters/node/test/event-store-prepared.test.ts
- L52–54 [CRITICAL] passes-with-empty-impl / always-on guard — `const HAS_DB = ... || true;` with the comment "default-on against local make-db-up; flip to false on CI without DB." This is a foot-gun: CI either runs all four tests against a DB they don't have (silent skip via the `if (!tenantSql) return;` early-returns at L140–143, 157, 165, 177), OR the `|| true` literal is overridden by env. Inside each test, the early `return` with no expect runs makes the test **pass with no assertions** if `tenantSql` is null — that is a textbook no-assertion bogus test on the no-DB path. Either gate the whole suite behind `HAS_DB` properly (matching `_setup.ts`'s pattern of an `it.skip` placeholder) or use `test.skip()` from inside each test body — the current "silent return = pass" shape means a CI run with no DB reports four green tests for code that never executed.
- L132 [MODERATE] tenant-scope-missing — `cacheInvalidationTags: ['Tenant:test', 'Signup:s1']` uses `Tenant:test` as the literal value rather than `Tenant:${provisionedTenantId}`. The first test (L146) DOES use the dynamic tenant id, but `makeEnvelope`'s default falls back to a hardcoded `'Tenant:test'`. If a future test omits the explicit override (currently only L146 does so), it would emit an event with a tenant tag that does not match the envelope's `tenantId` — undermining the I10 contract this test is meant to verify.

## Skipped/todo'd tests

All `.skip` instances below are documented HAS_DB / TEST_TENANT_DB_URL gates and are inventory items, not defects:

- adapters/node/test/cache.test.ts:L13 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres cache contract')
- adapters/node/test/cache-tenant-guard.test.ts:L78 test.skip('TEST_TENANT_DB_URL not set — skipping Postgres I9 guard tests')
- adapters/node/test/catalog-state-store.test.ts:L13 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres catalog state contract')
- adapters/node/test/custom-domain-store.test.ts:L19 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres custom-domain contract')
- adapters/node/test/dsl-artifact-store.test.ts:L21 it.skip('TEST_TENANT_DB_URL not set — skipping DSL artifact store contract tests')
- adapters/node/test/event-store.test.ts:L13 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres event store contract')
- adapters/node/test/projection-store.test.ts:L13 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres projection store contract')
- adapters/node/test/repository-store.test.ts:L35 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres repository-store contract')
- adapters/node/test/search-engine.test.ts:L13 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres search engine contract')
- adapters/node/test/tenant-db-provider.test.ts:L59 it.skip('TEST_TENANT_DB_URL not set — skipping db-per-tenant provisioning tests')
- adapters/node/test/worker-source.test.ts:L153 it.skip('TEST_TENANT_DB_URL not set — skipping Postgres worker source tests')

Total `.skip`: 11 — all environment-gated, none silently swallowed.

## Recommended fixes (biggest wins first)

1. **`adapters/node/test/event-store-prepared.test.ts` (CRITICAL).** Remove the `|| true` HAS_DB literal; gate the entire `describe` behind a real env probe and use `it.skip` for the no-DB case, matching the rest of `_setup.ts`. The current silent-return-pass shape makes four tests report green when nothing ran.

2. **`adapters/node/test/cache-tenant-guard.test.ts` (CRITICAL).** Resolve the RED-PHASE state: either ship `privacy:` on `CacheSetOptions` and remove the three `@ts-expect-error` directives, or replace these with `test.skip` plus a tracking ticket. A test "expected to fail compilation today" is not a passing test, but the way the test runner currently reports it is ambiguous.

3. **`adapters/node/test/dsl-artifact-store.test.ts` (CRITICAL).** The pre-test DROP TABLE hides cross-instance bootstrap bugs. Add at least one test that reuses an already-bootstrapped table.

4. **`adapters/policy-cedar/test/cedar-check-cli.test.ts` (CRITICAL).** Pin the error message regex in both branches of the validate-fails test, otherwise any unrelated parse error counts as success.

5. **`adapters/node/test/tenant-db-provider.test.ts` (MODERATE).** Loosen the f4 ordering assertion from `a===1, b===0` back to `a+b===1` — ordering is `Promise.all` implementation detail.

6. **`adapters/node/test/repository-store.test.ts` (MODERATE).** Add a tenant-isolation assertion specific to repository tables; relying solely on `tenant-db-provider`'s `entities` isolation test leaves repository-specific `WHERE tenant_id` regressions uncaught.

7. **`adapters/node/test/mailer-smtp.test.ts` (MODERATE).** Add a "body not leaked on SMTP failure" assertion to mirror the stdout mailer's credential-leak guard.

8. **`adapters/policy-cedar/test/schema-generator.test.ts` (MODERATE).** Tighten the inferred-entity-type assertion from `.toBeDefined()` to `.toEqual({})`.

9. **`adapters/idb/test/multi-tab-stress.test.ts` (MODERATE).** Tighten the no-double-count guard from `>=0` (trivially true) to `<=8`.

10. **`adapters/node/test/custom-domain-store.test.ts` (MODERATE).** Add explicit cross-tenant assertions on `list()` (every row's `tenantId` equals the queried tenant).
