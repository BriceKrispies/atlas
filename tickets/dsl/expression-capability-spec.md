---
title: Retroactively scope a capability README for the DSL expression surface (spec-first gate was bypassed)
status: open
type: spec
owner: spec-keeper
phase: 0
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: [agentic-first]
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - specs/domains/dsl/expression/capabilities/
  - specs/domains/dsl/expression/module.manifest.json
acceptance:
  - "A capability README exists at the canonical path specs/domains/dsl/expression/capabilities/<name>/README.md with the slice-template shape (purpose / invariants touched / lexicon / surfaces / lifecycle / acceptance)"
  - "The already-landed DSL slices trace to it: #5a Dsl.Expression.Update, #5b read/validate routes, dsl/cedar-policy-actions (the I2 read gate)"
  - "Reconciles with the existing module.manifest.json + ADR 0007 — documents, does not change, behavior"
created: 2026-05-24
updated: 2026-05-24
---

## Why

Surfaced by the `dsl/cedar-policy-actions` pilot (2026-05-24): there is **no capability README anywhere under `specs/domains/dsl/`** — the entire DSL surface (the `dsl-expression` / `dsl-substrate` packages, the `Dsl.Expression.Update` save path, the read/validate routes, and now the authz gate) shipped against only `module.manifest.json` + ADR 0007. That's a bypass of the slice-workflow spec-first hard gate ("no code without a capability README at the canonical path"). Both the implementer (module-dev) and the architect flagged it independently.

The risk is recurrence: the next DSL-kind slices (`dsl/template-dsl`, `dsl/query-dsl`) have no capability spec to trace to, so they'll skip the gate the same way. Authoring the expression capability README retroactively gives them the pattern and a target.

## Scope

Retroactively author the DSL-expression capability README at the canonical path, reconciling it with the landed manifest + routes + ADR 0007. Out of scope: any behavior change; the template/query DSL kinds get their own specs.

## Notes / log

- 2026-05-24: filed from the cedar-policy-actions pilot — process finding, not a code bug. The DSL substrate is built and tested; only the canonical spec is missing.
