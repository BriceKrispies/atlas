# Atlas Testing Contract

Every behavior change in Atlas — new capability, refactor, bug fix, port
addition, adapter swap — MUST land **failing tests first, implementation
second**. This contract is the durable definition of "test-first" in Atlas:
which tests exist, where they live, what they assert, how they trace back to
specs, and which gates fire when they're missing.

The contract is normative (RFC 2119). It is audited by the
[`sdet`](../../.claude/agents/sdet.md) agent at Phase 1.0 of every slice (see
§4) and by the [`architect`](../../.claude/agents/architect.md) at the
invariant gate. It is referenced by [`CLAUDE.md` "Slice
Workflow"](../../CLAUDE.md#slice-workflow) (which it amends),
[`tickets/CLAUDE.md`](../../tickets/CLAUDE.md) (which uses its acceptance
shape), and the per-test-kind anchors below.

This contract is not a style guide. It does not tell you how to write a good
unit test. It tells you which tests MUST exist before code lands, where they
live, what they're allowed to assume, and what fails the PR if missing.

---

## §1 Why test-first

Atlas's hard discipline is **spec-first** — no code without a capability
README at the canonical path. Test-first is the natural extension: the spec
declares the behavior; the tests encode it as executable assertions; the code
is whatever satisfies the tests. Three properties fall out:

1. **The work is bounded.** "Done" is "all named tests green." There is no
   implementation drift past the spec, because anything beyond the tests is
   unmotivated code.
2. **The work is agent-friendly.** An agent (or a developer) can pick up a
   slice cold by reading the failing test list and the spec; the test list IS
   the work order. This is the agentic-first tenet
   ([`vision.md`](../vision.md)) applied to the development loop.
3. **The branches are covered by construction.** A test that lists every
   branch the spec describes — happy path, deny, idempotency replay, quota
   exhausted, tenant-scoping, projection rebuild — has nowhere to hide.
   Coverage is not a CI report; coverage is the work plan.

The cost is real: writing tests for behavior that doesn't yet compile is
slower than writing the code and tests together. The bet is that the cost is
front-loaded and the downstream wins (no untested branches, no spec-vs-code
drift, mechanical "done") pay for it within the same slice.

---

## §2 Three layers of test-first

Atlas's test-first contract is a **layered defense**. Each layer catches a
different class of bug; together they form the floor every slice MUST clear.

### §2.1 Mechanical floor — spec→scaffold→implement

Every capability README declares its invariants, surfaces, actions, queries,
and emitted events ([`_capability-template.md`](../_capability-template.md)).
A **scaffold step** translates that declaration into a set of canonical
failing test stubs:

- Handler test per declared action.
- Dispatcher test per module touched (I12 rebuildability).
- Projection test per declared projection.
- Query test per declared query.
- Route test per HTTP entry point (the catch-all hit, not a hand-mount).
- Surface state-machine test per declared surface.
- BDD scenario per user-visible flow.

Scaffolds are emitted at canonical paths (§3) with `expect(...).toBe(...)`
bodies that fail until the matching code lands. **Code that makes the
scaffold pass is the implementation.**

The scaffold generator (`atlasctl test scaffold <capability-path>`) is
specified by this section and implemented in a separate slice. Until the
generator ships, scaffolds are hand-written by `module-dev` / `frontend-dev`
/ `port-adapter-dev` at Phase 1.0; the contract is the same either way.

### §2.2 Invariant layer — property-based testing

Atlas's invariants (I1–I18, plus per-capability invariants) are
**universally quantified** — "for every event sequence, projections
rebuild," "for every cache write, the key contains `tenantId`," "for every
idempotency-key replay, no side effect re-fires." These are property
shapes, not example shapes. They MUST be encoded as
[fast-check](https://fast-check.dev/) properties in
[`packages/contract-tests/src/properties/`](../../packages/contract-tests/src/properties/)
and run against every adapter and every module that the invariant touches.

Example-based unit tests are the floor; property-based tests are the
ceiling. The generator finds branches the spec author didn't think of. Both
layers MUST exist — example tests for the named scenarios (faster to
diagnose), property tests for the universal claim (broader coverage).

The set of invariants with mandatory property coverage:

| Invariant | Property shape |
|---|---|
| **I3** Idempotency before execution | For every `(intent, replayCount)`, the handler runs ≤ 1 time and emits ≤ 1 event |
| **I5** Correlation propagation | For every request, `correlationId` appears unchanged in every downstream log, event, and audit record |
| **I6** Causation linkage | For every emitted event in a request, `causationId` ∈ the request's event-id set |
| **I9** Cache keys include `tenantId` | For every cache write, the literal `tenantId` appears in the key string |
| **I10** Event-driven cache invalidation | For every emitted event with tag `Tenant:${T}`, the cache has a matching `invalidateByTags` call |
| **I12** Projections rebuildable | For every event sequence, replay-from-empty produces the same projection state |
| **I13** Quota before dispatch | For every over-budget intent, zero events emitted, zero handlers run |
| **I16** Schema-mutation scope | For every tenant DDL, the affected tables are exactly within the issuing tenant's database |

Per-capability invariants (e.g., "every catalog publish increments the
revision counter") are property-tested in
`modules/<module>/src/<concept>.properties.test.ts` at the module's own
discretion — required when the invariant can be stated universally.

### §2.3 Surface layer — BDD-first

Every capability with a user-visible surface has its Gherkin scenarios under
[`tests/bdd/features/<domain>/`](../../tests/bdd/features/) **written and
failing before any handler / projection / route lands.** The scenarios drive
the backend's observable shape — what surface states exist, what transitions
they make, what actions are reachable. The backend is built to make the
scenarios pass, not the other way around.

Scenarios MUST assert against the
[surface-introspection](../frontend/surface-introspection.md) contract:
`getSurfaceSnapshot()` returns `{ state, schemaRef?, data, actions[] }`; the
scenario reads `state` and `actions[]` directly. **DOM scraping is
forbidden** — a scenario that queries `.css-class-name` instead of the
declared state is a contract violation, not a clever shortcut.

---

## §3 Where tests live

Canonical paths. The scaffold generator emits to these paths; manual
scaffolds MUST use them.

| Kind | Path | One test file per |
|---|---|---|
| Unit (logic, pure functions, validation) | `<src-file>.test.ts` co-located | source file |
| Handler | `modules/<module>/src/handlers/<action>.test.ts` | action |
| Projection | `modules/<module>/src/projections/<projection>.test.ts` | projection |
| Query | `modules/<module>/src/queries/<query>.test.ts` | query |
| Dispatcher (I12 rebuild) | `modules/<module>/src/dispatch.test.ts` | module |
| Per-module property | `modules/<module>/src/<concept>.properties.test.ts` | per-capability invariant |
| Port contract suite | `packages/contract-tests/src/<port>.ts` | port |
| Cross-cutting invariant property | `packages/contract-tests/src/properties/<invariant>.ts` | invariant |
| Adapter parity | `adapters/<adapter>/src/<adapter>.contract.test.ts` (imports the port suite) | adapter |
| Route (catch-all dispatch) | `apps/server/src/routes/<area>/<action>.test.ts` | route |
| Surface unit (state-machine, signals) | `packages/widgets/src/<surface>.test.ts` | surface |
| BDD scenario | `tests/bdd/features/<domain>/<capability>.feature` | capability |
| BDD step definitions | `tests/bdd/steps/<domain>/<capability>.ts` | capability |
| Fixture | `specs/fixtures/<kind>__<expect>__<name>.json` | one example |

A test that does not fit any of the above (e.g., an integration test that
spans modules) lives at the lowest layer in which it makes sense — usually
the route test or a BDD scenario.

**Fixtures-first rule.** Test data lives in `specs/fixtures/` whenever the
shape is reusable (event envelopes, module manifests, search documents,
analytics events, intent envelopes, surface snapshots). Test bodies focus on
**assertions, not setup**. A test that constructs a 40-line event envelope
inline is a fixture waiting to be extracted; SDET flags this.

---

## §4 Workflow — Phase 1.0 precedes Phase 1.1

The [slice workflow](../../CLAUDE.md#slice-workflow) is amended: Phase 1
splits into **1.0 (failing scaffolds)** and **1.1 (implementation)**.

```
Phase 0 — Scope (unchanged)
  spec-keeper + platform-owner
  capability README at specs/domains/<domain>/capabilities/<name>/README.md
  ▸ User checkpoint: spec approved

Phase 1.0 — Failing scaffolds [NEW]
  module-dev        → handler / projection / query / dispatch test scaffolds
  port-adapter-dev  → port contract test additions + adapter parity scaffolds
  frontend-dev      → surface state-machine + BDD scaffolds
  Gate: `pnpm test` runs and the named tests fail with the expected
        not-implemented assertions. `pnpm typecheck` is green
        (scaffolds compile against the spec's declared shapes).

Phase 1.0 SDET — scaffold-coverage review [NEW]
  sdet → verifies scaffolds cover every spec assertion, every invariant
         the spec claims to touch, every surface state, every branch the
         spec names. Files any missing scaffold as feedback, not
         implementation.
  Gate: SDET signs off that "all tests fail, and the set of failing
        tests fully describes the spec."

Phase 1.1 — Implementation
  module-dev / port-adapter-dev / frontend-dev → write code until
         `pnpm test` is green; touch no test (except to remove a
         scaffold's `it.todo` or fix a typo).
  Gate: `pnpm test` green; `pnpm bdd` green for surfaces; coverage
        thresholds met (§5); no test modified beyond enabling it.

Phase 2 — Architect invariant gate
  architect → I1–I18 review, hexagonal layering, port surface, mirror
              parity. Single pass.
  No override: invariant violation = back to Phase 1.1 or escalate to user.

Phase 3 — Optional security review
  /security-review when the change touches authn/authz/tenant scope/secrets/PII.

Phase 4 — User checkpoint → merge
```

**SDET moves from Phase 2 to Phase 1.0.** The adversarial pass is most
valuable *before* code, not after. After-the-fact "you forgot a test"
becomes "you forgot a test, now we have to write code for it" — strictly
worse than catching the missing scaffold before any implementation. SDET at
Phase 1.0 reviews scaffold *coverage* against the spec; the role at the end
of Phase 1.1 collapses into the architect gate.

A slice that reaches Phase 1.1 without a green Phase 1.0 SDET sign-off is
out of contract.

---

## §5 Mechanical requirements

### §5.1 Spec-test linkage (bidirectional)

Every test MUST carry a `@spec` annotation in its top-level `describe` (or
file-level comment) naming the spec section it covers:

```ts
describe('Catalog.Family.Get', () => {
  // @spec: specs/domains/catalog/capabilities/family-get/README.md#§3-invariants
  it('returns 404 when familyKey unknown', () => { /* ... */ });
});
```

Every spec assertion that imposes behavior (uses MUST / MUST NOT / SHALL)
MUST be reachable from at least one test's `@spec` annotation. A linter
script (`pnpm lint:spec-links`) walks `specs/**/*.md` for normative
assertions and `**/*.test.ts` for `@spec` annotations, fails the build if
either side is unreferenced.

This makes "the spec has changed; which tests does it touch?" a `grep`
question and "this test is testing what?" a `grep` question.

### §5.2 Coverage thresholds

Branch coverage is enforced per-package in CI via `pnpm coverage`. Initial
thresholds:

| Package class | Branch coverage floor |
|---|---|
| `packages/ingress`, `packages/platform-core`, `ports/`, `packages/contract-tests` | 95% |
| `modules/<x>` | 90% |
| `adapters/<x>` | 90% (parity suite from `packages/contract-tests` counts) |
| `apps/server` (route + middleware) | 85% |
| `apps/projection-worker` | 90% |
| `packages/widgets`, `packages/design`, `packages/core` | 85% |
| `apps/admin`, `apps/authoring`, `apps/sandbox` | exempt (BDD covers surfaces) |
| `tools/`, dev scripts | exempt |

Coverage is a **floor, not a ceiling.** A package below floor fails CI.
Thresholds rise as the retrofit chore-set lands (§7).

### §5.3 Property runtime budget

Every property test runs **≥ 200 generated cases by default** in CI; nightly
runs raise this to **≥ 5000**. Shrinking is enabled. A property that runs
fewer cases is flagged by SDET.

### §5.4 Adapter parity (port contract tests)

Every port has a contract suite in `packages/contract-tests/src/<port>.ts`
exporting a `runContract(makeAdapter)` function. Every adapter imports the
suite and calls it. New adapters land alongside the suite call; suite
extensions land alongside the property they're proving.

A port without a contract suite, or an adapter that doesn't import the
suite, is rejected at the architect gate.

### §5.5 Test isolation

- **Unit and handler tests** MUST NOT touch the network, the disk
  (beyond temp dirs), or the system clock without an injected fake.
- **Dispatcher / projection tests** MUST use the same `EventStore` adapter
  (real Postgres in `*-itest`, IDB in browser tests) — mocking the event
  store hides I12 violations.
- **Property tests** MUST be deterministic given a seed; flake = a real
  bug in the property or the code, never "the generator was unlucky."
- **BDD scenarios** MUST run against a real `apps/server` instance with a
  real database (see [`tests/bdd/README.md`](../../tests/bdd/README.md)).

### §5.6 No skipped tests without a ticket

`it.skip` / `describe.skip` / `xit` / `xdescribe` MUST carry an inline
ticket reference: `// @skip-until tickets/<set>/<slug>`. The lint pass
fails on a bare skip. `it.todo` is allowed at Phase 1.0 scaffolds and MUST
be removed before Phase 1.1 finishes — a `todo` reaching the architect
gate is a contract violation.

---

## §6 Per-test-kind contracts

### §6.1 Handler test

- One `describe` per action; one `it` per branch the spec names.
- MUST assert (a) the happy-path event(s) emitted with the right shape and
  `cacheInvalidationTags`; (b) the deny path emits nothing on policy
  failure; (c) the idempotency replay path emits nothing the second time;
  (d) the over-quota path emits nothing.
- MUST NOT mock `EventStore` — use the real adapter (`*-itest`).

### §6.2 Dispatcher test (I12)

- File: `modules/<module>/src/dispatch.test.ts`.
- MUST construct synthetic events covering every event type the module
  consumes, replay them through the composed dispatcher chain against an
  empty projection store, and assert the resulting projection state equals
  the expected fixture.
- MUST replay the same events a second time and assert no duplicate
  projection writes (idempotent dispatch).

### §6.3 Property test

- File: `packages/contract-tests/src/properties/<invariant>.ts` for
  cross-cutting; `modules/<x>/src/<concept>.properties.test.ts` for
  per-module.
- MUST declare the generator(s), the property, the seed strategy, and the
  number of runs.
- MUST shrink to a minimal counterexample on failure; the counterexample
  becomes a fixture (`specs/fixtures/<kind>__invalid__<name>.json`) and a
  regression unit test.

### §6.4 Port contract test

- One file per port at `packages/contract-tests/src/<port>.ts`.
- Exports `runContract(makeAdapter: () => Promise<Port>)`; assertions cover
  the port's full interface plus the invariants the port enforces (e.g.,
  `EventStore`: monotonic seq per tenant; `Cache`: tag invalidation).
- Adapters import and call the suite; failing adapters are rejected.

### §6.5 Route test

- File: `apps/server/src/routes/<area>/<action>.test.ts`.
- Tests the catch-all dispatch path for the action — not a hand-mounted
  route ([action-driven-routing.md](action-driven-routing.md)).
- MUST assert (a) authn missing → 401; (b) authz deny → 403, no event
  emitted; (c) idempotency replay → 200 + prior result; (d) happy path →
  200 + event in store.
- A route test for a hand-mount is a §11 retrospective trigger
  ([always-on.md §11](always-on.md#§11-kernel-touch-retrospective)).

### §6.6 Surface test

- File: `packages/widgets/src/<surface>.test.ts`.
- MUST instantiate the `AtlasSurface` (or `AtlasElement`), drive it through
  every declared state, and assert `getSurfaceSnapshot()` returns the
  expected `{ state, data, actions[] }` at each.
- MUST NOT assert against DOM structure beyond the surface's declared
  contract; CSS classes and tag names are implementation, not contract.

### §6.7 BDD scenario

- Gherkin file at `tests/bdd/features/<domain>/<capability>.feature`.
- Step definitions at `tests/bdd/steps/<domain>/<capability>.ts`.
- MUST assert against surface state via `getSurfaceSnapshot()`; DOM scraping
  forbidden.
- MUST cover (a) the happy path, (b) the deny path, (c) at least one
  error-state path the spec names.

---

## §7 Forbidden patterns

- **Implementation before failing test.** Code lands in Phase 1.1, not
  Phase 1.0. A commit that touches `src/` without a corresponding
  `*.test.ts` change (in the same commit or a prior Phase 1.0 commit) is
  flagged by the pre-commit hook.
- **Tests without `@spec` annotations.** Untraceable tests rot.
- **Mocked `EventStore` in dispatcher / projection tests.** Hides I12
  violations. Real adapter or no test.
- **Snapshot tests that capture implementation details.** Snapshot the
  *spec-shaped output* (`SurfaceSnapshot`, `EventEnvelope`,
  `IntentResponse`), never the DOM, never internal logger output, never
  the SQL query string.
- **Skipped tests without a ticket reference.** `// @skip-until <ticket>`
  is the only allowed comment.
- **Flaky tests treated as the cost of doing business.** A flake is a
  defect. The flake-quarantine slot (`tests/_quarantine/`, created on
  first use) holds at most three tests, each with a ticket; the fourth
  flake fails the build globally.
- **"Implementation tests."** Tests that mirror the code's internal
  structure (one test per private helper, asserting how the function calls
  another function) rot the moment the code refactors. Tests assert
  observable behavior named in the spec.
- **Test bodies constructing 20+ lines of fixture data inline.** Extract
  to `specs/fixtures/` and reference.
- **Coverage gaming.** A test that calls a function without asserting on
  its result is not a test; it's coverage padding. SDET rejects.

---

## §8 The scaffold generator (forward reference)

`atlasctl test scaffold <capability-path>` reads a capability README,
parses its declared actions / queries / projections / events / surfaces /
invariants, and emits failing test stubs at the canonical paths from §3.
Idempotent: re-running over existing scaffolds is a no-op when the spec
hasn't changed, an additive emit when the spec gained an assertion, a
diff-and-flag when the spec contradicts an existing test.

The generator's behavior is specified by this file; the implementation
lives in a separate ticket (tooling slice). Until the generator ships,
Phase 1.0 scaffolds are hand-written by the implementer and reviewed by
SDET for completeness — the contract above applies either way.

---

## §9 Conformance

- **Architect gate:** verifies (a) every package meets its branch-coverage
  floor; (b) every port has a contract suite and every adapter imports it;
  (c) every BDD scenario asserts via `getSurfaceSnapshot()`, not DOM; (d)
  no hand-mount routes after [action-driven-routing](action-driven-routing.md)
  Phase 1.
- **SDET adversarial pass at Phase 1.0:** verifies (a) every normative
  spec clause has a failing test scaffold; (b) every invariant the spec
  claims to touch has a property test (cross-cutting or per-module); (c)
  every surface has a BDD scenario; (d) every emitted event is asserted in
  a handler test with its `cacheInvalidationTags`.
- **Lint pass (`pnpm lint:spec-links`):** verifies bidirectional spec↔test
  linkage; fails the build on missing `@spec` annotations or unreferenced
  normative assertions.
- **Pre-commit hook:** rejects `it.skip` / `xit` / `it.todo` without
  ticket references; rejects `*.test.ts`-free changes to `src/` in the
  same commit as new behavior.
- **CI:** runs `pnpm typecheck`, `pnpm test`, `pnpm coverage` (with
  thresholds), `pnpm bdd`, `pnpm lint:spec-links`, plus the nightly
  high-budget property runs.

Drift findings here become `type: drift-finding` tickets per
[`tickets/CLAUDE.md`](../../tickets/CLAUDE.md).

---

## §10 Relationship to other crosscut specs

- [`logging.md`](logging.md) — every test that emits a log assertion (e.g.,
  asserting `event` field, correlation propagation) reads against the
  logging contract; the logging contract owns the field shape, this
  contract owns the test shape.
- [`errors.md`](errors.md) — handler/route tests assert against the error
  taxonomy from `errors.md`; an untyped error in a test is a contract
  violation.
- [`events.md`](events.md) — handler tests assert events match the event
  vocabulary in `events.md`; an event name not in the vocabulary is a
  contract violation.
- [`action-driven-routing.md`](action-driven-routing.md) — route tests
  test the catch-all dispatch path; hand-mount route tests are §11
  retrospective triggers.
- [`streaming-io.md`](streaming-io.md) — streaming endpoints have their
  own test shape (backpressure assertion, quota close, `Last-Event-ID`
  resumption); §8 of `streaming-io.md` names the gates.
- [`always-on.md`](always-on.md) — the hot-reload contract is tested via
  scenarios under `tests/bdd/features/always-on/`; the kernel-touch
  retrospective fires when a slice changes a restart-required surface
  without the corresponding test scaffolds.
- [`runtime-instruction-set.md`](runtime-instruction-set.md) — every
  instruction has its own test shape (the canonical anchors above);
  adding an eleventh instruction means adding an eleventh row to §3.

---

## §11 Migration posture

Atlas's existing modules predate this contract. They are not all at the
floor today; the retrofit is a chore-set per module
(`tickets/retrofit-testing-floor/<module>.md`) that brings each up to the
bar incrementally. Until a module is retrofit:

- New code in the module MUST follow this contract from this point
  forward (no grandfathering by file).
- Coverage thresholds (§5.2) start at the package's current measured
  floor minus 2% (preventing regression) and step up as the retrofit
  ticket lands.
- Property-test coverage of invariants (§2.2) is mandatory for new code
  only; retrofit adds coverage for existing code per-module.
- BDD coverage gaps in retired domains (the legacy CMS-shape parked under
  `apps/cms/` once moved) are out of scope; the parked code is exempt.

The retrofit chore-set is sequenced spine-first (identity, authorization,
tenancy) → extensibility (custom-schema, functions) → first-party
(catalog, content-pages) → adapters → frontend. Each retrofit lands as
its own slice with this contract as the bar; once a module retrofits, its
threshold rises to the §5.2 floor.
