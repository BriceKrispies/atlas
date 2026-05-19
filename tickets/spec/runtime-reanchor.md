---
title: Re-anchor Atlas docs around the "Atlas Runtime" concept (docs-only)
status: scoped
type: spec
owner: spec-keeper
phase: 0
capability:
adr:
vision: [agentic-first, atlas-on-atlas, tiny-core]
invariants: [I1, I2, I3, I4, I5, I6, I7, I8, I9, I10, I11, I12, I13, I14, I15, I16, I17, I18]
blocks: []
blocked_by: []
files_in_scope:
  - specs/crosscut/atlas-runtime.md
  - specs/crosscut/runtime-instruction-set.md
  - specs/crosscut/kernel-vs-data.md
  - specs/vision.md
  - specs/CLAUDE.md
  - CLAUDE.md
acceptance:
  - pnpm lint:markdown passes (0 errors in the six in-scope files)
  - pnpm lint:links passes (every cross-ref in the three new docs resolves)
  - Each of the three new docs has an "Invariants preserved" section listing I1-I18 verbatim with cross-refs to architecture.md
  - "tenant code never runs in apps/server" appears verbatim in BOTH atlas-runtime.md AND kernel-vs-data.md
  - "kernel code remains small, trusted, and restart-required" (or equivalent verbatim) appears in BOTH atlas-runtime.md AND kernel-vs-data.md
  - "unsafe or hot-path behavior can be extracted behind ports/adapters" (or equivalent verbatim) appears in BOTH atlas-runtime.md AND kernel-vs-data.md
  - git status shows ONLY the six files above changed (zero TypeScript / package.json / lockfile churn)
  - pnpm typecheck and pnpm lint stay green (sanity that the doc-only scope didn't accidentally touch code)
created: 2026-05-19
updated: 2026-05-19
---

## Why

Today's spec set frames Atlas as a "multi-tenant platform fabric." That captures *what* every tenant gets but under-names *what kind of system Atlas actually is*. Reading `specs/vision.md`, `specs/architecture.md`, `specs/decisions/0008-atlas-on-atlas.md`, and `specs/crosscut/always-on.md` side-by-side, the picture is consistent: Atlas is a governed application runtime — an application VM. Tenants submit programs (intents + schemas + policies + workflows + functions + surfaces + deployments + storage declarations) and the runtime executes those programs through a tiny trusted kernel that enforces I1–I18 on every step.

The `submit-intent` pipeline at `packages/ingress/src/submit-intent.ts` is structurally the **fetch-decode-execute loop** of a VM. `crosscut/always-on.md` already names the kernel/data split. ADR 0008 commits to the recursive-kernel principle. Lexicon v2 already carries the program-shaped vocabulary. What's missing is the explicit identity statement that ties these together so future capability scopes can ask "is this an instruction or is this data?" with a clear answer.

This ticket adds three new spec docs (atlas-runtime.md, runtime-instruction-set.md, kernel-vs-data.md), one minimal vision.md edit, and two routing-table updates in CLAUDE.md files. No code changes; no folder moves; no package renames. All existing invariants are preserved verbatim.

## Scope

In scope:

- Six file edits per `files_in_scope` above, executed as Slices 1–6 from the approved plan at `.claude/plans/im-wanting-to-test-sunny-locket.md` (second plan in the file).
- Spec-keeper agent dispatches for the three new doc slices (1, 2, 3). Slices 4–6 are trivial edits done inline.
- Verification via `pnpm lint:markdown`, `pnpm lint:links`, the four grep acceptance gates, and `git status` checking for code-side churn.

Out of scope (deliberately):

- Any TypeScript / package.json / lockfile changes. This is documentation-only.
- Refresh of `SYSTEM_MAP.md` (stale CMS framing, "tenancy is a column," "TS rewrite TBD" for atlasctl). Separate ticket once the runtime docs land.
- Adding `Instruction` / `Runtime` entries to `LEXICON.md`. Defer; the new docs cite existing lexicon entries.
- Creating the to-be-built ports (`FunctionRuntime`, `QuotaService`, Compute provisioning ports). The instruction set names them honestly as "to-be-created (ADR ref)" anchors.
- Any change to the I1–I18 invariant definitions themselves. The new docs reproduce them as one-liners with cross-refs; the canonical definitions stay in `specs/architecture.md`.

## Resume prompt

```
Execute Slices 1-7 of the runtime-reanchor plan at .claude/plans/im-wanting-to-test-sunny-locket.md (second plan in the file). Acceptance bar is in this ticket's frontmatter. Dispatch spec-keeper for Slices 1, 2, 3 (the three new docs); do Slices 4-6 inline (vision.md paragraph + two CLAUDE.md routing updates). Verify per Slice 7. Update this ticket's status and log on every state transition.
```

## Notes / log

- 2026-05-19: created (status=scoped). User approved plan at .claude/plans/im-wanting-to-test-sunny-locket.md (second plan in the file).
