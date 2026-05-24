---
title: Re-point I5/I6/I13/I16 (+I9) property generators from synthetic seams to production ports/ingress
status: open
type: drift-finding
owner: sdet
phase: 0
adr:
vision: [agentic-first]
invariants: [I5, I6, I9, I13, I16]
blocks: []
blocked_by: []
files_in_scope:
  - packages/contract-tests/src/properties/i5-correlation.ts
  - packages/contract-tests/src/properties/i6-causation.ts
  - packages/contract-tests/src/properties/i9-cache-tenant-scope.ts
  - packages/contract-tests/src/properties/i13-quota-before-dispatch.ts
  - packages/contract-tests/src/properties/i16-schema-scope.ts
acceptance:
  - "I5/I6 properties drive the real submitIntent ingress path (not the property's own stamping seam), so a layer rewriting correlationId between route and EventStore is caught; the log + audit legs of the I5 shape (testing.md §2.2) are witnessed"
  - "I13 attaches to the real Quota port contract suite once a Quota port exists"
  - "I16 attaches to the real SchemaMutation port contract suite once that port exists"
  - "I9 property runs against the production platform-core cache-key builder, not its own tenantScopedKey"
created: 2026-05-24
updated: 2026-05-24
---

## Why

Architect PASS-WITH-FOLLOWUPS on `testing-floor/property-generators` (2026-05-24). Those properties faithfully witness their invariants **at the seam each is located at**, but four use synthetic stand-ins the property itself supplies, because the real production seam isn't contract-testable yet:

- **I5/I6** use `stampCorrelationVerbatim` / `linkCausationByParentId`, not the real `submitIntent`/middleware path → a layer that rewrites correlationId between route and EventStore is invisible, and the audit/log legs of the I5 shape (`testing.md` §2.2) are unwitnessed.
- **I13/I16** model reference functions (`quotaCheckedSubmit`, `scopedMutateSchema`) because no Quota / SchemaMutation port exists.
- **I9** uses its own `tenantScopedKey`, not the production `platform-core` cache-key builder.

The architect's firm directive: these MUST NOT be cited as complete I5/I6/I13/I16 coverage until re-pointed. This ticket tracks that re-point.

## Scope

Re-point each property at the production seam as it becomes contract-testable. **I9 is doable now** (the `platform-core` cache-key builder exists today). **I5/I6** wait for a contract-testable `submitIntent` seam. **I13/I16** wait for the Quota / SchemaMutation port-definition tickets — at which point these property bodies become those ports' contract suites (the intended trajectory; the bodies stay, only the `adapters` shape re-points).

## Notes / log

- 2026-05-24: filed from the property-generators architect gate (followups a + b + the I9 production-builder note).
