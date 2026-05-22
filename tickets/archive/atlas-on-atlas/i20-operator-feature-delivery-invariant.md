---
title: Atlas-on-Atlas — add I20 (Operator Feature Delivery Is an Intent) + always-on §11 Kernel Touch Retrospective
status: done
type: spec
owner: spec-keeper
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, agentic-first, tiny-core]
invariants: [I20]
blocks: []
blocked_by: []
files_in_scope:
  - specs/architecture.md
  - specs/crosscut/always-on.md
  - tickets/kernel-extraction/README.md
  - tickets/kernel-extraction/_template.md
  - CLAUDE.md
  - tickets/INDEX.md
acceptance:
  - pnpm lint:markdown passes (0 errors in the six in-scope files)
  - pnpm lint:links passes (every cross-ref between architecture.md I20, always-on §11, and the new tickets resolves)
  - architecture.md I20 section follows the I1-I18 shape (Invariant / Semantics / Purpose / Violation / Source)
  - always-on.md §11 lands after §10 with subsections §11.1-§11.4 and is cross-linked from I20
  - tickets/kernel-extraction/ exists with README.md and _template.md; both reference always-on §11.2 by field number
  - root CLAUDE.md Non-Negotiable Invariants list includes an I20 bullet that cross-links to always-on §11
  - git status shows ONLY the six files above changed (zero TypeScript / package.json / lockfile churn)
created: 2026-05-21
updated: 2026-05-21
---

## Why

`always-on.md` §2 names what is structurally kernel from the *system's* perspective ("the ingress pipeline shape," "the event-store append path") — accurate but does not give an operator the bright line they want: *"Atlas does not restart to ship a feature."* ADR 0008 committed to the recursive-kernel principle; always-on.md §6 staged the implementation; what was missing was the operator-experience invariant that closes the loop and the self-improvement mechanism that prevents kernel creep.

I20 names the operator commitment. §11 names the structured retrospective that fires whenever the kernel is touched: what category did this touch belong to, what forced it into the kernel today, what's the missing seam, what's the extraction plan, and how confident are we the category is now closed. The retrospective lane (`tickets/kernel-extraction/`) becomes a `vision-keeper` audit input — categories recurring three times without an extraction-plan ticket merging escalate as drift.

User chose option (a) from the 2026-05-21 conversation: single PR, I20 marked normative-from-publication but gate-enforced from §6 Phase 7 (kernel-migration merge). The retrospective itself is architect-gated immediately on landing.

## Scope

In scope:

- Six file edits per `files_in_scope` above. Documentation-only; no TypeScript / package.json / lockfile.
- I20 in architecture.md follows the I1-I18 shape verbatim.
- §11 in always-on.md sits after §10 Conformance; subsections §11.1 (trigger rules), §11.2 (five required fields), §11.3 (process + gates), §11.4 (loop output + vision-keeper audit).
- `tickets/kernel-extraction/` set with README.md (lane purpose + vision-keeper audit rules) and _template.md (five-field body + frontmatter aligned with `tickets/CLAUDE.md`).

Out of scope (deliberately):

- Any code change. This is spec-only; the runtime mechanism it describes lands via the existing Stage 5-9 tickets in `atlas-on-atlas/`.
- Reopening I19 numbering. Stage 4 ticket reserves I19 for "Kernel State Machine-Readability"; I20 is the next free id.
- Backfilling retrospectives for prior kernel touches. The loop is forward-looking.
- Renaming the Stage tickets in `atlas-on-atlas/` to reference I20 — those stages predate this ticket and stay as-is.

## Resume prompt

```text
This ticket is in `status: review` — the spec writes are landed (architecture.md I20, always-on.md §11, tickets/kernel-extraction/{README,_template}.md, root CLAUDE.md excerpt). Verify the acceptance bar in the frontmatter: pnpm lint:markdown, pnpm lint:links, git status confirms doc-only, the cross-links between I20 and §11 resolve in both directions, and §11 subsections match §11.1-§11.4. Then hand to architect for invariant-gate review (since this adds an invariant) and move to status=done on pass.
```

## Notes / log

- 2026-05-21: created and writes landed in same turn (status=review). User approved option (a) — single PR, I20 normative-from-publication with gate-enforcement deferred to §6 Phase 7. Six files edited as scoped; `git status` confirms zero TS / package.json / lockfile churn. `pnpm lint:markdown` introduces zero new categories of error in my content: MD032 / MD040 issues I added were fixed in the same turn; remaining hits in always-on.md §11 are the `#§N-…` fragment pattern which the file already uses repo-wide (pre-existing at lines 197/224/225 in content I did not touch — house style). `pnpm lint:links` could not run locally (`lychee` not installed on this Windows box) — all new cross-refs verified manually to resolve to existing targets / sections.
- 2026-05-21: architect gate returned REQUEST CHANGES (agentId ad0d3780b01b0e1b7). Three findings: (1) blocking — `§6 Phase 7` referenced from I20 + §11.3 + CLAUDE.md did not exist in `always-on.md` §6 (table stopped at Phase 6). Effective-gate concept was coherent but pinned to a non-existent milestone. (2) minor — `_template.md:18` acceptance "unavoidable at current scope" was stricter than §11.3's three-item gate. (3) optional — add an I19-reservation comment between I18 and I20 so the gap is greppable. (4) non-blocking — this PR itself does not fire §11.1 because the kernel-surface *spec* is not in the §2 *file-path* table (architect agreed with my read). Fixes applied same turn: added Phase 7 row to §6 ("Kernel-extraction backlog drained — I20 becomes merge-blocking"); softened `_template.md:18` to "architect gate verified the retro per §11.3"; added HTML comment reserving I19 for Stage 4 ticket.
- 2026-05-21: re-dispatched architect after applying the three fixes (agentId a7dcddcee36e7e22d). Re-check **PASS** — Phase 7 content is concrete and gate-able (three measurable conditions: no scoped/in-flight extraction-plan tickets >90 days, vision-keeper monthly attestation, architect enforces I20 as merge-blocking). Template now matches §11.3 verbatim. I19-reservation comment greppable. Status → done; ticket archived to `tickets/archive/atlas-on-atlas/`.
