# 0007 — DSL substrate and authoring contract

**Status:** Accepted (2026-05-09)
**Depends on:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (revives Extensibility, agentic-first), [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) (I14 tenant-code isolation, I15 egress mediation, I16 schema-mutation scope, I17 API/CLI/UI parity, I18 surface introspection), [`0005-custom-schema-storage-strategy.md`](0005-custom-schema-storage-strategy.md) (db-per-tenant; revised 2026-05-20 from the original schema-per-tenant call), [`0006-function-runtime-substrate.md`](0006-function-runtime-substrate.md) (gVisor for tenant code).

## Context

[`vision.md`](../vision.md)'s data-driven CMS dream (and the broader Salesforce-shaped ambition) requires tenants to author **declarations** that the platform evaluates: page templates, query expressions, computed-field formulas, validation rules, workflow trigger conditions, layout compositions. None of these are "tenant code" in the I14 sense — they are constrained, non-Turing-complete declarations that an Atlas-authored interpreter evaluates.

Without a substrate decision now, every individual DSL capability spec (templating, query, formula, validation, layout, …) will independently re-litigate:

- Where artifacts live (per-tenant DB? control-plane? object-storage?)
- Source-of-truth representation (text? AST? both?)
- Compilation model (interpret-on-read? compile-on-save? JIT?)
- Execution boundary (in `apps/server`? `FunctionRuntime`? a third place?)
- Authoring API shape (REST? intent-only? validate-without-save?)
- Versioning, error reporting, source-map format
- How DSLs reference each other and call into tenant functions

The cost of getting this wrong compounds: each DSL grows its own quirks, agents need N adapters to author them, and the I14 boundary gets renegotiated per DSL. The 2026-05-09 user checkpoint chose to land the substrate now, before any individual DSL capability is scoped.

A specific problem this ADR resolves: **I14 forbids tenant code from executing in `apps/server`.** A naïve reading would force every template render and every formula evaluation through gVisor (`FunctionRuntime`), incurring ~100ms cold-start per render. That is incompatible with serving a CMS page in under a second. The resolution is not to weaken I14, but to define DSL declarations as a category distinct from tenant code, with a constrained execution model the platform can host directly.

## Decision

### 1. DSL declarations are a third execution category

Atlas distinguishes three kinds of code/declarations and gives each its own execution model:

| Category | Authored by | Executes in | Boundary | Examples |
|---|---|---|---|---|
| **Platform code** | Atlas maintainers | `apps/server`, `apps/projection-worker`, adapters | n/a (trusted) | Handlers, projections, adapters |
| **Tenant declarations** *(this ADR)* | Tenants (via DSL artifacts) | `apps/server` request path, via the platform DSL evaluator | DSL contract (this ADR) | Templates, queries, formulas, validations |
| **Tenant code** | Tenants (via `functions`) | `FunctionRuntime` adapter, out-of-process (gVisor per ADR 0006) | I14 / I15 | HTTP handlers, lifecycle hooks, scheduled jobs |

Tenant declarations are **not** tenant code in the I14 sense and do **not** route through `FunctionRuntime`. I14 stands unchanged; this ADR carves the boundary tightly enough that the carve does not weaken it.

### 2. The DSL contract — what makes a declaration safe to evaluate in `apps/server`

Every DSL Atlas hosts MUST satisfy all of the following. This is the price of in-process execution; a DSL that cannot satisfy these properties is tenant code and goes through `FunctionRuntime`.

1. **Non-Turing-complete or provably-bounded.** No unbounded recursion, no unbounded loops. Looping constructs (e.g., `{% for %}`) must iterate over a finite, statically-evaluable collection. If the language admits user-defined functions, recursion depth is bounded by a static limit.
2. **Pure with respect to host state.** No mutation of host objects. Outputs are functions of inputs and the host-provided context only.
3. **No ambient I/O.** No filesystem, network, DNS, environment, clock, or random access except through explicitly declared **host operations** (see §6). Egress (I15) is impossible by construction because there is no syntax for it.
4. **Deterministic.** Same `(source, inputs, host-operation results)` MUST produce the same output. The host operation set is what makes results reproducible — `now()` is a host op, not an ambient call.
5. **Bounded execution.** Every evaluation runs under a step budget (instructions executed) and a wall-clock budget. Exceeding either returns `DSL_BUDGET_EXCEEDED` and aborts the host request — no partial output committed. Budgets are enforced by the platform evaluator, not by the DSL author.
6. **Statically typeable enough for error surfacing.** The grammar must permit an authoring-time check that fails closed: unknown identifiers, type mismatches, malformed expressions are caught before evaluation. Runtime-only errors are limited to host-op failures and budget exhaustion.

A DSL spec MUST include a "DSL contract conformance" subsection demonstrating each property. `architect` rejects DSL capability specs that don't.

### 3. Storage — DSL artifacts live in the tenant's database

DSL artifacts are tenant-owned content; per [ADR 0005](0005-custom-schema-storage-strategy.md) they live in **the tenant's database** (`atlas_t_<tenantUuid>` is a Postgres database name, not a schema name). Specifically, in **platform-owned tables sibling to `_atlas_object_types`**, in the default `public` schema inside the tenant's DB:

- `public._atlas_dsl_<kind>` inside `atlas_t_<tenantUuid>` — one table per DSL kind (e.g. `_atlas_dsl_template`, `_atlas_dsl_query`, `_atlas_dsl_formula`). The `_atlas_` prefix marks the table as platform-owned (tenant DDL via the allowlist cannot create, alter, or drop tables with that prefix).
- Each row: `artifact_id` (uuid PK), `api_name` (tenant-unique), `source` (text, canonical), `ast` (jsonb, projected — see §4), `version` (bigint, monotonic per artifact), `created_at`, `updated_at`, `created_by`, `updated_by`.
- Table bootstrap is lazy on first artifact of a given kind, mirroring the `_atlas_object_types` lazy-bootstrap pattern from `custom-schema/object-definition`.
- Each kind also lazy-bootstraps a sibling `_atlas_dsl_<kind>_versions` history table for prior-version recovery (see §7).

DSL artifacts do **not** become custom-schema `ObjectType`s. They are platform infrastructure (platform-owned tables inside the tenant DB) holding tenant content (tenant-owned rows). Treating them as `ObjectType`s would create a bootstrap circularity (a `Template` `ObjectType` would itself need a template to render). Per-tenant DB, platform-managed shape — same pattern as `_atlas_object_types` and `_atlas_tenant_migrations`.

I16 holds: DSL writes affect only the issuing tenant's DB; the two-role topology from ADR 0005 §Constraints item 3 (platform-owned provisioner role for DDL, tenant runtime role for CRUD) makes cross-tenant access impossible at the protocol layer — a different database is a different connection target, a different catalog, and a different WAL stream.

### 4. Source-of-truth — text is canonical, AST is a projection

For each DSL artifact:

- **`source` (text) is canonical.** It is the field tenants edit, that the authoring API returns, that diffs render, that prior versions preserve.
- **`ast` (jsonb) is a projection rebuildable from `source`.** Generated by the DSL's parser, stored alongside the row to amortize parse cost across reads. On every save, the parser regenerates `ast` from `source`; on event replay, the dispatcher regenerates `ast` from `source`. The two MUST agree — a parity test in each DSL's capability spec asserts `parse(source) === ast`.

This satisfies I12 (projections rebuildable from events): `ast` is recovered by re-running the parser over `source` from the event log. The compiled / executable form (if any — see §5) is a transient cache, never persisted, never event-sourced.

The authoring API exposes both `source` and `ast` on every read so agents can either edit the text or manipulate the AST directly. AST manipulation routes back through the parser (AST → text → parse → AST') to keep `source` canonical and prevent divergent shapes — the platform never accepts an AST as input authority.

### 5. Compilation model — parse on save, evaluate on read, cache in memory

- **On save**: parse `source` → produce `ast` → store both in the same transaction → emit `Dsl.<Kind>.Updated` event with `cacheInvalidationTags: ['Tenant:${tenantId}', 'DslArtifact:${artifactId}']`.
- **On read** (i.e., evaluating the artifact in a host request): the DSL evaluator loads `ast` from the projection (cache → DB), produces an executable form (closure, bytecode, or interpreted-AST depending on the engine), evaluates with the supplied inputs and host operations, returns the result.
- **Executable-form cache** is per-process, keyed by `(tenantId, artifactId, version)`, invalidated by the `cacheInvalidationTags` from `Dsl.<Kind>.Updated`. The cache is a performance optimization; correctness does not depend on it. Cold cache rebuilds from `ast`.

Tag-based invalidation per I9/I10 holds. The executable cache observes the same invariants as every other tenant-keyed cache.

### 6. Host operations — the only way out of pure evaluation

Each DSL declares a closed set of **host operations** the evaluator exposes. Examples (per-DSL specs will name their actual sets):

- **Templating**: `escape(value)`, `format(value, fmt)`, `now()`, `lookup(objectType, id)`.
- **Query**: `where(field, op, value)`, `orderBy(field, dir)`, `limit(n)`.
- **Formula**: arithmetic, string ops, date math, `field(name)`.

Two host-op categories matter for the I14/I15 boundary:

- **Pure host ops** (`escape`, `format`, arithmetic) execute in `apps/server` directly — they are platform code with no I/O.
- **Effectful host ops** (`lookup`, `function(fnName, args)`, anything that crosses to a tenant-owned object or invokes a tenant function) MUST route through the existing port boundaries:
  - Reads of tenant-defined object types go through the `EntityStore` / `SchemaDefinitionStore` ports — same isolation as a normal handler read.
  - Calls into tenant-authored functions go through the `FunctionRuntime` port — I14 is preserved at the call site. The DSL stays in-process; the function call crosses the boundary the same way a handler would.
  - Outbound HTTP is **not a host op available to any DSL**, ever. Tenants who need egress write a function and call it. I15 holds.

Host ops are part of each DSL's specified surface and are versioned with it. Adding a host op is a spec change; removing one is a breaking change handled by the versioning rules in §7.

### 7. Versioning — event-sourced, latest by default, pin by version id

- Every save emits `Dsl.<Kind>.Updated` carrying the new `version` (monotonic per `artifactId`). Prior `(source, ast)` pairs are appended to `_atlas_dsl_<kind>_versions` for recovery.
- **Reads default to latest.** A render-time lookup of `template:home` resolves to the current `version`.
- **Pinning**: callers may resolve `template:home@v=42` to lock a version. Used by audit replay, A/B tests, and snapshot diffs.
- **No compile-time linking across artifacts.** Cross-DSL references (a template that uses a query) resolve at evaluation time against the current version of the referenced artifact. This keeps the dependency graph data-driven; it also means breaking a query breaks templates that use it. Mitigation: the validate endpoint (§8) is dependency-aware and surfaces broken references at authoring time.
- **Replay**: re-running the event stream rebuilds `_atlas_dsl_<kind>` and `_atlas_dsl_<kind>_versions` identically. I12 holds.

### 8. Authoring contract — agentic-first by construction

Every DSL exposes the same authoring shape, so agents and humans use one mental model across all DSLs.

| Surface | Action / endpoint | Purpose |
|---|---|---|
| Intent | `Dsl.<Kind>.Update` payload `{ apiName, source }` via `POST /api/v1/intents` | Save a new version of an artifact. Standard ingress pipeline (I2/I3/I5/I13). |
| Read | `GET /api/v1/dsl/<kind>` | List tenant's artifacts of a kind. |
| Read | `GET /api/v1/dsl/<kind>/:apiName` | Returns `{ source, ast, version, sourceMap, dependencies, errors }`. `errors` is the static-check result. |
| Read | `POST /api/v1/dsl/<kind>/validate` payload `{ source }` | Parse + static-check WITHOUT persisting. Returns the same shape as the read above. **Enables agent-iterate-without-commit loops**, which the agentic-first tenet (ADR 0003 §3) leans on. No idempotency key, no audit event, no quota debit beyond the validate-budget dimension. |
| atlasctl | `atlasctl dsl <kind> {list,show,save,validate}` | I17 parity. |

The `sourceMap` field maps AST nodes back to source line/column ranges. Errors include `{ code, message, sourceRange, suggestion? }`. This is non-negotiable: an error without a source range is invisible to an agent trying to fix it.

`POST /api/v1/intents` for `Dsl.<Kind>.Update` is the **only** write path. There is no PUT/PATCH side door — observes I1 and REQ-INGRESS-002.

### 9. Shared substrate vs per-DSL specifics

Atlas ships a shared infrastructure package — call it `@atlas/dsl-substrate` (name finalized when the first DSL spec lands) — containing:

- A parser-combinator library (or vendored equivalent) for grammar authoring.
- The canonical `DslError` shape with `sourceMap`-friendly ranges.
- The host-op interface and a registry pattern.
- The step/wall-clock budget enforcer.
- Cache-key conventions for the executable-form cache.
- Contract test helpers for DSL conformance (the §2 properties).

Each DSL ships its own grammar, AST type, evaluator, and host-op set. There is **no shared AST across DSLs** — different DSLs have different semantics and a one-true-tree leaks abstractions. The shared substrate is plumbing, not semantics.

### 10. First DSLs — slot-named, not scoped here

This ADR commits to the substrate, not to any individual DSL. The expected order, recorded for planning purposes only:

1. **Expression DSL** — `${user.name | upper}` style; no statements, just typed expressions over a host-supplied scope. Smallest grammar, lowest risk, embedded by other DSLs.
2. **Template DSL** — text + interpolation + bounded `{% if %}` / `{% for over finite-collection %}`. Builds on the expression DSL.
3. **Query DSL** — typed query against a `custom-schema` object type; lowers to parameterized SQL via the adapter (no string concatenation; same identifier-safety bar the ADR 0005 DDL allowlist applies inside the tenant's DB).

Validation, formula, layout, and trigger-condition DSLs follow as their parent capabilities are scoped. Each lands as its own capability spec under the relevant domain (templating + layout under whatever the `seeds/cms-standard` capability stack ends up being; formula under `custom-schema/formula-fields`; trigger conditions under `workflow/triggers`; validation under `custom-schema/validation-rules`).

## Constraints this imposes

The choice carries forward into capability specs:

1. **Each DSL capability spec MUST include a "DSL contract conformance" section** demonstrating §2 properties 1–6. Specs that don't are rejected.
2. **The first DSL capability spec lands `@atlas/dsl-substrate`** (or whatever the package is named). Subsequent DSL specs depend on it; do not re-implement the substrate per DSL.
3. **The `Dsl.<Kind>.Update` action MUST flow through the standard ingress pipeline** — authz (`Dsl.<Kind>:Update` against the tenant), idempotency on envelope key, quota check (`enforceQuota(tenantId, 'dsl-artifacts-per-tenant')` and `enforceQuota(tenantId, 'dsl-evaluations-per-window')`), then handler. The validate endpoint debits a separate dimension (`dsl-validations-per-window`) so agent iteration doesn't burn the artifact budget.
4. **Effectful host ops MUST be routed through existing ports** — `EntityStore`/`SchemaDefinitionStore` for object reads, `FunctionRuntime` for function calls. No new tenant-data side door. I14 / I15 / I16 unchanged.
5. **No DSL artifact may execute another DSL artifact's source as code.** A template can call a query host op; it cannot `eval` a string. Closes the obvious sandbox-escape vector.
6. **Step and wall-clock budgets are enforced by the substrate, not the DSL author.** The substrate's evaluator-loop counts; the DSL's evaluator only declares the per-step cost of each AST node kind.
7. **The executable-form cache MUST observe `cacheInvalidationTags`** like every other tenant-keyed cache. I9 / I10 unchanged.
8. **DSL routes MUST have `atlasctl` parity** — I17.

## Consequences

**Positive:**

- The data-driven CMS dream becomes mechanically possible: a `seeds/cms-standard` bundle can ship `(ObjectType definitions, Template artifacts, Query artifacts)` as data and produce a working CMS without any per-tenant code deploy.
- Future DSLs (formula, validation, layout, trigger conditions) inherit the substrate, the authoring API, and the agent contract. New DSL capability specs are about grammar and semantics, not plumbing.
- The agentic-first tenet (ADR 0003 §3) gets a load-bearing surface: every DSL artifact is `{ source, ast, version, errors, sourceMap }` over the wire, which is exactly the shape an agent can read, edit, validate-without-commit, and re-save.
- I14 stays strict — DSLs do not weaken it, they sit beside it. Tenant code (functions) still pays the gVisor cost; tenant declarations don't, because they are constrained out of needing it.
- The substrate is one package; per-DSL costs are grammar + evaluator + host ops. Estimated 500–1000 LOC per simple DSL after the substrate exists.

**Negative:**

- The §2 contract is a real constraint on language design. A DSL author who wants `while (true) { … }` must either bound it statically or accept that their language is tenant code (gVisor). Authors will push back.
- Cross-DSL references resolve at evaluation time, not save time. Breaking a query breaks consuming templates at render time, not at the `Dsl.Query.Update` save. The validate endpoint helps but is opt-in.
- Per-tenant tables grow per DSL kind. 8 DSL kinds × 10k tenants = 80k extra tables. Postgres handles this fine but operator tooling has another fan-out dimension.
- The §8 authoring contract is opinionated — every DSL exposes the same shape. DSLs that don't fit (e.g., a future graphical-only authoring surface) need an explicit ADR amendment.
- Versioning is monotonic per artifact but there is no fleet-wide pinning yet. A breaking substrate upgrade affects every DSL artifact across every tenant simultaneously. Mitigation: substrate semver and a substrate-version field on each artifact (deferred to first DSL spec).

**Out of scope:**

- The grammar of any specific DSL — each lands in its own capability spec.
- The exact name and surface of `@atlas/dsl-substrate` — confirmed when the first DSL spec lands.
- A graphical / no-code authoring UI — text-first per this ADR; visual editors land later as a UI surface that emits the same `Dsl.<Kind>.Update` intents.
- The `dsl-evaluations-per-window` and `dsl-validations-per-window` quota dimensions — owned by Commerce, scoped when their first consumer lands.
- DSL-internal observability (per-evaluation traces, slow-evaluation logs) — handled per `specs/crosscut/logging.md`'s standard contract; no DSL-specific telemetry surface.
- Cross-tenant DSL artifact sharing (a tenant publishing a template for others to reference) — Phase 5+, conceptually parallel to ADR 0005 §"Out of scope" item 2 on cross-tenant data sharing.

## Migration

1. **This ADR (spec-only):** records the decision.
2. **Architecture cross-reference:** `specs/architecture.md` "Tenant Runtime Isolation" section (added by ADR 0004 follow-up) gains a paragraph distinguishing tenant declarations from tenant code, citing this ADR.
3. **Lexicon patch:** `specs/LEXICON.md` adds entries for `DslArtifact`, `HostOperation`, `DslContract`. Lands with the first DSL capability spec, before code.
4. **First DSL capability spec** (suggested: expression DSL, smallest grammar) lands `@atlas/dsl-substrate`, the `_atlas_dsl_<kind>` storage pattern, the §8 authoring shape, and the §2 contract-conformance template. Subsequent DSL specs depend on it.
5. **Quota handoff to Commerce:** the `dsl-artifacts-per-tenant`, `dsl-evaluations-per-window`, `dsl-validations-per-window` dimensions land via Commerce's quota-dimension scoping, gated behind whichever DSL ships first.
6. **No code changes in this PR.**

## Cross-references

- Vision dream this enables: [`vision.md`](../vision.md) §"What Atlas is" / Salesforce-shaped data + agentic surfaces.
- Tenant-code boundary it does not weaken: [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) I14, I15.
- Storage pattern it reuses: [`0005-custom-schema-storage-strategy.md`](0005-custom-schema-storage-strategy.md) (db-per-tenant, lazy bootstrap of platform-owned tables inside each tenant's database).
- Tenant-code execution model it sits beside: [`0006-function-runtime-substrate.md`](0006-function-runtime-substrate.md).
- Event-sourcing / projection-rebuild contract it observes: [`architecture.md`](../architecture.md) I12.
- Cache-tag contract it observes: [`architecture.md`](../architecture.md) I9, I10.
- Authoring-pipeline contract it observes: [`architecture.md`](../architecture.md) I1, I2, I3, I5, I13; [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) I17, I18, REQ-INGRESS-002, REQ-AGENT-001.
- Pattern reference for the per-tenant platform-owned table shape: [`domains/custom-schema/capabilities/object-definition/README.md`](../domains/custom-schema/capabilities/object-definition/README.md) §"Per-Tenant Registry and Migration Ledger".
