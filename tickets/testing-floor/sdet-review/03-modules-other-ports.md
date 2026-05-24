# SDET review — modules/other + ports

## Summary

- Total files reviewed: 10
- Files clean: 5
- Files with findings: 5
- Critical: 1
- Moderate: 6
- Style: 2

## Files reviewed

1. `modules/authz/test/handlers.test.ts`
2. `modules/content-pages/test/handlers.test.ts`
3. `modules/dsl/test/handler.test.ts`
4. `modules/dsl/test/queries.test.ts`
5. `modules/repository/test/dispatch.test.ts`
6. `modules/repository/test/handlers.test.ts`
7. `modules/tenancy/test/signup-approve.test.ts`
8. `ports/test/analytics-store.test.ts`
9. `ports/test/dispatcher.test.ts`
10. `ports/test/query-registry.test.ts`

(No `modules/catalog/test/*.test.ts` files exist in scope; the catalog module
has none.)

## Findings by file

### modules/authz/test/handlers.test.ts

- **L116–128 [MODERATE] cache-tags-not-asserted (partial)** — `it('saves a draft and assigns version 1 when first')` asserts `cacheInvalidationTags === ['Tenant:t1']` for the **PolicyDrafted** event. Good. But the symmetric assertion for **`Authz.PolicyArchived`** (L174–181 `archives a draft fine`) never inspects `envelope.cacheInvalidationTags`. If `handleArchivePolicy` shipped without tags, this suite would still be green for that case. The activate path is covered by L160–165; archive is not. Add `expect(envelope.cacheInvalidationTags).toEqual(['Tenant:t1'])` (or whatever the contract is — possibly `['Tenant:t1', 'Policy:1']`) to the archive test.
- **L106–114 [MODERATE] tenant-scope-missing** — None of the authz tests run with two tenants. The in-memory store filters by `tenantId`, but no test ever creates policies for `t1` and `t2` and asserts cross-tenant isolation (e.g. `list('t2')` returns nothing after `t1` policies are seeded; activating in `t1` does not demote an active in `t2`). For an authorization module this gap is meaningful — I7/I9 cross-tenant leakage would not be caught here.
- **General [STYLE] dead-setup** — `principalId: 'u1'` is fed in but `result.envelope.principalId` is never asserted on creation; only emit-shape and version are. Not a bug, but the principal threading is part of the contract and could regress silently.

### modules/content-pages/test/handlers.test.ts

- **L297 [MODERATE] cache-tags-not-asserted** — `it('updates the title + render tree on dispatch')` checks `envelope.eventType === 'ContentPages.PageUpdated'` but never asserts `envelope.cacheInvalidationTags`. The `PageCreated` case at L212 asserts `['Tenant:t1', 'Page:welcome']`; the **Update** and **Delete** cases (L298–342, L357–373) do not. A regression that dropped the `Page:<id>` tag from update/delete events would not be caught — and these are exactly the events whose tags drive read-after-write cache invalidation.
- **L319–341 [MODERATE] weak-assertion** — `preserves createdAt while bumping updatedAt` uses `setTimeout(r, 5)` to manufacture a wallclock delta. On Windows CI this is racy at low load: 5 ms of wallclock can be smaller than the system clock's resolution for `new Date().toISOString()` (especially in tests pinned to whole-second buckets). Prefer injecting `now()` into the entity store (or stub `Date.now`) — otherwise this test flakes.
- **L374–392 [MODERATE] tenant-scope-missing** — `dispatchContentPagesEvent > ignores non-content-pages events` is the only dispatcher exercise in the file. There is NO test that feeds a synthetic `[PageCreated, PageUpdated, PageDeleted]` event stream into a fresh dispatcher and asserts the resulting projection — the I12 rebuild invariant is only covered for repository, not for content-pages. The current "writes the Page entity ... via the dispatcher" tests cover the dispatcher running once after a handler, but not from-scratch rebuild from event history. Add an I12-style test that mirrors `modules/repository/test/dispatch.test.ts`.

### modules/dsl/test/handler.test.ts

- **L23–37 [MODERATE] mock-the-sut (mild)** — `makeFakeEventStore` returns an `EventStore` shape that **only implements `append`**; everything else is cast through `as unknown as`. Inside `handleDslUpdate` there is presumably no other call against the store, but the cast means a refactor that adds, say, `findByIdempotencyKey` lookup before append would silently get `undefined` at runtime. The test would still pass under the current code path, hiding a future idempotency-check regression.
- **L114–126 [MODERATE] idempotency-not-asserted-end-to-end** — `idempotencyKey is deterministic per (tenant, apiName, version)` asserts the **first** call's key matches the formula. It does NOT replay the same command with the same key and assert no second event is appended. The fake event store does not even dedupe on `(tenantId, idempotencyKey)` — so I3 (idempotency holes) cannot be exercised here. Either teach `makeFakeEventStore` to dedupe like the production adapter does, or add an explicit "duplicate idempotency key emits nothing" test.

### modules/dsl/test/queries.test.ts

`clean` — Read-side query tests against the real handler-seeded store; no obvious bogus assertions. Worth noting that none of these tests cross tenants (every artifact is `tenant-a`), so cross-tenant scoping for `listDslArtifacts` / `getDslArtifact` is untested — flagging as Style, not a finding.

- **General [STYLE] tenant-scope-missing** — All five read-side tests use `tenantId: 'tenant-a'`. No assertion that `listDslArtifacts({tenantId: 'tenant-b'}, 'expression')` returns `[]` after seeding under `tenant-a`. Cheap to add.

### modules/repository/test/dispatch.test.ts

`clean`. This is the canonical I12 rebuild test the other modules should be modeled on — feeds `[Created, Uploaded, Uploaded]` through a fresh dispatcher, asserts equivalence with the inline-dispatch path, AND replays for idempotency. The "ignores events outside the repository event-type set" case closes the negative.

### modules/repository/test/handlers.test.ts

`clean`. Covers all six acceptance contract items from the spec docstring, asserts `cacheInvalidationTags` on both `Repository.Created` and `Repository.Uploaded` (including the per-revision tag), asserts that no event is appended on hash-mismatch, asserts cross-tenant slug separation, and asserts idempotency on `(tenantId, repoSlug)` returns the existing repoId without re-emit. This is the gold-standard module test in this set.

### modules/tenancy/test/signup-approve.test.ts

`clean`. Very thorough — mailer-failure rollback, idempotency-on-retry with revoke-before-mint ordering, audit-event tag assertion (`['Tenant:acme', 'Signup:signup-abc']`), no plaintext token on the audit payload, and the `SIGNUP_NOT_PENDING` rejection path explicitly asserts no side-effects ran (`createCalls/issueInviteCalls/mailer.sends/events all empty`). Solid I2/I3-style scenario coverage.

### ports/test/analytics-store.test.ts

- **L57–96 [CRITICAL] type-only — passes-with-empty-impl** — The first three tests (`interface exposes ...`, `AnalyticsEvent has the documented camelCase shape`, `AnalyticsQuery only requires tenantId`) only exercise `expectTypeOf<...>` and object-literal construction. **They run zero production code.** They pass iff the types compile. The runtime tests at L97 onward exercise only `StubAnalyticsStore`, defined inline in the test file — there is no production implementation under test. The header at L1–30 notes this was written as a red-phase failing test expecting `Module '"@atlas/ports"' has no exported member 'AnalyticsStore'.` — that red has gone green, but the file is still asserting on a stub it defines itself, not on `InMemoryAnalyticsStore` from `@atlas/ports`. Flag as `mock-the-sut`: the SUT in `'AnalyticsStore port (TS surface)'` is supposed to be the *port shape*; the round-trip tests should run `InMemoryAnalyticsStore` (per `ports/CLAUDE.md`: "InMemoryAnalyticsStore — concrete impl"). Right now if someone shipped `InMemoryAnalyticsStore` with a broken `query()` filter, these tests would not catch it.

### ports/test/dispatcher.test.ts

`clean`. Exhaustive — happy path, null/undefined skipping, throw-still-runs-rest (the Chunk 11 semantics fix), only-first-error rethrow, serial await ordering, same-envelope identity, and the `Promise.reject(undefined)` sentinel guard. Asserts behavior, not just shape.

### ports/test/query-registry.test.ts

`clean`. Covers all six cases the docstring promises, plus three extras (missing `actionId`, missing `resource.type`, `cacheKey()` that throws on the smoke call). The pattern-rejection tests at L186–192 exercise three distinct failure modes and at L121–134 verifies the original survives a rejected duplicate (not just that the duplicate threw).

## Skipped/todo'd tests

None found.

## Recommended fixes (priority order)

1. **CRITICAL — `ports/test/analytics-store.test.ts`:** swap `StubAnalyticsStore` for `InMemoryAnalyticsStore` (imported from `@atlas/ports`) in the round-trip and time-window/limit tests. The type-shape tests can stay as type-only smoke. Without this swap the port has zero behavioral coverage on its only concrete impl.
2. **MODERATE — `modules/content-pages/test/handlers.test.ts`:** add `cacheInvalidationTags` assertions to the **Update** and **Delete** envelope tests; add an I12-style "fresh dispatcher replays `[Created, Updated, Deleted]` and matches inline state" test alongside the existing "ignores non-content-pages events" test.
3. **MODERATE — `modules/authz/test/handlers.test.ts`:** add a `cacheInvalidationTags` assertion to the archive case and a two-tenant isolation test (write under `t1` and `t2`; activating in `t1` does not demote `t2`'s active; `list('t2')` is empty after seeding only `t1`).
4. **MODERATE — `modules/dsl/test/handler.test.ts`:** teach `makeFakeEventStore` to dedupe on `(tenantId, idempotencyKey)` like the real adapter, and add a "duplicate idempotency key emits no second event" case. Without this the determinism test at L114 is shape-only.
5. **MODERATE — `modules/content-pages/test/handlers.test.ts` L319:** replace the `setTimeout(r, 5)` wallclock dependency with injected `now()` to remove the racy `updatedAt` assertion on Windows CI.
6. **STYLE — `modules/dsl/test/queries.test.ts`:** add cross-tenant scoping assertions (`listDslArtifacts` for `tenant-b` returns `[]` after seeding `tenant-a`).
