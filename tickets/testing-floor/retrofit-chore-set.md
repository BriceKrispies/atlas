---
title: Per-module retrofit chore-set — bring every module to the testing floor
status: open
type: refactor
owner: user
phase: 0
capability:
adr:
vision: [agentic-first, spec-first]
invariants: []
blocks: []
blocked_by:
  - testing-floor/scaffold-tooling
  - testing-floor/property-generators
  - testing-floor/coverage-and-linkage-gates
files_in_scope: []
acceptance:
  - "One sub-ticket per existing module, sequenced spine-first → extensibility → first-party → adapters → frontend per specs/crosscut/testing.md §11"
  - "Each sub-ticket has its own resume prompt, files_in_scope, and acceptance bar"
  - "Each sub-ticket raises that module's coverage threshold to the specs/crosscut/testing.md §5.2 floor as its definition of done"
  - "Each sub-ticket adds @spec annotations to all existing tests in its module"
  - "Each sub-ticket adds property tests for any §2.2 mandatory invariant the module touches"
  - "Each sub-ticket adds BDD coverage for any surface the module exposes that lacks it"
  - "Parked CMS code (apps/cms/ once moved) is exempt per testing.md §11"
created: 2026-05-21
updated: 2026-05-21
---

## Why

`specs/crosscut/testing.md` §11 names the migration posture: existing
modules predate the contract and need to be brought up incrementally.
This ticket is the parent — its child sub-tickets are the per-module
slices. Filing the parent now makes the backlog visible; sub-tickets get
scoped one at a time as bandwidth allows.

This ticket is BLOCKED until the scaffold tooling, property generators,
and gates land — without them, retrofit work is hand-rolled and inconsistent.

## Scope

This ticket is a **parent** — its body is the sequencing plan, not the
work itself. Each sub-ticket is its own slice with its own dispatch.

Retrofit order per testing.md §11:

1. **Spine** (spine-owner / module-dev)
   - `modules/identity/`
   - `modules/authorization/`
   - `modules/tenancy/` (if present as a module; some tenancy logic lives in `packages/ingress`)
2. **Extensibility** (extensibility-owner / module-dev)
   - `modules/custom-schema/` (when first capability lands)
   - `modules/functions/` (when first capability lands)
   - `modules/dsl/` (recently shipped — high retrofit value)
3. **First-party / parked** (first-party-apps-owner / module-dev)
   - `modules/catalog/`
   - `modules/content-pages/`
   - (parked CMS code exempt per testing.md §11)
4. **Code platform** (code-owner / module-dev)
   - `modules/repository/`
5. **Adapters** (port-adapter-dev)
   - `adapters/node/`
   - `adapters/idb/`
   - `adapters/policy-cedar/`
   - `adapters/policy-stub/`
6. **Frontend** (frontend-dev)
   - `packages/widgets/`
   - `packages/design/`
   - `packages/core/`

Each sub-ticket follows the pattern: read the module's current test
coverage report → identify gaps against testing.md §5.2 floor → write
failing tests at canonical paths → make them pass → raise the package's
threshold to the §5.2 floor → architect gate.

## Resume prompt

This is a parent ticket. To dispatch the first sub-slice, scope a child
ticket at `tickets/testing-floor/retrofit-<module>.md` with that module's
specific gap analysis and acceptance bar, then dispatch the appropriate
implementer agent against that child.

Suggested first sub-ticket: `retrofit-identity` (Spine first per §11
sequencing; identity is the highest-value retrofit because it touches
authn and every other module's tests reference its fixtures).

## Notes / log

- 2026-05-21: created as parent for the retrofit work; blocked on tooling tickets
