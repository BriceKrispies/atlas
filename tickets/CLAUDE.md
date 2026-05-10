# Atlas Tickets — the unit-of-work layer

Tickets are slice instances. One ticket per discrete unit of work an agent (or pair of agents) can pick up cold and drive through the [Slice Workflow](../CLAUDE.md#slice-workflow) to merge. They are agent-readable and agent-writable.

Tickets sit between specs (the *what*, durable) and chat (the *how-it's-going*, ephemeral). Specs say "this capability should exist"; a ticket says "this slice of building it is in-flight, the agent is `module-dev`, the acceptance bar is X, here's the resume prompt."

## When to create a ticket

- Any slice that will dispatch one or more agents — capability work, refactor, test work, drift fix, ADR.
- `vision-keeper` / `observability-architect` / `sdet` findings that aren't being acted on this turn → file a `drift-finding` ticket so the backlog is visible.
- Pure question-answering, exploration, or one-shot edits that take less than a single agent dispatch → no ticket needed.

## File layout

- `tickets/CLAUDE.md` — this file (the contract).
- `tickets/INDEX.md` — board of all active tickets, organized by set, hand-maintained.
- `tickets/_template.md` — copy-paste starting point.
- `tickets/<set>/<slug>.md` — one file per ticket. **Every ticket lives in a set folder.**
- `tickets/archive/<set>/<slug>.md` — archived tickets preserve their set structure.

A **set** is a stream of related work — typically one capability, one multi-stage refactor, one drift-audit run, or the catch-all `chore/`. Sets are folders, created when a new stream starts. There is no global counter and no central registry; sets emerge from the work. If nothing else fits, file under `chore/` (hygiene, one-offs) or create a `misc/` set — but always pick a set, never put a ticket at the top level of `tickets/`.

Within a set, slugs are semantically meaningful and naturally ordered (`phase-1.3-runner-skeleton` precedes `phase-1.4-...` lexically and in the work itself). **Slugs are stable** — once a ticket exists and is referenced by other tickets, don't rename the file. Edit the title in the body if it needs to evolve.

References to other tickets use paths relative to `tickets/`, no extension: `blocked_by: [chore/commit-untracked-deliverables]`. Path-based refs are unambiguous and survive archival (a `tickets/**` grep matches both active and archived tickets).

## Frontmatter shape

```yaml
---
title: <one line>                # required
status: scoped                   # required — see lifecycle below
type: capability                 # required — capability | refactor | test | spec | adr | drift-finding | chore
owner: module-dev                # required — agent type, platform-owner name, or `user`
phase: 1                         # which slice phase (0..5) — see ../CLAUDE.md
capability:                      # path to capability spec (or omit for non-capability tickets)
adr:                             # path to ADR if the work is driven by one
vision: []                       # vision tenets this satisfies (optional)
invariants: []                   # invariants touched (optional, e.g. [I1, I12])
blocks: []                       # ticket paths that can't start until this lands (e.g., seeder/phase-1.4-adapter-seed-memory)
blocked_by: []                   # ticket paths that must land first (e.g., chore/commit-untracked-deliverables)
files_in_scope: []               # disjoint scopes for parallel slices
acceptance: []                   # mechanically-checkable definition of done
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

There is no `id:` field — the file path *is* the id. Refer to a ticket as `<set>/<slug>` (no `tickets/` prefix, no `.md` extension).

## Body sections (in order)

1. **Why** — one paragraph linking back to vision / ADR / capability / drift finding. Why this exists, not what it does.
2. **Scope** — what the agent does, and explicitly what's out of scope.
3. **Resume prompt** — the literal prompt to hand the agent. Self-contained; agent should not need to re-read this whole file or previous chat to act.
4. **Notes / log** — append-only, dated entries. Agents add an entry on every state transition.

## Lifecycle

```
open  →  scoped  →  in-flight  →  review  →  architect  →  done ──→ archive/
  │        │          ↓             ↑                                   ▲
  │        │       blocked        (back to in-flight on rejection)      │
  │        │       parked                                                │
  └────────┴──────────┴───────────────→  dropped  ────────────────────→ ┘
```

Any non-terminal status can transition to `dropped` (opened but won't be done). Both terminal states (`done`, `dropped`) move the ticket file to `tickets/archive/` as the final step of the transition — see [Archival](#archival) below.

| Status | Meaning | Who can transition |
|---|---|---|
| `open` | Captured, not yet scoped (drift findings, fuzzy ideas) | anyone |
| `scoped` | Has capability/ADR ref + acceptance bar + resume prompt | `spec-keeper` or platform-owner |
| `in-flight` | An implementer is working it | implementer (`module-dev` / `port-adapter-dev` / `frontend-dev`) |
| `review` | Implementation complete; sdet adversarial review pending | implementer hands off; `sdet` picks up |
| `architect` | sdet passed; architect invariant gate pending | `sdet` hands off; `architect` picks up |
| `done` | Architect passed; merged. **Archives.** | `architect` or user |
| `blocked` | Cannot progress — log why. Stays in active board. | anyone, with reason |
| `parked` | Deliberately deferred — log why and when to revisit. Stays in active board. | user only |
| `dropped` | Opened but won't be done — log why. **Archives.** | user only |

A ticket cannot move to `in-flight` without `capability:` or `adr:` set (anti-slop principle 1, mechanical version). A ticket cannot move to `done` without all `acceptance:` checks passing.

## Archival

When a ticket transitions to `done` or `dropped`, the agent making the transition does this *as the final step* (atomic with the status change):

1. **Move the file:** `mkdir -p tickets/archive/<set>` (if needed), then `git mv tickets/<set>/<slug>.md tickets/archive/<set>/<slug>.md`. Archive preserves the set structure — `tickets/archive/seeder/` mirrors `tickets/seeder/`.
2. **Remove the line from `tickets/INDEX.md`** entirely — `INDEX.md` has no Done section. The archive directory listing is its own board.
3. **Append the dated log entry** recording the transition (and the reason, if `dropped`).

Only `done` and `dropped` archive. `blocked` and `parked` stay in the active `tickets/` directory — they're still actionable backlog and need to be visible at the top of the board.

### Cross-ticket references survive archival

When agents look up `blocked_by` / `blocks` references, they grep `tickets/**` recursively — that includes `archive/`. Path-based refs (e.g., `seeder/phase-1.3-runner-skeleton`) match against the slug regardless of whether the ticket is currently in `tickets/<set>/` or `tickets/archive/<set>/`. **Don't reuse slugs from archived tickets within the same set** — pick a fresh slug for new work even if the prior one is conceptually similar.

## How dispatchers pick up work

1. Read `tickets/INDEX.md`. Pick a `scoped` ticket with no unresolved `blocked_by`.
2. Read its file in full.
3. Hand the **Resume prompt** verbatim to the chosen agent. The ticket id goes in the dispatch description.
4. On agent return, append a dated log entry and update frontmatter `status` + `updated`.
5. Move the ticket's INDEX line to the new section.

## How agents work a ticket

- First action: read the ticket file. Frontmatter is the work order; body is the brief.
- On any state transition: append a dated line to **Notes / log** + update frontmatter `status` + `updated`. On a transition to `done` or `dropped`, also `git mv` the file into `tickets/archive/` — see [Archival](#archival).
- Stay in your lane on frontmatter. Implementers don't change `acceptance:` (that's the spec-keeper's call). sdet doesn't add new `files_in_scope`. Etc.
- Don't paste session transcripts into the log — keep entries short, oriented to state changes and concrete decisions.

## How drift findings become tickets

`vision-keeper`, `observability-architect`, and `sdet` produce findings keyed to spec clauses. When they run:

- Each finding NOT being fixed in the same turn becomes a ticket: `type: drift-finding`, `status: open`, body cites the clause violated and the file:line evidence.
- All findings from one audit run go into a dated set folder (e.g., `tickets/drift-vision-2026-05/`). One file per finding, slug names the finding (`cms-leak-in-modules.md`).
- The audit-running agent appends the new ticket paths to its summary so the user can see the backlog grew.

This makes adversarial reviews into a closed feedback loop instead of chat that scrolls away.

## INDEX.md

Hand-maintained for now. Organized by **set** (one section per active set folder), with one line per ticket showing status, owner, and `blocked_by`. When a ticket archives (`done` or `dropped`), remove its line entirely — `INDEX.md` has no Done section, and the archive directory is its own listing. When generated tooling lands, this file becomes the rendered output of `tickets/<set>/*.md` frontmatter (excluding `archive/`).

## What tickets are NOT

- **Not specs.** The capability spec under `specs/domains/<domain>/capabilities/<name>/` is durable; the ticket is the slice that builds (some of) it. Specs outlive tickets.
- **Not chat.** Don't paste session transcripts. Log entries are dated, terse, oriented to state changes.
- **Not roadmap.** Long-horizon directional bets go in ADRs (`specs/decisions/`). Tickets are what's currently dispatchable.
- **Not a substitute for `pnpm typecheck` / `pnpm test` / `pnpm bdd`.** `acceptance:` references those checks; it never replaces them.
