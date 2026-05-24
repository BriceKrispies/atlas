# SDET review — `apps/server/**/*.test.ts`

Adversarial pass over the 23 colocated and out-of-tree tests under
`apps/server`. This is the production HTTP boundary (Invariant I1), so
the bar is higher than for any other batch. Focus: auth-bypass coverage,
tenant-isolation coverage, error-envelope shape, idempotency, status-code
discipline.

## Summary

- **23 files** reviewed; **3 critical**, **6 moderate**, **2 style** findings.
- Two files are 100% structural / fixture-only — they don't exercise
  production code and don't pretend to (`f3-kernel-handle.test.ts` is all
  `test.todo`; `f1` / `f2` are schema-shape probes). They are NOT bogus —
  they intentionally encode known gaps as failing checks tied to tickets.
  Style note only.
- The big production-path files (`intents.test.ts`, `errors.test.ts`,
  `dispatcher-chain.test.ts`, `events.test.ts`, `identity-a7.test.ts`,
  `repositories.test.ts`, `queries.test.ts`) are unusually strong — real
  Hono apps, I2/I3/I5/I7 named and exercised. Where the rubric flags
  these, it is for specific narrow gaps, not for being shape-only.
- The principal middleware coverage has a **critical hole**:
  `debug-principal-leak-not-tested`. No test asserts that
  `X-Debug-Principal` is REJECTED when `testAuth.enabled=false`.
- One file has a critical `auth-bypass-not-tested` finding:
  `principal.test.ts` itself — every active assertion is `describe.skip`'d.
  The "happy" and "rejection" paths of the production principal middleware
  are covered ONLY by `principal-logging.test.ts`, which is incidental.

## Critical findings

### `apps/server/src/middleware/principal.test.ts` — `auth-bypass-not-tested` + `skipped/todo`

- **Lines 125–173:** Every meaningful test in this file is `describe.skip`. The file is
  the only one named `principal.test.ts` and the most obvious place a reviewer
  would look for principal-middleware auth coverage. It contains 4 tests
  asserting `principalType` / `claims` field population — all skipped pending
  field additions to the `Principal` type. There is **no active test in this
  file**.
- The actual production middleware (JWT path, X-Debug-Principal happy path,
  X-Debug-Principal rejection path, missing-Authorization rejection) is
  exercised in `principal-logging.test.ts` — but that file tests **log
  emissions**, not the auth contract per se. It happens to cover three
  branches (success + malformed + missing) because it needs to fire log
  lines, but it's not the canonical home and a reviewer scanning
  `principal.test.ts` would conclude principal middleware is untested
  ahead of merging a regression. **Recommendation:** either un-skip the
  parity tests (the type extension exists for `principalType` according
  to the comments — verify), or rename/refile so the principal
  middleware's actual contract has a clearly-named test home.

### Repo-wide gap (multiple files): `debug-principal-leak-not-tested`

- **Production strict-mode behavior is untested.** Per `apps/server/CLAUDE.md`,
  `X-Debug-Principal` is "only when `TEST_AUTH_ENABLED=true`. Production
  deployments must not set this." But no test in the batch asserts that
  the principal middleware **rejects** `X-Debug-Principal` when
  `testAuth.enabled=false`.
- `principal-logging.test.ts:42–51` hard-codes `testAuth: { enabled: true }`.
  `errors.test.ts`, `admin-logging.test.ts`, `docs.test.ts`, `identity-a7.test.ts`,
  `events.test.ts`, `repositories.test.ts`, `queries.test.ts`, `intents.test.ts`
  all stamp `principal` directly via a stub middleware (or attach test middleware) —
  bypassing `principalMiddleware` entirely. So the strict-mode rejection branch
  has zero coverage anywhere in `apps/server`.
- **This is the single highest-leverage gap in the batch.** A regression
  that makes `X-Debug-Principal` honored in production would not be caught
  by any test in `apps/server`. Recommend a targeted test in
  `principal.test.ts` (or a new `principal-strict-mode.test.ts`) covering:
  `testAuth.enabled=false` + `X-Debug-Principal` header → 401, with the
  header value ignored and no principal stamped.

### `apps/server/src/middleware/state.test.ts` — `mirror-implementation`

- **Lines 30–91:** The entire test file asserts on `REQUEST_DISPATCHER_CHAIN_NAMES`
  (an exported string array from `state.ts`) and the matching constant from
  `tenant-loop.ts`. The test does not exercise *the chain* — it asserts that two
  hand-maintained string arrays are equal in shape. If a developer changes the
  real `composeDispatchers(...)` order in `state.ts` BUT forgets to update the
  exported `REQUEST_DISPATCHER_CHAIN_NAMES` constant, the test stays green
  and production composition drifts undetected.
- **The test mirrors the docstring of the thing it claims to test.** The
  invariant the file's docstring asserts ("the lists are the source of truth
  for the names that the actual `composeDispatchers(...)` call sites pass to
  `wrap(...)`") is not mechanically enforced anywhere — it's a comment.
- **Recommendation:** add a runtime probe that introspects the dispatchers
  the actual `buildRequestBundle` registers (call the production composition
  and read `.name` off each composed function, or capture them via a
  spy-wrapping `wrap()`). Until then this test is a coverage-shape ornament,
  not a regression catcher.

## Moderate findings

### `apps/server/test/always-on/f2-event-envelope-chain-version.test.ts` — `tautology` + `mirror-implementation`

- **Lines 62–63:**

  ```ts
  const _typeProbe: keyof EventEnvelope = 'dispatcherChainVersion' as keyof EventEnvelope;
  expect(_typeProbe).toBe('dispatcherChainVersion');
  ```

  The cast `'dispatcherChainVersion' as keyof EventEnvelope` forces the type at
  the assignment, then asserts that `_typeProbe` equals the string it was just
  assigned. This is a literal `x = 'foo'; expect(x).toBe('foo')` — tautology.
  The cast defeats the type system, so the assertion is structurally
  guaranteed to pass.
- The schema-property test at line 29 is fine. The TypeScript probe at
  37–63 is a pretend-test; it stays green whether `EventEnvelope` has the
  field or not. The file is marked "expected to FAIL" but only the schema
  half can actually fail. Recommend deleting lines 47–63 entirely or
  replacing with `expectTypeOf` in a `.test-d.ts`.

### `apps/server/src/routes/admin-logging.test.ts` — `status-code-only` (partial)

- **Lines 136–140:** `'admin gets through with 200'` asserts only the status code,
  no body shape. A regression that returns `200 OK {}` (empty payload) would
  pass. The companion test at 144–153 reads body shape correctly, so the
  signal isn't lost — but the gate test alone is shape-only.
- **Lines 156–164, 184–199:** Status-code-only on the set-level routes. The
  POST `/levels/global` returns a snapshot; the test only verifies the
  side-effect on `levelController.snapshot().global`, not the response body.
  A regression that drops the response body (or returns the wrong shape)
  goes undetected. The `levelController.snapshot()` assertion catches the
  *behavior*, so this is moderate, not critical.

### `apps/server/src/routes/docs.test.ts` — `status-code-only`

- **Lines 71–80:** `/docs` test reads body and checks substrings — good. But
  **lines 84–95** (the admin-gate rejection tests) check only status code
  (401 / 403) with **no error-envelope check**. Per the rubric's
  `error-envelope-not-checked` heuristic: regression to a 401 with
  `{ error: { code: 'WRONG_CODE' } }` or no error envelope at all would pass.
  Smoke-test status-only is acceptable for HTML routes, but the admin gate
  is shared between admin-logging, docs, and others — at least one of these
  should assert the error envelope shape.

### `apps/server/src/routes/events.test.ts` — `status-code-only` (narrow)

- **Lines 149–153:** `'rejects unauthenticated requests'` asserts only `res.status === 401`.
  No error envelope check. The principal middleware emits a structured envelope
  per the error taxonomy; a regression to a 401 with no body or wrong code passes.
  Moderate because the rest of the file is strong.

### `apps/server/src/middleware/principal-logging.test.ts` — `mock-the-sut` (boundary)

- **Lines 41–56:** `state` is built as `{ config, logPipeline, levelController, jwks, migratedTenants } as unknown as AppState`. The comment justifies this clearly. But the JWT-resolution path is gated on `state.jwks` being non-null AND the bearer header being present. With `jwks: null`, the JWT branch is impossible to exercise. The file admits this ("The full auth surface (JWT, API key, OAuth, impersonation) requires more scaffolding…") and explicitly defers to the smoke script + Playwright spec. **Net:** the JWT path is uncovered at the unit level in this batch; the deferral is honest but the comment doesn't guarantee the smoke/Playwright suites cover it. Recommend confirming JWT-rejection coverage exists somewhere observable, or filing a ticket.

### `apps/server/test/routes/intents.test.ts` — `tenant-isolation-not-tested` (narrow)

- The file covers authz deny (I2), idempotency (I3), correlation (I5), and bundle-build failure. **It does not cover cross-tenant request rejection** — e.g. principal in tenant A submitting an envelope with `tenantId: 'tenant-b'`. The route's behavior under that scenario (rejection, mapping to a forbidden envelope code) is the load-bearing tenant-isolation check at the most-important HTTP route. Recommend adding: principal `{ tenantId: 'A' }` + envelope `tenantId: 'B'` → 403 with a clear error code, no events appended.

### `apps/server/src/routes/identity-a7.test.ts` — `error-envelope-not-checked` (narrow)

- **Lines 393–411:** `'rejects javascript: URL in ticketUrl'` checks the error code. But many other validation tests in the same file (449–469 — `out-of-range maxDurationMin`; 470–488 — `malformed tenantId`; 367–384 — break-glass API-key path) check only `res.status === 400` or `403`. A regression that returns 400 with a wrong code (e.g. `BAD_REQUEST` instead of the specific `IMPERSONATION_*` taxonomy code) passes silently. Moderate — the route's error taxonomy is the contract; status-only assertions don't enforce it.

## Style findings

### `apps/server/test/always-on/f3-kernel-handle.test.ts` — `todo-in-body` (intentional)

- Entire file is `test.todo` (lines 44, 50, 183). This is **intentional**, well-documented, and points at real tickets — it pins the gap that the right surface for the assertion (a `.test-d.ts` for the type contract, a dep-cruiser rule for the import-graph contract) is the responsibility of a different scaffold. Not bogus. Style note: a `test.todo` file produces noise in test reports; consider folding into a single TODO comment in the relevant spec instead.

### `apps/server/test/always-on/f4-handler-registry-swap.test.ts` — `dead-setup` (minor)

- **Lines 183–187:** the final `test.todo` is a placeholder pinning a future "two-request swap" scenario. Fine in principle — the file's other three tests are behavioral. The placeholder's "Tracked in tickets/atlas-on-atlas/phase-1-action-routing.md (placeholder until set lands)" was true at commit time but the ticket set may have landed since. Recommend periodic sweep.

## Skipped / todo inventory

| File | Skipped | Todo |
|------|---------|------|
| `principal.test.ts` | 4 (entire `describe.skip` block, lines 125, 138) | 0 |
| `f3-kernel-handle.test.ts` | 0 | 2 (lines 44, 50) |
| `f4-handler-registry-swap.test.ts` | 0 | 1 (line 183) |

All other files: 0 skipped, 0 todo.

## Strengths worth calling out

- `intents.test.ts`, `errors.test.ts`, `dispatcher-chain.test.ts`, `identity-a7.test.ts`,
  `repositories.test.ts`, `queries.test.ts`, `admin-signups-provisioning.test.ts`:
  these are real tests. They wire real Hono apps, exercise real production handlers,
  name I2 / I3 / I5 / I7 / I12 in test descriptions and actually assert them. Several
  catch specific named regressions ("does NOT collapse to TRANSACTION_FAILED / 500 —
  the regression this slice closes") which is the gold standard.
- `dispatcher-chain.test.ts`: covers I10 (cache-tag dispatcher) + per-tenant isolation
  + partial-failure semantics. Long but every assertion earns its keep.
- `admin-signups-provisioning.test.ts`: timeline-ordering assertion (provision BEFORE
  getPool) is exactly the right shape for catching the actual bug it closes. Good
  example of behavior over "was X called."
- `events.test.ts`: explicit `tenantId MUST NOT be on the wire` assertion (line 187)
  catches tenant-id leak — the right tenant-isolation discipline.

## Recommended fixes (ranked by leverage)

1. **Add `principal-strict-mode.test.ts`** — covers the
   `testAuth.enabled=false` + `X-Debug-Principal` rejection. Single most
   important missing test in the batch.
2. **Un-skip `principal.test.ts`** OR rename/refile so the principal
   middleware's auth contract has a clearly-named test home with active
   tests. The current state is misleading.
3. **Replace `state.test.ts`** structural-name probe with a runtime
   composition probe that asserts on the actual `composeDispatchers`
   output ordering. Otherwise it's a comment-mirroring test.
4. **Add cross-tenant test to `intents.test.ts`** — principal in tenant A,
   envelope `tenantId: 'B'`, expect 403 + envelope code + no events appended.
5. **Delete or replace** the type-probe-via-cast assertion at
   `f2-event-envelope-chain-version.test.ts:62–63` — it is a tautology.
6. **Tighten error-envelope assertions** across `docs.test.ts` admin-gate
   tests and the validation tests in `identity-a7.test.ts` that check only
   status code.
