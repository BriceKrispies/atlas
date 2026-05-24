---
ticket: tickets/testing-floor/colocated-test-inventory
type: inventory
status: scoped
capability: n/a (cross-cut)
adr: n/a (precedes ADR)
date: 2026-05-22
---

# Colocated unit-test inventory — full sweep

Mechanical sweep across `adapters/`, `ports/`, `modules/`, `packages/`, `apps/`. Goal: enumerate every `.ts` source file that does NOT have a colocated `<file>.test.ts` sibling, then classify each as **needs-test** vs **no-test-warranted** (barrels, type-only files, scaffolding, port interfaces).

> **Mechanical version (deterministic, regenerable):** [`colocated-test-inventory.generated.md`](./colocated-test-inventory.generated.md) — produced by `pnpm test-coverage:inventory`. Baseline at `colocated-test-inventory.baseline.json`. CI gate: `pnpm test-coverage:inventory:check` (fails if `gap` grows or `hasTest` shrinks).
>
> The deterministic script uses a **strict** colocated definition: `<base>.test.ts` sibling next to `<base>.ts`. The narrative below was produced by `Explore` subagents using a looser definition (any `*.test.ts` in same dir, regardless of basename) and double-counted tests living under `<pkg>/test/`. The script's 27/279/460 numbers are the source of truth going forward; this narrative remains as commentary + decisions.
>
> Source agent transcripts: 6 parallel `Explore` runs on 2026-05-22 (one per area). Re-run with the same prompts to refresh narrative; re-run `pnpm test-coverage:inventory` to refresh numbers.

## Headline numbers

| Area | Total `.ts` | Colocated test | Missing | Likely-legit (no test needed) | Real gaps |
|------|-------------|----------------|---------|-------------------------------|-----------|
| ports/ | 28 | 0 | 28 | 25 (24 interfaces + 1 barrel) | **3** (dispatcher, audit-emitter helpers, query-registry) |
| adapters/ | 53 | 27 | 26 | ~12 (barrels, type helpers, throw-stubs, seed-fixture data) | **~14** |
| modules/ | 153 | 0 | 153 | ~60 (entity wrappers, event-type unions, barrels, intent unions) | **~93** |
| packages/ (A) | 181 | 6 | 175 | ~50 (arch/contract/chaos test-infra, barrels, design tokens) | **~125** |
| packages/ (B) | 154 | 10 | 144 | ~38 (test/test-fixtures/test-state, schemas, seeder data, barrels) | **~106** |
| apps/ | 171 | 17 | 154 | ~80 (surfaces, barrels, wiring, sandbox specimens) | **~74** |
| **Total** | **740** | **60** | **680** | **~265** | **~415** |

Headline: **~8% colocated coverage**, and ~415 production files where a colocated unit test is structurally appropriate but missing.

## Where colocated tests already exist (the model)

These packages already do it right — use as templates:

- `adapters/idb/src/*.test.ts` — 8 colocated tests (entity-store, relation-store, etc. partial)
- `adapters/node/src/*.test.ts` — 13 colocated tests (entity-store, event-store, projection-store, etc.)
- `adapters/policy-cedar/src/*.test.ts` — 4 colocated tests
- `apps/server/src/middleware/*.test.ts` — `principal`, `state`, `errors`, `execution-context`, `tenant-resolution`
- `apps/server/src/routes/*.test.ts` — `admin-logging`, `repositories`, `docs`, `events`
- `apps/server/src/config.test.ts`, `apps/server/src/events/principal-cache-dispatcher.test.ts`
- `packages/dsl-expression/src/{parser,evaluator,conformance}.test.ts`
- `packages/dsl-substrate/src/{artifact,evaluator,contract-tests}.test.ts`
- `packages/platform-core/src/**` — 10 colocated tests

Pattern is established and working. The job is to spread it.

---

## Hexagonal violations (highest-priority structural finding)

The user explicitly asked for hexagonal rigor — pure service classes in `modules/`, only wiring in `apps/`. The apps/ sweep flagged 5 files with business logic that should NOT live in `apps/`. These are the **structural** problems; tests on these files would be papering over a layering issue.

| File | Logic | Recommended home |
|------|-------|------------------|
| `apps/authoring/src/page-editor/state.ts` | `PageEditorState` state machine (selection, mode, panel state, history orchestration) | Extract to a new `@atlas/page-editor-state` package or `modules/page-editor/` |
| `apps/authoring/src/page-editor/history.ts` | `HistoryStack` — undo/redo algorithm, 100-frame cap, replay logic | Extract to same package (shared across page/block/layout editors) |
| `apps/server/src/routes/identity.ts` | Route handler runs `identityDispatcher` inline (mixes I/O with domain dispatch) | Move dispatch into `middleware/state.ts` composition; route stays thin |
| `apps/server/src/routes/intents.ts` | Orchestrates `submitIntent` + error mapping + intent-duration metrics | Push orchestration into `@atlas/ingress`; route becomes wrapper |
| `apps/projection-worker/src/diff.ts` | Shadow-mode adapter wrapper recording writes for diff vs live store | Move to `adapters/` or a `@atlas/projection-diff` package |

**Decision needed:** classify these as `extract` (fix layering) or `test-in-place` (accept the location). The user's stated principle says `extract` for #1, #2, #5; #3 and #4 are borderline and may stay if routes are accepted as orchestration seams.

---

## Real gaps by area

### ports/ — 3 files

```
ports/src/dispatcher.ts       — composeDispatchers + cacheTagDispatcher (error fan-out semantics)
ports/src/audit-emitter.ts    — policyEvaluatedEvent builder + shouldEmitPolicyEvaluated gate
ports/src/query-registry.ts   — createQueryRegistry factory + validateDescriptor
```

All 24 other ports/ files are pure interfaces — no test warranted (port = surface, adapter = implementation).

### adapters/ — ~14 files

**adapter-logic without any test:**
```
adapters/idb/src/crypto.ts
adapters/idb/src/entity-store.ts
adapters/idb/src/relation-store.ts
adapters/idb/src/db.ts
adapters/node/src/entity-store.ts
adapters/node/src/entity-type-registry.ts
adapters/node/src/policy-store.ts
adapters/node/src/relation-store.ts
adapters/node/src/repository-revision-store.ts
adapters/node/src/signup-request-store.ts
adapters/node/src/tenant-store.ts
adapters/node/src/migrations/runner.ts
adapters/policy-cedar/src/bundle-loader.ts
adapters/seed-memory/src/in-memory-seed-corpus.ts
```

Some are covered by port contract suites running across both adapters; that gives behavioral parity but not full unit coverage of adapter-specific code (SQL strings, IDB schema setup, migration runner control flow).

### modules/ — ~93 files

**0 colocated tests across all 7 modules.** Tests live in `modules/<x>/test/`. Many handlers have a test there; the inventory below distinguishes "has non-colocated test" from "no test anywhere".

#### No test anywhere (Tier-1 — fill first)

```
# Catalog projections (I12 rebuild invariant uncovered)
modules/catalog/src/projections/family-detail.ts
modules/catalog/src/projections/search-documents.ts
modules/catalog/src/projections/taxonomy-navigation.ts
modules/catalog/src/projections/variant-matrix.ts
modules/catalog/src/dispatch.ts

# Catalog queries
modules/catalog/src/queries/search.ts
modules/catalog/src/queries/taxonomy-nodes.ts
modules/catalog/src/queries/variant-table.ts

# Content-pages
modules/content-pages/src/dispatch.ts
modules/content-pages/src/render-tree.ts          ← pure builder, prime unit-test target
modules/content-pages/src/queries.ts

# Identity — SECURITY-ADJACENT, untested
modules/identity/src/saml/verify.ts                ← signature/assertion verifier
modules/identity/src/saml/metadata-parser.ts       ← XML parser
modules/identity/src/saml/authn-request.ts
modules/identity/src/saml/xml-narrow.ts
modules/identity/src/risk/scorer.ts
modules/identity/src/session-lifetime.ts

# Repository queries
modules/repository/src/queries/repositories.ts

# Tenancy
modules/tenancy/src/handlers/signup-deny.ts
modules/tenancy/src/handlers/signup-submit.ts

# DSL
modules/dsl/src/kind-registry.ts

# AuthZ
modules/authz/src/handlers/activate-policy.ts
modules/authz/src/handlers/archive-policy.ts
```

#### Has non-colocated test in `modules/<x>/test/` — move to colocated `*.test.ts` next to source

48 identity handlers, 3 content-pages handlers, 2 catalog handlers, 2 repository handlers, 1 DSL handler all fit this category. Migration is mechanical (`mv modules/X/test/unit/foo.test.ts modules/X/src/handlers/foo.test.ts`) but each requires re-pathing imports.

### packages/ (A) — ~125 files

**packages/core (5 files) — CRITICAL FOUNDATION**
```
packages/core/src/signals.ts            ← reactive signal primitives — load-bearing
packages/core/src/component.ts          ← AtlasElement base — every UI element extends this
packages/core/src/html.ts               ← safe template tag with event binding/escaping
packages/core/src/telemetry-pipeline.ts ← frontend telemetry
```

**packages/design (90 web components) — HIGHEST VOLUME**
All 90 `atlas-*.ts` components extend `AtlasElement`. Strategy decision needed:
- (a) Test each component's signal/state logic individually (90 colocated tests)
- (b) Rely on BDD/sandbox specimens for rendering, only colocate tests for components with non-trivial logic (date-picker, command-palette, color-picker, multi-select-core, code-editor, breakpoints/icons utilities)

Recommended: (b). Most of `packages/design` is HTML/CSS shape — surface-state assertions in BDD already cover these. Carve out the ~10–15 with real logic.

**packages/ingress (4 files) — CRITICAL REQUEST LIFECYCLE**
```
packages/ingress/src/submit-intent.ts       ← authn/authz/idempotency/handler pipeline
packages/ingress/src/evaluate-read.ts       ← read-path authorization
packages/ingress/src/fetch-interceptor.ts   ← (low priority — stub)
```

**packages/logging (6 runtime files), packages/metrics (5), packages/openapi (4), packages/api-client (5), dsl-expression (4), dsl-substrate (7)** — straightforward gaps.

**Test-infra packages (do not test):** `arch-tests`, `contract-tests`, `chaos`.

### packages/ (B) — ~106 files

**packages/page-templates (37 files)** — block-editor, layout-editor, drag-and-drop controller, page-store, layout-store, drop-zone validation. Highest non-app concentration of UI state-machine logic in the repo.

**packages/widgets (45 files)** — chart rendering (line/area/bar/pie/stacked), data-table core (sort/filter/selection), data sources, scales, color palette. Strategy decision: pure logic files (`scales.ts`, `sort-core.ts`, `filter-core.ts`, `data-normalize.ts`, `patch.ts`) are perfect unit-test targets; renderers and web-components fall under the design package strategy.

**packages/widget-host (16), wasm-host (9), seeder (5), schemas (1)** — runtime-logic for execute paths, plugin loaders, host adapters.

**Test-infra packages (do not test):** `test`, `test-fixtures`, `test-state`.

### apps/ — ~74 files (excluding hexagonal violations called out separately)

**apps/server route handlers (15 untested)** — most are thin delegations. Inventory recommended action: extract delegation target to a named function and colocate its test, per the testability rule in `CLAUDE.md` §Test Pyramid Reconciliation. Specific files:

```
apps/server/src/routes/{authz,catalog,content-pages,dsl,identity-idp,mfa,oauth,queries,saml,scim,signup,tenant-home,admin-spa,metrics,debug}.ts
```

**apps/server middleware (6 untested):** `cookie`, `correlation`, `csrf`, `dev-principal`, `jwks-cache`, `role-check`, `scim-auth`.

**apps/server bootstrap/wiring:** `bootstrap.ts`, `bootstrap-platform-admin.ts`, `main.ts`, `events/broadcast.ts`, `events/dispatcher.ts`. Low test priority if no branching; review case-by-case.

**apps/atlasctl (16 files, 0 colocated, ~6 with non-colocated tests in `apps/atlasctl/test/`)** — move existing tests next to source; add tests for `repo.ts`, `logging.ts`, `config.ts`, `client.ts`, `correlation.ts`, `json.ts`.

**apps/projection-worker/src/tenant-loop.ts** — has non-colocated test; move to colocated.

**Vite frontend apps (admin/authoring/sandbox/sim)** — pure composition is fine without unit tests; `apps/authoring/src/page-editor/{state,history}.ts` are the structural issue (call-out above), not test gaps.

---

## Build-exclusion check (Task #8)

How tests stay out of production:

| Layer | Build path | Test exclusion mechanism | Verdict |
|-------|-----------|--------------------------|---------|
| Node apps (`apps/server`, `apps/projection-worker`, `apps/atlasctl`) | `node --experimental-transform-types src/main.ts` — runs `.ts` directly, no bundle | Test runners discover by filename glob; `.test.ts` files are never imported by `main.ts`, so they never load in production | **Safe** (transitive — relies on no production code path importing a test) |
| Vite SPA apps (`apps/admin`, `authoring`, `sandbox`, `sim`) | `vite build` — bundles from `index.html` entry | Same — Vite tree-shakes from entry; `.test.ts` not imported, never bundled | **Safe** |
| TypeScript typecheck | `tsgo --noEmit -p tsconfig.json` with `include: ["src/**/*.ts"]` | Currently INCLUDES `.test.ts` files in typecheck — they need test-runner types in scope | **Needs work** |
| Library packages (`packages/*`, `modules/*`, `adapters/*`) | `main: "src/index.ts"` direct re-export; no compile step | Test files only reachable via the test runner's glob | **Safe** |

**Follow-up gates** to add when colocating widely:

1. Every `tsconfig.json` `include` should keep `src/**/*.ts` but add `"types": ["node", "vitest/globals"]` (or equivalent for `atlas-test`) so `.test.ts` typechecks cleanly.
2. Coverage runs must continue excluding `**/*.test.ts` (vitest default — verify).
3. Add a `pnpm lint:semgrep` rule: no production file may import from `*.test.ts`.

---

## Proposed next steps (for user decision)

1. **Hexagonal extractions first.** Pull `page-editor/state.ts` and `history.ts` out of `apps/authoring`. Pull `projection-worker/diff.ts` out of `apps/projection-worker`. These are layering problems; tests come along after extraction.
2. **Tier-1 untested security/correctness gaps.** Add tests for `modules/identity/src/saml/*` (signature verification, metadata parsing) and `modules/identity/src/risk/scorer.ts`. These are security-adjacent with zero coverage.
3. **I12 rebuild invariant — catalog projections + dispatcher.** Add `dispatch.test.ts` for catalog and content-pages (per `CLAUDE.md` §Mechanically-checked invariants).
4. **Mechanical relocation pass.** All identity / repository / dsl handler tests in `modules/<x>/test/*` move to colocated `*.test.ts` next to source. ~60 files.
5. **Choose the design-package strategy.** Decide (a) full per-component testing vs (b) BDD + selected logic-rich components. Affects ~90 files.
6. **Add the lint gate** for "no production import of `*.test.ts`" and the tsconfig type-scoping fix.

This file is the source of truth for the sweep; update it as items get scheduled into their own tickets under `tickets/testing-floor/`.
