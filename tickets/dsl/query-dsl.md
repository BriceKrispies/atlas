---
title: Query DSL — typed read against EntityStore via effectful host ops
status: open
type: capability
owner: spec-keeper
phase: 0
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: [I7, I9]
blocks: []
blocked_by: []
files_in_scope:
  - packages/dsl-query/
  - adapters/node/src/migrations/tenant/00000005_dsl_query.sql
  - apps/server/src/bootstrap.ts
  - specs/domains/dsl/query/module.manifest.json
  - specs/schemas/contracts/dsl.query.update.v1.schema.json
  - specs/schemas/events/dsl.query.updated.v1.schema.json
  - packages/schemas/scripts/sync-schemas.ts
  - packages/schemas/src/loader.ts
  - ports/src/dsl-substrate.ts  # PortName widened
acceptance:
  - packages/dsl-query/ exists; full §2 conformance proof passes
  - First DSL kind with effectful host ops — `query.find(type, filter)`, `query.findById(type, id)` declare `category: 'effectful'`, `port: 'EntityStore'`
  - Static checker enforces tenant scoping (I7) — every query AST referencing an entity type must implicitly scope by tenantId from the request principal; no escape hatch
  - Result-row count bounded by BudgetTicket; large result sets exceed budget rather than streaming
  - Dsl.Query.Update intent flows through the existing handler (no handler change)
  - Migration pre-creates _atlas_dsl_query + versions tables
  - Live smoke: POST /api/v1/intents Dsl.Query.Update with `find('User', { role == "admin" })` → 200; reading the artifact then invoking it via a thin runner returns rows
  - pnpm --filter @atlas/dsl-query test, pnpm lint, pnpm deps:check clean
created: 2026-05-21
updated: 2026-05-21
---

## Why

ADR 0007 §10 names "query" as the third of the first three DSL kinds.
The expression + template DSLs are both purely-functional with `port: null`
host ops; the query DSL is the first to cross a port boundary
(`EntityStore`), making it the worked example for ADR 0007 §6's
effectful-op category. Tenants ship typed queries against their own
data — the same way they ship expressions and templates — and the
runtime executes them with tenant scoping enforced at the static-check
boundary (I7).

Read paths that today are hard-coded in `apps/server/src/routes/*.ts`
become tenant-authorable. That's the unlock.

## Scope

Build `@atlas/dsl-query` as the first effectful-host-op DSL. Mirrors
the expression DSL package shape; differs in two important ways:
(1) host ops declare `port: 'EntityStore'`, (2) the static checker
enforces tenant scoping at parse time.

In scope:

- Grammar: `find(<EntityType>, <expression-filter>)`, `findById(<EntityType>, <expression-key>)`,
  `count(<EntityType>, <expression-filter>)`. The `<expression-filter>` is
  an embedded expression-DSL artifact (or inline source) that the static
  checker verifies returns boolean. Result projection: a small `pick(...)` /
  `omit(...)` operator over scalar fields.
- Host-op set: `query.find`, `query.findById`, `query.count`. ALL
  `category: 'effectful'`, `port: 'EntityStore'`. The runtime hands the
  evaluator a per-tenant `EntityStore` via `HostOpContext` (extend the
  context shape — see "Out of scope" caveat below).
- Static checker:
  - Verifies the entity type was declared via `Custom.Schema.Define` (looks
    up `state.entityTypeRegistry`)
  - Verifies the filter expression's return type is boolean (re-uses the
    expression DSL's static checker via the embedded path)
  - Rejects queries that reference entity types from another tenant —
    refuses path-walking through `tenantId` paths
- Evaluator: invokes the host op with a per-request `EntityStore` from
  `HostOpContext.entityStore`. Budget charges per row returned (so a
  500-row result with a 100-step budget exceeds — the operator decides
  how to lift, e.g. pagination).
- ADR amendment if needed: `HostOpContext` today carries `tenantId`,
  `correlationId`, `frozenNow`. Query DSL needs `entityStore` on the
  context. Two paths: (a) widen `HostOpContext`; (b) introduce a
  `QueryHostContext` extension. Decide in the spec; favour (a) so the
  context stays uniform across DSL kinds.

Out of scope:

- Mutations. Query DSL is read-only. Mutations remain in handler code
  until ADR 0007 specifies a write-DSL category.
- Cross-tenant federation. Per I7 every query is implicitly tenant-scoped.
- Index hints / EXPLAIN plans. The EntityStore adapter decides storage
  shape; the DSL just expresses the *intent*.
- A `join` operator. If tenants want graph traversal, that's RelationStore
  territory — a separate DSL category (or expanded scope of this one in
  v2). Defer.

## Resume prompt

```
You are the spec-keeper. Scope the query DSL per
specs/decisions/0007-dsl-substrate-and-authoring-contract.md §10.

Read these first:
- specs/decisions/0007-dsl-substrate-and-authoring-contract.md (substrate
  contract — §6 closed-set + effectful category is the key section)
- packages/dsl-expression/ (worked example for the kind-package shape)
- packages/dsl-substrate/src/host-ops.ts (HostOpDef contract — port: null
  for pure, port: PortName for effectful)
- modules/dsl/src/handlers/dsl-update.ts (kind-agnostic handler)
- ports/src/entity-store.ts (the port query.find/findById will invoke)
- modules/identity/src/queries.ts and modules/content-pages/src/queries.ts
  (existing hand-coded read paths the query DSL eventually subsumes)

Deliverable: a capability spec at
specs/domains/dsl/query/capabilities/query-evaluator/README.md
covering:
  - Grammar
  - AST shape
  - Host-op set (query.find, query.findById, query.count) with full
    HostOpDef declarations including port: 'EntityStore'
  - Static-checker rules — especially the I7 tenant-scoping enforcement
    (no path-walking through tenantId)
  - HostOpContext extension to carry entityStore (or QueryHostContext
    — pick one and justify)
  - Conformance: how each §2 property is demonstrated for an effectful
    DSL (purity assertion uses snapshot-isolated EntityStore reads; the
    determinism assertion requires the test fixture's EntityStore to
    return stable results)

When the spec is approved, hand off to module-dev for implementation.
Note: this is the first DSL with effectful ops — the substrate's
conformance checker's `checkNoAmbientIo` assertion is the key gate
(it verifies effectful ops declare a port).
```

## Notes / log

- 2026-05-21: created. Third DSL kind in the ADR 0007 §10 trio. Highest
  risk of the three because it's the first to cross a port boundary —
  ports/src/dsl-substrate.ts's `PortName` union already includes
  'EntityStore' from substrate slice #1, so the type is wired; the spec
  work is the missing piece.
