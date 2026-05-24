---
title: Property-based invariant generators in packages/contract-tests
status: open
type: test
owner: sdet
phase: 0
capability:
adr:
vision: [agentic-first]
invariants: [I3, I5, I6, I9, I10, I12, I13, I16]
blocks: []
blocked_by: []
files_in_scope:
  - packages/contract-tests/src/properties/i3-idempotency.ts
  - packages/contract-tests/src/properties/i5-correlation.ts
  - packages/contract-tests/src/properties/i6-causation.ts
  - packages/contract-tests/src/properties/i9-cache-tenant-scope.ts
  - packages/contract-tests/src/properties/i10-cache-invalidation.ts
  - packages/contract-tests/src/properties/i12-projection-rebuild.ts
  - packages/contract-tests/src/properties/i13-quota-before-dispatch.ts
  - packages/contract-tests/src/properties/i16-schema-scope.ts
  - packages/contract-tests/src/properties/index.ts
acceptance:
  - "One property file per invariant in specs/crosscut/testing.md §2.2 mandatory table"
  - "Each file exports a `runProperty(adapters)` function that fast-check evaluates"
  - "Each property runs ≥ 200 cases per CI run; nightly runs raise to ≥ 5000"
  - "Each property fails on a deliberately broken adapter (test the test: a stub adapter that violates the invariant MUST cause the property to fail and shrink to a minimal counterexample)"
  - "Counterexamples extracted on failure become regression fixtures at specs/fixtures/<kind>__invalid__<name>.json"
  - "Existing port-contract suites import the matching property where applicable (EventStore imports I3 + I6 + I12; Cache imports I9 + I10; PolicyEngine imports nothing — Cedar evaluation isn't universally quantified in the way these are)"
  - "pnpm test runs property tests; nightly pnpm test:property-soak runs the high-budget version"
created: 2026-05-21
updated: 2026-05-21
---

## Why

`specs/crosscut/testing.md` §2.2 names the eight universally-quantified
invariants that MUST have fast-check property coverage. Today only
example-based tests exist; the property layer is the spec, this is the
implementation. Property tests find branches the spec author didn't think
of — the agentic-first audience benefits because the generator catches what
the spec didn't enumerate.

## Scope

In scope:
- Property generators + properties for I3, I5, I6, I9, I10, I12, I13, I16.
  Each lives in its own file with a clear property statement, a generator
  strategy, and a shrinking-friendly assertion.
- Adapter parameterization — properties take an `adapters` object so the
  same property runs against `adapter-node` and `adapter-idb` (and any
  future adapter).
- Self-test: each property file includes a "broken adapter" smoke test
  that verifies the property actually catches the violation. A property
  that passes against a deliberately broken adapter is itself broken.
- Wiring into existing port-contract suites where they overlap.

Out of scope:
- Per-module property tests (those go in `modules/<x>/src/<concept>.properties.test.ts`
  per testing.md §3; they're a per-capability concern).
- Non-universally-quantified invariants (I1, I2, I4, I7, I8, I11, I14,
  I15, I17, I18) — these are structural or surface-level and tested by
  other means.

## Resume prompt

```
You are picking up tickets/testing-floor/property-generators.md.

Read in order:
1. specs/crosscut/testing.md §2.2 (the mandatory property table) and §6.3
   (property test contract)
2. specs/architecture.md §I3, §I5, §I6, §I9, §I10, §I12, §I13, §I16 (the
   canonical invariant definitions)
3. packages/contract-tests/src/event-store.ts (an existing port contract
   suite — match this shape)
4. https://fast-check.dev/docs/ (if unfamiliar; arbitraries and shrinking
   are the load-bearing concepts)

Implement one property file per invariant. Test-first per testing.md:
write the broken-adapter smoke test for each property BEFORE the property
itself — the smoke test must fail until the property is implemented,
then pass when the property correctly catches the violation.

Stop at Phase 1.1 green and hand off to architect.
```

## Notes / log

- 2026-05-21: created alongside specs/crosscut/testing.md
