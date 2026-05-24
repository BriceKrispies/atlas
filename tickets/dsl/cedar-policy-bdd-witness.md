---
title: BDD witness — DSL read-surface authz (admin 200 / viewer reads / unprivileged 403) against the live Cedar bundle
status: open
type: test
owner: sdet
phase: 2
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: [I2]
blocks: []
blocked_by: [dsl/cedar-policy-actions]
files_in_scope:
  - tests/bdd/features/dsl/expression-policy.feature
  - tests/bdd/steps/dsl/*.ts
acceptance:
  - "bdd:server scenario: admin lists/reads/validates a DSL expression → 200"
  - "viewer principal → permitted reads (read-bucket grant)"
  - "unprivileged / anonymous principal → 403 AUTHZ_POLICY_DENIED"
  - "exercised against the seeded live Cedar bundle (not the static .cedar fixture) — closes the one wire-level link the unit layer doesn't cover"
created: 2026-05-24
updated: 2026-05-24
---

## Why

Architect followup #1 from the `dsl/cedar-policy-actions` invariant gate (2026-05-24, verdict PASS-WITH-FOLLOWUPS). The slice's unit layer proves gate ordering (`apps/server/src/routes/dsl.test.ts`) and the role-pack runtime grant (`modules/identity/test/role-packs.test.ts` drives the real manifest through the real classifier). What's NOT unit-witnessed is the wire-level permit: that the live Cedar engine + seeded bundle actually returns 200 for admin and 403 for an unprivileged caller. The architect ruled the slice structurally honest without this (the would-be-BDD-only assertion is closed at the unit layer per the Reconciliation Rule), so this is **belt-and-braces, non-blocking** — but owed for full Test-Pyramid closure on the DSL read surface.

## Scope

A `bdd:server` scenario over the three DSL read actions across admin / viewer / unprivileged principals. May merge into `dsl/bdd-roundtrip`'s feature file rather than a standalone feature (the cedar-policy-actions ticket flagged `expression-policy.feature` as optionally mergeable). Needs the live stack (db + apps/server + seeded Cedar bundle).

## Resume prompt

```
Add a bdd:server witness for DSL read-surface authz. The unit layer (apps/server/src/routes/dsl.test.ts + modules/identity/test/role-packs.test.ts) already proves gate ordering + the runtime grant; you are closing the wire-level integration link only. Scenario: seed a tenant with the standard role packs, then (a) admin lists/reads/validates a DSL expression → 200, (b) a viewer-role principal → reads permitted, (c) an unprivileged principal → 403 AUTHZ_POLICY_DENIED. Run via pnpm safe bdd:server (timeout 600000). Consider folding into tests/bdd/features/dsl/ alongside bdd-roundtrip.
```

## Notes / log

- 2026-05-24: filed as architect followup #1 from the cedar-policy-actions pilot. Non-blocking.
