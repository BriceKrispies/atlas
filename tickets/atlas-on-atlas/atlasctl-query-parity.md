---
title: atlasctl query list / atlasctl query run — I17 parity for the query-side catch-all
status: open
type: capability
owner: spine-owner
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first, atlas-on-atlas]
invariants: [I17]
blocks: []
blocked_by: []
files_in_scope:
  - apps/atlasctl/src/commands/query.ts
  - specs/crosscut/atlasctl.md
  - specs/crosscut/action-driven-routing.md
acceptance:
  - atlasctl query list — enumerates every registered queryId (from /api/v1/queries/_list or similar introspection endpoint)
  - atlasctl query run <queryId> [--param key=value]* — invokes a query via the catch-all and prints the JSON response
  - I17 parity check (test or manual verification): every queryId in `/api/v1/queries/_list` is reachable via `atlasctl query run`
  - specs/crosscut/atlasctl.md updated with the new commands; specs/crosscut/action-driven-routing.md §5 updated to remove the "deferred to follow-up ticket" pointer and link this ticket as the home
created: 2026-05-21
updated: 2026-05-21
---

## Why

spine-owner Phase 0 design (`specs/crosscut/query-catch-all-design.md` decision #9) deferred `atlasctl query` parity to a follow-up ticket — mirroring the intent-side's separate `atlasctl intent send` slice. Named explicitly in `action-driven-routing.md` §5 as the follow-up path. This ticket is that follow-up.

I17 (API / CLI / UI parity) requires that every action reachable from one surface be reachable from every other. The query-side catch-all ships HTTP today; CLI parity is missing.

## Scope

- New `apps/atlasctl/src/commands/query.ts` with `list` and `run` subcommands.
- `atlasctl query list` — calls `/api/v1/queries/_list` (or whatever introspection endpoint the substrate exposes; may need to be added if not already there) and prints a table.
- `atlasctl query run <queryId> [--param key=value]*` — calls `GET /api/v1/queries/:queryId?key=value&...` (or POST with JSON body for complex args; pick one and document).
- Spec updates per acceptance bar.

Out of scope:
- Per-tenant query introspection — wait for per-tenant queries to be scoped.
- Streaming / pagination of query results — defer to a future slice if needed.
- atlasctl auth changes — uses the same auth path as `atlasctl intent send`.

## Resume prompt

```text
Implement atlasctl query list / atlasctl query run per scope. Mirror the shape of the existing atlasctl intent send commands. Verify I17 parity: every queryId returned by `atlasctl query list` is invokable via `atlasctl query run`. Update specs/crosscut/atlasctl.md and specs/crosscut/action-driven-routing.md §5.
```

## Notes / log

- 2026-05-21: filed by architect during Phase 3 gate on query-catch-all-dispatcher. Named as a follow-up in action-driven-routing.md §5 by spec-keeper; architect's gate filed the actual ticket.
