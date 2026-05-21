---
title: Template DSL — text + interpolation + bounded {% if %} / {% for %}
status: open
type: capability
owner: spec-keeper
phase: 0
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - packages/dsl-template/
  - adapters/node/src/migrations/tenant/00000004_dsl_template.sql
  - apps/server/src/bootstrap.ts
  - specs/domains/dsl/template/module.manifest.json
  - specs/schemas/contracts/dsl.template.update.v1.schema.json
  - specs/schemas/events/dsl.template.updated.v1.schema.json
  - packages/schemas/scripts/sync-schemas.ts
  - packages/schemas/src/loader.ts
acceptance:
  - packages/dsl-template/ exists; full §2 conformance proof passes via makeConformanceChecker
  - Embedded expression DSL via `{{ ... }}` placeholders — re-uses @atlas/dsl-expression parser + evaluator inside text segments
  - Bounded control flow: `{% if expr %}...{% endif %}`, `{% for x in expr %}...{% endfor %}`. For-loop iteration count enforced by BudgetTicket.consumeSteps (no unbounded loops)
  - Dsl.Template.Update intent flows through the existing handler (modules/dsl) — no handler change
  - Migration 00000004_dsl_template.sql pre-creates _atlas_dsl_template + versions tables
  - bootstrap.ts registers the kind alongside expression
  - Live smoke: POST /api/v1/intents Dsl.Template.Update with `{% for x in items %}{{ x | upper }}{% endfor %}` → 200; GET reads it back
  - pnpm --filter @atlas/dsl-template test, pnpm lint, pnpm deps:check clean
created: 2026-05-21
updated: 2026-05-21
---

## Why

ADR 0007 §10 names "template" as one of the first three DSL kinds. The
expression DSL (slice #3) proved the substrate works for pure scalar
evaluation; the template DSL is the next natural step because it
*embeds* the expression DSL inside `{{ ... }}` placeholders — a real
test of the substrate's "many small DSLs composed" thesis (per the
plan agent's Phase 3 decision, confirmed by the user).

Template DSL is also what unlocks the materializer's surface-rendering
path (ADR 0014 §B.4 / future slice #8) — feature specs reference
template artifacts the same way they reference expression artifacts.

## Scope

Build `@atlas/dsl-template` as a sibling to `@atlas/dsl-expression`.
Re-use what already exists; do not duplicate.

In scope:

- Grammar: plain text + `{{ <expression-source> }}` interpolation + two
  control structures (`{% if expr %}` and `{% for x in expr %}`). No
  filters at the template level — they live inside the embedded
  expression (`{{ name | upper }}`).
- Parser: handwritten, two-phase. Top-level scans for `{{` / `{%`
  boundaries; embedded expressions hand off to `@atlas/dsl-expression`'s
  `parse()` and re-emit its source-map entries into the template's
  combined `SourceMap`. Tagged-union AST: `{kind:'text'|'interp'|'if'|'for'}`.
- Evaluator: walks the template AST, charging 1 step per node. `{% for %}`
  loops materialise iterations from the iterator expression — every
  iteration body charges its own steps, so deep / wide loops naturally
  exceed the budget per ADR 0007 §2 property 1.
- Host-op set: empty. Templates have no own host ops — all effects come
  through the embedded expression DSL's ops.
- Conformance: full §2 proof via the substrate's `makeConformanceChecker`.
  Six properties green (the embedded expression DSL's evaluator carries
  the purity / determinism / static-typeability properties through).
- Migration 00000004_dsl_template.sql modelled on the expression
  migration; mounting in bootstrap.ts is one line.

Out of scope:

- Custom block syntax beyond `if` / `for`. `else`, `elif`, partials,
  inheritance — defer to a follow-up if a real use case appears (the
  user said "intentionally extensible", not "feature-complete on day one").
- Whitespace control (`{%- -%}`). Useful but not load-bearing.
- HTML escaping by default — that belongs at the renderer (next slice
  past this one), not the template grammar. The `escape` host op in
  the expression DSL already exists for explicit use.

## Resume prompt

```
You are the spec-keeper. Scope the template DSL per
specs/decisions/0007-dsl-substrate-and-authoring-contract.md §10.

Read these first:
- specs/decisions/0007-dsl-substrate-and-authoring-contract.md (substrate contract)
- packages/dsl-expression/ (the worked example to mirror)
- packages/dsl-substrate/src/contract-tests.ts (the conformance checker
  the template DSL must pass)
- modules/dsl/src/handlers/dsl-update.ts (the kind-agnostic handler —
  template DSL plugs in via a new DslKind descriptor at boot)
- specs/domains/dsl/expression/module.manifest.json + the two
  dsl.expression.*.v1.schema.json files (the spec-side shape to mirror
  for template)

Deliverable: a capability spec at
specs/domains/dsl/template/capabilities/template-evaluator/README.md
covering:
  - Grammar (BNF or worked examples)
  - AST shape (tagged union of text/interp/if/for nodes)
  - Embedded-expression composition (how {{...}} hands off to
    @atlas/dsl-expression.parse; how source maps merge)
  - {% for %} iteration bound semantics (every iteration body charges
    its own BudgetTicket.consumeSteps)
  - Host-op set (empty; template has none; all effects via the embedded
    expression DSL)
  - Conformance: which §2 property each test in conformance.test.ts
    will demonstrate

When the spec is approved, hand off to module-dev with the implementation
scope and the matching schema/manifest files. The handler is unchanged —
template DSL plugs in via a DslKind descriptor at apps/server boot.
```

## Notes / log

- 2026-05-21: created. Lists in the chain after slice #5b
  (`feat(dsl): close the save path`) landed end-to-end save/read for the
  expression DSL. Template DSL is the next natural step because it
  re-uses the expression DSL as an embedded primitive.
