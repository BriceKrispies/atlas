---
title: Coverage thresholds + bidirectional spec↔test linkage check
status: open
type: chore
owner: sdet
phase: 0
capability:
adr:
vision: [agentic-first, spec-first]
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - vitest.config.ts (or per-package vitest configs)
  - scripts/lint-spec-links.ts
  - .github/workflows/quality.yml
  - lefthook.yml (pre-commit hooks for it.skip / @spec presence)
  - package.json (pnpm coverage, pnpm lint:spec-links scripts)
acceptance:
  - "pnpm coverage enforces per-package branch-coverage floors per specs/crosscut/testing.md §5.2"
  - "Below-floor packages fail the build with a clear message naming the package and the gap"
  - "Initial thresholds set to each package's current measured floor minus 2% (per testing.md §11 migration posture) — captured into vitest config; thresholds step up via per-retrofit-ticket edits"
  - "pnpm lint:spec-links walks specs/**/*.md for MUST/MUST NOT/SHALL clauses and **/*.test.ts for @spec annotations; fails on either side unreferenced"
  - "Pre-commit hook (lefthook) rejects it.skip / xit / it.todo without `@skip-until tickets/<set>/<slug>` reference"
  - "Pre-commit hook rejects src/ changes without a matching *.test.ts change in the same commit (warn-only initially, hard-fail after one week — captured in this ticket's log on flip)"
  - "CI quality.yml runs pnpm coverage + pnpm lint:spec-links + the existing battery"
  - "Tests for lint-spec-links.ts itself — including a fixture spec with a known MUST clause and a fixture test with a matching @spec annotation, plus negative cases"
created: 2026-05-21
updated: 2026-05-21
---

## Why

`specs/crosscut/testing.md` §5.1 (bidirectional spec↔test linkage), §5.2
(coverage thresholds), and §9 (conformance gates) name the mechanical
checks that make the test-first contract enforceable. Without these gates,
the contract is aspirational. This ticket lands the gates.

## Scope

In scope:
- Per-package branch coverage thresholds enforced in CI via vitest's
  built-in coverage threshold config. Start lenient (current floor - 2%);
  retrofit tickets raise them.
- `scripts/lint-spec-links.ts`: a Node script that walks specs for normative
  clauses (MUST / MUST NOT / SHALL pattern) and tests for `@spec:`
  annotations, asserts both sides covered, produces a readable report on
  mismatch.
- Lefthook pre-commit hook adjustments: reject bare skips, reject src/
  changes without test changes (warn → fail transition logged here).
- Wire into `.github/workflows/quality.yml` alongside the existing
  knip/syncpack/spectral/lychee battery.

Out of scope:
- Raising thresholds to the testing.md §5.2 targets — that's per-module
  retrofit work, owned by the retrofit chore-set.
- Generating @spec annotations — that's manual or scaffold-tooling work.

## Resume prompt

```
You are picking up tickets/testing-floor/coverage-and-linkage-gates.md.

Read in order:
1. specs/crosscut/testing.md §5 (mechanical requirements) and §9 (conformance)
2. .github/workflows/quality.yml (existing CI battery to extend)
3. lefthook.yml (existing pre-commit hooks)
4. package.json scripts (existing lint:* commands for shape reference)
5. vitest.config.ts (existing coverage config)

Land the gates. Test-first per testing.md: write tests for lint-spec-links.ts
first, including fixture specs and fixture tests that exercise both the
"linked" and "unlinked" cases.

For pre-commit src+test enforcement, ship in warn mode initially. Log the
date here when flipping to hard-fail (target: one week after merge to give
the team adjustment time).

Stop at Phase 1.1 green and hand off to architect.
```

## Notes / log

- 2026-05-21: created alongside specs/crosscut/testing.md
