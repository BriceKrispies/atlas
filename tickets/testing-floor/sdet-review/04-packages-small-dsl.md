# SDET Review — Packages (small + DSL slice)

Scope: 24 `*.test.ts` files under `packages/{api-client,arch-tests,chaos,core,design,dsl-expression,dsl-substrate,ingress,openapi,seeder,test,test-fixtures,test-state}`.

## Summary

Overall the suites in this slice are **strong**. `packages/core` (signals, html, telemetry, component) does verify subscriber invocation on change and exercises the documented reactive contract — none of the `signal-no-firing` cases apply. `packages/ingress/submit-intent` covers the full pipeline including deny / permit / idempotency-replay paths against a real (in-memory) `PolicyEngine`; the `pipeline-bypassed` rubric is **not** triggered (the deny path is genuinely tested via `StubDenyEngine` *and* asserts both `appended.length===0` and `dispatch` not called — i.e. it is what the I2 invariant test should look like). `packages/arch-tests` exercises real repo paths via `findImportViolations`. `packages/dsl-expression/parser.test.ts` has solid precedence / grouping / pipe-binding / error-range coverage. `packages/seeder/runner.test.ts` is exemplary (PINNED bytes, sentinel collision check, fail-fast, mutation-isolation).

The notable findings sit in three pockets: (1) the `dsl-expression/evaluator.test.ts` value assertions are routinely **tautological** (collapse to `ok===true` without checking the computed value); (2) `dsl-substrate/contract-tests.test.ts` only asserts the stub emits *some* violation per method — a meta-shape test that will pass against any non-empty array (acceptable today because the file is explicit it's a stub-shape proof, but worth a follow-up); (3) `packages/test/test/smoke.test.ts` is intentionally trivial (a smoke test for the test harness itself — not real coverage).

No `skipped`/`todo`, no `try-swallow`, no `mock-the-sut`. Good baseline.

## Findings by file

### `packages/test/test/smoke.test.ts`
- **L4-7 / `expect runs basic matchers`** — severity **STYLE** (`tautology`/`coverage-shape`). `expect(1+1).toBe(2)` exists solely to smoke-test the harness re-export from `@atlas/test`. Acknowledged purpose by file name (`smoke`); leave as-is, but it is not actual coverage and should be excluded from any coverage-threshold accounting.

### `packages/api-client/test/backend-contract.test.ts`
clean. Contract suite is run against both the in-memory and the HTTP implementations; subscribe/unsubscribe lifecycle, tag-overlap matching, ES pooling, and connection close are all asserted.

### `packages/arch-tests/test/adr-0008-leaks.test.ts`
clean. Each `it` calls `findImportViolations(modulePath, regex)` against real repo paths and asserts `[]`. Real-repo-state assertion as the rubric demands.

### `packages/arch-tests/test/port-purity.test.ts`
clean. Same shape — real `ports/src` directory, real regex match against `node:crypto` / `node:fs` / postgres drivers.

### `packages/core/test/component.test.ts`
clean. AtlasElement.define idempotency, boolAttr/strAttr round-trips, shadow-host surfaceId walk, `data-testid` composition, full `AtlasSurface` state-machine transitions emitting `Surface.State.<from>.<to>`, `_safeRender` failure mode (emits `Atlas.Render.Failed`), and `emit()` surface stamping all asserted with telemetry recorder. The state-machine test even asserts the no-op behavior on identical setState — that's the kind of edge most authors skip.

### `packages/core/test/html.test.ts`
clean. XSS-escape on text + attribute interpolation; event binding fires; `.prop` property binding lands; node/fragment/array/conditional interpolation all asserted.

### `packages/core/test/signals.test.ts`
clean. The `signal-no-firing` rubric is explicitly defeated: every signal test that creates a signal also creates an effect/subscriber and verifies invocation count, including identity-equal (Object.is), NaN-skip, computed memoization (`spy.toHaveBeenCalledTimes(1)`), chained computeds, effect cleanup-before-rerun, batch coalescing, and batch-throw still flushes. Exemplary file.

### `packages/core/test/telemetry-pipeline.test.ts`
clean. Default NullSink, timestamp stamping, custom timestamp preservation, sink-throw swallow, ConsoleJsonSink legacy prefix, BeaconHttpSink batching + interval flushing + fetch-rejection swallow + empty flush no-op. Uses fake timers correctly.

### `packages/openapi/test/build.test.ts`
clean. Asserts canonical OpenAPI 3.1 shape, audience-driven title/security-scheme branching, intent-endpoint expansion, error-response components, JSON serializability + round-trip, and route-annotation audience filtering.

### `packages/openapi/test/intent-expander.test.ts`
clean. Operation-id derivation table (`it.each`) covers six representative inputs; audience filtering; per-module tag emission; per-action envelope wrapping with `eventType` `const` assertion; generic fallback when no payload schema is bundled.

### `packages/openapi/test/security-schemes.test.ts`
clean. Tenant vs operator scheme membership, debugPrincipal documents `X-Debug-Principal` header with a `dev` description gate.

### `packages/seeder/test/runner.test.ts`
clean. Exemplary. The PINNED-bytes case (L275-287) and SENTINEL-COLLISION case (L288-302) are the kind of assertions that catch silent hash-drift regressions. Also: 0-step scenario doesn't crash, error-propagation from driver and corpus is *not* swallowed, mutation-isolation asserted on the caller-supplied envelope.

### `packages/chaos/test/with-chaos.test.ts`
clean. Each path asserted with side-effect observation: error-injection rate, drop-suppresses-appends, latency floor via real `Date.now()` (acceptable for a chaos suite where determinism is via seed not timers), per-method override beats default, seed determinism across two runs.

### `packages/design/test/multi-select-core.test.ts`
clean. Pure-core state-machine coverage: construction, normalization (drops nulls + dedupes), filter & active-index, mutations + delta shapes, max & disabled gates, port-driven lifecycle including the **late-resolve-from-superseded-load** race (L312-325) and **null-source-while-loading synthesizes terminal state** (L345-359). These are the kind of adversarial concurrency cases the rubric exists to applaud.

### `packages/design/test/atlas-multi-select-adapter.test.ts`
clean. Drives the real custom element against linkedom; explicitly tests the **mouseover-before-click identity preservation** regression (L197-218) — the exact pathological adapter bug the comment block calls out at the top of file. Search-input identity across typing, chip-remove unselect, listbox lifecycle (loading/error/retry), allow-create hint+click all asserted.

### `packages/ingress/test/submit-intent.test.ts`
clean. The `pipeline-bypassed` rubric is **not** triggered — the deny path uses a real `StubDenyEngine` (not a mock) and asserts `store.appended.length===0` and `dispatch not called`, which is the proper I2 assertion shape. Also covers UNKNOWN_SCHEMA, SCHEMA_VALIDATION_FAILED with structured detail, INVALID_IDEMPOTENCY_KEY (empty key), idempotency replay path (returns prior eventId with no new event appended and no dispatch), UNKNOWN_ACTION, audit-hook called once with correlationId+idempotencyKey, audit-hook errors swallowed-and-logged at error, and the I10 cache-tag survival from handler-stamped tags through dispatch. The generic-fallthrough `cacheInvalidationTags: null` is documented as the contract for handler-less paths — that's an explicit codification rather than a coverage gap.

  - **L392-411 / `metrics counter throws are logged at debug and do not fail the request`** — severity **MODERATE** (`coverage-shape`). The body acknowledges via comment that it does not exercise the actual metrics-counter-throws path; it only asserts the *negative* (no metric-throw debug log in the happy path). The test name promises behavior the body doesn't deliver. Either rename to "happy path emits no metric-throw debug log" or wire a metrics shim and exercise the real catch branch.

### `packages/test-fixtures/test/settle-events.test.ts`
- **L99-118 / `returns afterSeq + 0 processed when stream is empty past cursor`** — severity **MODERATE** (`weak-assertion`). The final assertion is `expect(result.lastSeq === 5n || result.lastSeq === 2n).toBe(true)` — an OR over two possible values. The contract should be one specific value (likely `5n` per the documented "highest observed seq"). Pin the actual contract and assert exactly that; the disjunction lets the impl drift between the two answers silently.

  Otherwise clean — sorting, default-afterSeq, eventId-in-error-message, `cause` preservation, short-circuit on failure are all asserted.

### `packages/test-state/test/index.test.ts`
clean. DEV vs prod gating (via `__ATLAS_TEST_STATE_DEV__` global), register-replaces (last-write-wins), old-disposer doesn't clear new value, typed accessors (`chart:`/`editor:`/`layout`/`drag:`), reader-throws surfaces `{ error: ... }`, prod no-op contract. The `makeCommit` `at >= Date.now()` floor is asserted, which is the right shape.

### `packages/dsl-substrate/src/evaluator.test.ts`
clean. Result discriminant compiles and runtime-narrows in both branches; `dslUpdateAction` / `dslTableName` / `DSL_KIND_PATTERN` are table-tested with positive **and** negative cases (rejects `Expression`, `1query`, `formula-field`, `x`). The kind-pattern minimum-length of 2 is explicitly asserted, which would otherwise be a silent off-by-one.

### `packages/dsl-substrate/src/contract-tests.test.ts`
- **L106-123 / `the synchronous checks emit a stub violation` + `the async checks resolve to a stub violation`** — severity **MODERATE** (`shape-only` / `passes-with-empty-impl`). The assertions only check `.length > 0`, i.e. that the stub returns "some" violation. A correct future impl that returns zero violations would FAIL this test, and any stub that returns `[{any-string}]` passes. This is meta-shape coverage — acceptable because the file's docblock explicitly says "the real assertion bodies land with the first concrete DSL (slice #3)". Track: when the substrate gets a real implementation, replace these `.length > 0` checks with content-shape assertions tied to ADR 0007 §2 violation codes. File a follow-up ticket so this doesn't ossify.

### `packages/dsl-substrate/src/artifact.test.ts`
clean. Liskov-base envelope substitutes both kinds at `DslArtifact<string, unknown>`; `isKind` narrows to the requested kind both positively and negatively; all envelope fields preserved across kinds.

### `packages/dsl-expression/src/parser.test.ts`
clean. Literals (int / float / single+double-quoted strings / escape sequences / bool / null), identifiers (single, dot-path, deeply nested), operator precedence (`2 + 3 * 4`), explicit paren-overrides, comparison/equality/logical (`&&` binds tighter than `||`), unary minus + bang, calls (0/1/N args), pipe chains + pipe-with-args + pipe-vs-binop binding, sourceMap one-per-AST-node assertion, four distinct error reports each with code + (where applicable) sourceRange. Rubric `edge-case-missing` is **not** triggered — this file is exactly the precedence/grouping/error coverage the rubric demands.

### `packages/dsl-expression/src/conformance.test.ts`
clean. Drives the substrate's `makeConformanceChecker` against the real expression DSL across all six ADR 0007 §2 properties (bounded / pure / no-ambient-IO / deterministic / budget-enforced / statically-typeable). Includes positive and negative samples (unknown identifier, unknown filter). Adds a registry-vs-known-ops parity assertion at the bottom that would catch any drift between the source-of-truth and the registered set.

### `packages/dsl-expression/src/evaluator.test.ts`
- **L25-35 / `evaluates booleans`** — severity **CRITICAL** (`tautology`). The body reads:
  ```
  expect((await evalSource('true')).ok && true).toBe(true);
  expect((await evalSource('false')).ok && true).toBe(true);
  ```
  `<bool> && true` evaluates to the left operand. So this only asserts `r.ok === true` and never that `'false'` actually evaluates to `false`. An evaluator returning `true` for the literal `false` passes this test.
- **L85-94 / `compares numbers`** — severity **CRITICAL** (`tautology`). Same shape: `expect((await evalSource('5 > 10')).ok && true).toBe(true)` only asserts `ok`. `5 > 10` could evaluate to `true` and the test still passes.
- **L96-108 / `short-circuits via &&` / `||`** — severity **CRITICAL** (`tautology`). Same pattern; never checks that `true && false` returns `false`, nor that `false || true` returns `true`. Also: the test name promises **short-circuit** semantics (i.e. RHS not evaluated when LHS settles the answer), but the body only checks `ok`. A non-short-circuiting evaluator that crashes on the RHS would still be tested only by `ok`. Real short-circuit coverage would put an effectful (or throwing) op in the RHS and assert it didn't run.
- **L105-107 / `rejects non-bool operands`** — severity **MODERATE** (`weak-assertion`). The `if (!r.ok)` block runs the inner assert only when not-ok; if `r.ok===true` the test silently passes with no assertion at all. Add a top-level `expect(r.ok).toBe(false)` before the narrowing branch (the type-error test in the arithmetic block at L66-71 already does this — apply uniformly).
- **L23-35 / general pattern across the file** — severity **MODERATE** (`weak-assertion`). The `expect(r.ok && r.value).toBe(<expected>)` idiom IS sound when `<expected>` is the actual value (e.g. `42`, `'ab'`, `'ABC'`) — JS coerces and the comparison checks the value. But on every boolean / comparison / logical case the second operand is `true`, which makes the assertion identity-on-ok. Recommended fix: introduce a `unwrap<T>(r: Result<T>): T` helper that throws on `!r.ok` and returns `r.value`, and use `expect(unwrap(r)).toBe(false)` so the type-checker forces an explicit value. This single change converts ~10 tautological tests into real assertions.

  Otherwise the file covers strong cases: division-by-zero `DSL_TYPE_ERROR`, mixed-type comparison `DSL_TYPE_ERROR`, frozen-now host-context determinism, budget enforcement with a 1-step budget producing `DSL_BUDGET_EXCEEDED`. Those are real.

## Recommended fixes (ranked by leverage)

1. **`packages/dsl-expression/src/evaluator.test.ts`** — eliminate the `r.ok && true` idiom across the file. The booleans / comparisons / logical-ops cases are currently tautologies. Introduce a `unwrap()` helper and rewrite. Tracking ticket recommended; the cleanup is ~20 lines and converts the file from "yellow" to "green".
2. **`packages/ingress/test/submit-intent.test.ts`** L392-411 — either implement the real metrics-throws path or rename the case to match what it actually asserts.
3. **`packages/test-fixtures/test/settle-events.test.ts`** L117 — pin the `lastSeq` contract; replace `=== 5n || === 2n` with the single intended value.
4. **`packages/dsl-substrate/src/contract-tests.test.ts`** — file a follow-up ticket to replace `.length > 0` shape assertions with content-shape (violation-code) assertions once the real substrate implementation lands in slice #3. The current shape is honest-stub coverage but will silently approve a regression in the real impl.
5. **`packages/test/test/smoke.test.ts`** — keep, but exclude from any coverage-threshold accounting; the file is harness-smoke not SUT coverage.

## Skipped / todo

None found. No `it.todo`, no `it.skip`, no `describe.skip`, no `xit`. Strong on this dimension across all 24 files.
