---
title: atlasctl test scaffold — capability README → failing test stubs
status: open
type: capability
owner: module-dev
phase: 0
capability:
adr:
vision: [agentic-first, spec-first]
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - apps/atlasctl/src/commands/test-scaffold.ts
  - apps/atlasctl/src/lib/spec-parser.ts
  - apps/atlasctl/src/lib/scaffold-emitter.ts
  - specs/crosscut/testing.md
acceptance:
  - "`atlasctl test scaffold specs/domains/<x>/capabilities/<y>/README.md` emits failing test stubs at every canonical path in specs/crosscut/testing.md §3 that the spec implies"
  - "Re-running over existing scaffolds is idempotent (no diff) when the spec is unchanged"
  - "Spec gained an assertion ⇒ scaffold gains a failing test; spec contradicts an existing test ⇒ scaffold flags the diff and refuses to overwrite"
  - "Every emitted scaffold carries an `@spec:` annotation pointing back to the spec section that motivated it"
  - "Property test scaffolds for any invariant the spec touches that's in specs/crosscut/testing.md §2.2 mandatory-property table"
  - "BDD scenario scaffold for every declared surface"
  - "Unit tests for the scaffold emitter itself (it's tooling — same testing bar applies)"
created: 2026-05-21
updated: 2026-05-21
---

## Why

`specs/crosscut/testing.md` §2.1 and §8 specify the contract for a scaffold
generator that translates a capability README into failing test stubs at
canonical paths. The contract exists today; the tooling does not. Until the
tooling lands, Phase 1.0 scaffolds are hand-written, which is slower,
less consistent, and skip-prone. The tooling makes the discipline mechanical.

## Scope

In scope:
- Parser for the capability README's frontmatter + canonical sections
  (declared actions, queries, projections, events, surfaces, invariants).
  Spec template lives at `specs/_capability-template.md` and the worked
  example at `specs/domains/tenancy/capabilities/custom-domains/README.md`.
- Emitter that writes scaffolds at the canonical paths in
  `specs/crosscut/testing.md` §3, each with an `@spec:` annotation and
  `it.todo` or `expect(...).toBe(...)` bodies that fail.
- Idempotency: re-running over existing scaffolds diffs and refuses to
  overwrite changes the implementer has made beyond the scaffold floor.
- `atlasctl test scaffold --check` mode: exits non-zero if scaffolds are
  missing for the named capability (used in CI to verify Phase 1.0
  completeness).

Out of scope:
- Generating *implementation* code. Scaffolds are tests only.
- Spec→test linkage check (`pnpm lint:spec-links`) — that's a separate ticket.
- Per-module retrofit — that's the chore-set.

## Resume prompt

```
You are picking up tickets/testing-floor/scaffold-tooling.md.

Read in order:
1. specs/crosscut/testing.md (the contract this tooling implements; §2.1 and §3
   and §8 are the load-bearing sections)
2. specs/_capability-template.md (the spec shape the parser reads)
3. specs/domains/tenancy/capabilities/custom-domains/README.md (worked example)
4. specs/crosscut/atlasctl.md (existing atlasctl shape for new commands)

Build `atlasctl test scaffold <capability-path>`. The acceptance bar is in the
frontmatter. Test-first per testing.md: write the scaffold-emitter's own test
suite first (parser tests, emitter tests, idempotency tests, diff-and-refuse
tests), then implement.

Stop at Phase 1.1 green and hand off to architect.
```

## Notes / log

- 2026-05-21: created alongside specs/crosscut/testing.md
