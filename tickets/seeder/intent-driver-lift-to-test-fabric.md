---
title: Lift IntentDriver out of @atlas/seeder once @atlas/test-fabric exists
status: open
type: refactor
owner: port-adapter-dev
phase: 0
capability: specs/crosscut/seed-corpus.md
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas]
invariants: [I1]
blocks: []
blocked_by: []
files_in_scope:
  - packages/seeder/src/types.ts
  - packages/seeder/src/index.ts
  - packages/test-fabric/**
acceptance:
  - IntentDriver is exported from a shared package (test-fabric or ports), not @atlas/seeder
  - packages/seeder still type-checks + tests still pass
  - any third package implementing IntentDriver imports from the canonical home
created: 2026-05-10
updated: 2026-05-10
---

## Why

Architect Phase 3 review of seeder Phase 1.3 flagged this as a soft hexagon concern: `IntentDriver` lives locally in `packages/seeder/src/types.ts:46` because `@atlas/test-fabric` doesn't yet exist as a workspace package. This is shape-compatible with the future test-fabric interface, but it means I1 (single ingress) is trustable only by code review — a third package implementing `IntentDriver` against `submitIntent`-bypassing internals before test-fabric lands could weaken the contract.

## Scope

When `@atlas/test-fabric` exists as a package, lift `IntentDriver` there (or to `@atlas/ports`, depending on the test-fabric design) and make `@atlas/seeder` re-export rather than declare. This is **blocked** on `@atlas/test-fabric` being scoped and created — file that as a precursor capability ticket.

Out of scope: creating `@atlas/test-fabric` itself.

## Resume prompt

```
This ticket cannot start until @atlas/test-fabric exists as a workspace
package. When it does:

1. Read specs/crosscut/seed-corpus.md §4.3 + specs/crosscut/test-fabric.md
   for the canonical IntentDriver shape.
2. Move the IntentDriver interface declaration from
   packages/seeder/src/types.ts:46 to the appropriate file in
   @atlas/test-fabric (or @atlas/ports — judgement call, depends on
   whether IntentDriver is operator-only or a tenant-visible shape).
3. Update packages/seeder/src/types.ts to import IntentDriver from the
   new home; keep the re-export in src/index.ts for back-compat.
4. Grep the repo for any other declarations of IntentDriver-shaped
   interfaces — consolidate them too.
5. Run gates: pnpm safe --filter @atlas/seeder typecheck + test, and
   pnpm safe --filter @atlas/test-fabric typecheck + test.

Update tickets/seeder/intent-driver-lift-to-test-fabric.md log on
completion. Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from architect Phase 3 concern on seeder Phase 1.3. Cannot start work — depends on `@atlas/test-fabric` being a workspace package, which it isn't today. Status `open` (not `scoped`) reflects the unscoped-precursor dependency.
