---
title: Commit untracked deliverables from prior sessions
status: done
type: chore
owner: user
phase: 5
capability:
adr:
vision: []
invariants: []
blocks:
  - seeder/phase-1.3-runner-skeleton
  - seeder/phase-1.4-adapter-seed-memory
  - identity/auth-itest-preflight
  - identity/security-fixes
blocked_by: []
files_in_scope:
  - specs/crosscut/seed-corpus.md
  - specs/crosscut/scenario-fuzzing.md
  - specs/schemas/contracts/seed.scenario.v1.schema.json
  - specs/schemas/contracts/seed.fixture.v1.schema.json
  - specs/schemas/contracts/seed.template.v1.schema.json
  - specs/schemas/contracts/seed.axis_definition.v1.schema.json
  - specs/LEXICON.md
  - ports/CLAUDE.md
  - modules/identity/test/security/crypto-posture.security.test.ts
  - modules/identity/test/security/helpers.ts
  - modules/identity/test/security/saml-verifier.security.test.ts
  - tests/integration/auth/TODO.md
  - tickets/**
  - CLAUDE.md
acceptance:
  - git status reports clean working tree (excluding .claude/settings.local.json)
  - all referenced specs/tests/tickets are reachable from main branch
created: 2026-05-10
updated: 2026-05-10
---

## Why

Three concurrent sessions left deliverables uncommitted in the working tree (seeder Phase 1.1 specs/schemas, identity security test scaffold, auth-itest TODO). Until they land on main, future agents can't trust the repo state and risk re-doing work. Also blocks any downstream ticket whose `acceptance:` references those files.

## Scope

Stage and commit in 4 logical commits. Verify the working tree is clean afterward (excluding `.claude/settings.local.json`, which is harness churn).

Out of scope: any code change, any ticket transition beyond `done` for this ticket itself.

## Resume prompt

```
Stage and commit the work-tree contents in 4 logical commits. Verify the
working tree is clean afterward (excluding .claude/settings.local.json which
is harness churn — do NOT commit that file).

Commit 1 — seeder Phase 1.1 spec deliverables:
  specs/crosscut/seed-corpus.md
  specs/crosscut/scenario-fuzzing.md
  specs/schemas/contracts/seed.scenario.v1.schema.json
  specs/schemas/contracts/seed.fixture.v1.schema.json
  specs/schemas/contracts/seed.template.v1.schema.json
  specs/schemas/contracts/seed.axis_definition.v1.schema.json
  specs/LEXICON.md   (the SeedCorpus section additions)
  ports/CLAUDE.md    (the SeedCorpus catalogue row)
  Message: "feat(seeder): Phase 1.1 spec deliverables (seed-corpus + scenario-fuzzing + 4 schemas)"

Commit 2 — identity security test scaffold:
  modules/identity/test/security/crypto-posture.security.test.ts
  modules/identity/test/security/helpers.ts
  modules/identity/test/security/saml-verifier.security.test.ts
  Message: "test(identity): security-posture RED scaffold for F-CRYPTO + F-SAML findings"

Commit 3 — auth itest TODO:
  tests/integration/auth/TODO.md
  Message: "docs(tests): record auth itest preflight + known issues"

Commit 4 — ticketing layer:
  tickets/**
  CLAUDE.md (root, the new Work Ticketing section)
  TASK.md   (delete — superseded by tickets/)
  Message: "feat(tickets): introduce unit-of-work layer for agentic project management"

Do NOT touch .claude/settings.local.json. Do NOT add unrelated files. Confirm
`git status` shows only .claude/settings.local.json modified when done.

Update tickets/chore/commit-untracked-deliverables.md log on completion.
Set status: done.
Archive:
  mkdir -p tickets/archive/chore
  git mv tickets/chore/commit-untracked-deliverables.md tickets/archive/chore/commit-untracked-deliverables.md
Update tickets/INDEX.md — remove this ticket's line entirely (archived);
note the unblocking of seeder/phase-1.3-runner-skeleton,
seeder/phase-1.4-adapter-seed-memory, identity/auth-itest-preflight,
and identity/security-fixes (their blocked_by entries no longer apply).

Amend Commit 4 to include the archive move + INDEX update so the ticketing
layer commit reflects its own first archival.
```

## Notes / log

- 2026-05-10: created. Captures the 14 untracked / modified files identified in the project state audit at start of session.
- 2026-05-10: done. 4 commits landed on main:
  - `a1401e7` feat(seeder): Phase 1.1 spec deliverables — 8 files, 831 insertions
  - `df14b4f` test(identity): security-posture RED scaffold — 3 files, 652 insertions
  - `b6f0082` docs(tests): auth itest preflight + known issues — 1 file, 153 insertions
  - (this commit) feat(tickets): unit-of-work layer + first archival
  Working tree clean modulo `.claude/settings.local.json` (harness churn) and a pre-existing `D 0` phantom unrelated to this ticket.
  Unblocks: seeder/phase-1.3-runner-skeleton, seeder/phase-1.4-adapter-seed-memory, identity/auth-itest-preflight, identity/security-fixes.
