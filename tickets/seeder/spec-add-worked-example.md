---
title: Add a multi-step + fixture + axisBindings worked-example scenario to seed-corpus spec
status: scoped
type: spec
owner: spec-keeper
phase: 0
capability: specs/crosscut/seed-corpus.md
adr:
vision: [agentic-first]
invariants: []
blocks:
  - seeder/phase-1.5-contract-tests
blocked_by: []
files_in_scope:
  - specs/crosscut/seed-corpus.md
acceptance:
  - specs/crosscut/seed-corpus.md contains a worked-example scenario that exercises multi-step + fixture-ref + axisBindings shape
  - the example validates against seed.scenario.v1.schema.json via AJV
  - the example is referenced from the §4 (or wherever appropriate) discussion
created: 2026-05-10
updated: 2026-05-10
---

## Why

Both the Phase 1.4 implementer and sdet Phase 2 review flagged that `specs/crosscut/seed-corpus.md` references a "worked-example scenario" but doesn't actually contain one — the spec ends at §9 cross-references. The Phase 1.4 agent improvised a minimal one inline in the smoke test, but it's single-step with no fixture refs and no axisBindings — doesn't pin the full contract shape.

Phase 1.5 (contract test suite) needs a richer example to assert against. Without it, the contract suite is flying blind on shape coverage.

## Scope

Add a worked-example scenario to `specs/crosscut/seed-corpus.md` that exercises the full contract surface:

- Multiple `ScenarioStep` entries (≥2)
- At least one step that references a fixture via `apply:`
- `axisBindings` showing materialised-scenario semantics
- A meaningful narrative (not just synthetic). The example should read like something a tenant author would actually write — e.g. "seed a single-tenant deployment with a basic user and one organisation."

The example must validate against `seed.scenario.v1.schema.json` (verify by running AJV against it).

Out of scope: any code changes; any other spec rewrites; the snapshot-vs-stream clarification (separate ticket).

## Resume prompt

```
Add a worked-example scenario to specs/crosscut/seed-corpus.md.

Read first:
- specs/crosscut/seed-corpus.md (full spec)
- specs/crosscut/scenario-fuzzing.md (for axis semantics)
- specs/schemas/contracts/seed.scenario.v1.schema.json (the schema the
  example must satisfy)
- specs/schemas/contracts/seed.fixture.v1.schema.json (for the fixture
  ref shape)
- adapters/seed-memory/test/contract.test.ts (the Phase 1.4 agent's
  minimal inline example — your worked example replaces it as the
  reference)

Add a new section to specs/crosscut/seed-corpus.md (after §4 or §5,
wherever fits) titled "Worked example" or similar. Include:

- One Scenario document (YAML or JSON, your call — the spec is
  storage-format-agnostic; pick whichever is more readable)
- ≥2 ScenarioSteps, at least one with `apply: <fixture-id>`
- An axisBindings block showing materialised-scenario semantics
- One referenced Fixture document inline (or a pointer to a fixtures/
  layout)
- 1-2 sentences of narrative framing — what scenario is this seeding?
  What would the runner do? (e.g., "Seeds a tenant with one
  organisation and a basic admin user, applying the
  `tenants/single-basic` fixture before the user-creation step.")

Constraints:
- The Scenario MUST validate against seed.scenario.v1.schema.json.
- The Fixture MUST validate against seed.fixture.v1.schema.json.
- Use IntentEnvelope shapes that look real — refer to existing intents
  in specs/lifecycle.md or modules/identity/ for ideas (e.g.
  signup.complete, organization.create).
- Verify validation before declaring done: run AJV against the example
  using packages/schemas. If you can't run AJV from a spec-keeper
  context, paste the JSON of the example into a small ad-hoc node
  script with the loader.
- Don't expand the spec's §4.1 wording about snapshot-vs-stream
  (separate ticket: seeder/spec-streaming-vs-snapshot-clarify).

Done bar:
- specs/crosscut/seed-corpus.md has a new Worked example section
- AJV validation passes against seed.scenario.v1 and seed.fixture.v1
- The worked example is referenced from at least one earlier section
  so readers find it

Update tickets/seeder/spec-add-worked-example.md log on completion.
Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from sdet + architect concerns on seeder Phase 1.4. Blocks Phase 1.5 contract tests (which need a richer example to assert shape coverage).
