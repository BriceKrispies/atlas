---
title: <kernel touch in one line — name the category, not the change>
status: scoped
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core]
invariants: [I20]
blocks: []
blocked_by: []
files_in_scope:
  - <the kernel-surface file(s) this PR touched>
acceptance:
  - five §11.2 body fields filled
  - extraction-plan ticket exists at the linked path with status >= scoped
  - architect gate verified the retro per §11.3 (retro exists, five fields filled, linked extraction-plan ticket exists)
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## 1. What category of change was this?

<one sentence the next agent can grep for. Name the category, not the specific diff. Bad: "added a field to FooEvent." Good: "added a new field to the event envelope that every consumer must understand at build time." See `always-on.md` §11.2 field 1.>

## 2. What forced it into the kernel?

<cite the structural invariant or coupling. Reference I1-I18 by id and `always-on.md` §2 by row. "Because TypeScript is statically typed and every consumer imports the type" is a valid answer; "because it was easier" is not. See `always-on.md` §11.2 field 2.>

## 3. What's the missing seam?

<name the port, registry, manifest field, or instruction-set entry that would have made this category hot. Use concrete file paths even if they do not exist yet. Bad: "we need a registry somewhere." Good: "`ports/src/event-envelope-registry.ts` with a per-version schema lookup, consumed via `KernelHandle.envelope.get(version)`." See `always-on.md` §11.2 field 3.>

## 4. What's the extraction plan?

<link a scoped follow-up ticket whose `acceptance:` reads literally: "a change of category X lands as data, not as a kernel diff."

Path: `<set>/<slug>` (no `.md`, no `tickets/` prefix)
Status at retrospective time: `scoped` minimum.

A retrospective without a linked extraction-plan ticket fails the architect gate. See `always-on.md` §11.2 field 4.>

## 5. Confidence the category is now closed

Pick one:

- **closed** — the next change of this category will be hot. The linked extraction-plan ticket has a concrete file-by-file plan; merging it removes the category from the kernel.
- **narrow** — this touch is still kernel, but the *next-next* change of this shape will be hot once the extraction-plan ticket merges. Common when the extraction is bigger than the immediate touch.
- **record** — no extraction plan converges yet. The category is recorded so future retrospectives can find it; the loop is honest about not having closed it this round.

Claiming `closed` without an extraction plan that actually closes it fails the next-month `vision-keeper` audit. See `always-on.md` §11.2 field 5.

## Notes / log

- YYYY-MM-DD: filed alongside <kernel-touch PR or commit>.
