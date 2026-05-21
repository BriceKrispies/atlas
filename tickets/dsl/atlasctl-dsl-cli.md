---
title: atlasctl dsl <kind> {list,show,save,validate} — CLI parity for DSL routes
status: open
type: capability
owner: spec-keeper
phase: 0
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: [I1]
blocks: []
blocked_by: []
files_in_scope:
  - apps/atlasctl/src/commands/dsl/
  - apps/atlasctl/src/commands/index.ts
  - specs/crosscut/atlasctl.md
acceptance:
  - `pnpm atlasctl dsl list <kind>` calls GET /api/v1/dsl/<kind>; renders a table
  - `pnpm atlasctl dsl show <kind> <apiName> [--version N]` calls GET .../<apiName>[/v/N]; pretty-prints the artifact
  - `pnpm atlasctl dsl validate <kind> <file>` reads `<file>`, POSTs to /api/v1/dsl/<kind>/validate, prints errors with source ranges (highlighted at the right line/col), exits 0/1
  - `pnpm atlasctl dsl save <kind> <apiName> <file>` POSTs Dsl.<Kind>.Update via /api/v1/intents; prints the resulting eventId + version
  - All four commands honour ATLAS_API_URL + the standard atlasctl auth env (per specs/crosscut/atlasctl.md)
  - Updated specs/crosscut/atlasctl.md §"Commands" table
  - pnpm --filter @atlas/atlasctl test, pnpm lint clean
created: 2026-05-21
updated: 2026-05-21
---

## Why

The DSL routes are reachable via curl today (slices #5a/#5b), but the
agentic-first tenet means an operator should be able to drive the same
authoring loop from atlasctl without thinking about envelope shapes.

`atlasctl dsl validate` in particular is the agent-iteration primitive
ADR 0007 §8 promises — agents pipe source through it, parse errors
come back with source ranges, the agent edits and retries. The HTTP
endpoint already returns the right shape; this ticket builds the CLI
that makes it dogfoodable.

## Scope

Add a `dsl` command group to atlasctl with four subcommands. Each is a
thin HTTP wrapper — atlasctl is a controller, not a DSL author itself.

In scope:

- `apps/atlasctl/src/commands/dsl/list.ts`: GET /api/v1/dsl/<kind>; render
  `apiName | version | updatedAt | updatedBy` as a table.
- `apps/atlasctl/src/commands/dsl/show.ts`: GET /api/v1/dsl/<kind>/<apiName>
  (optionally `/v/<n>`). Render `source` syntax-highlighted if `--show-source`
  (default), AST as JSON when `--ast`, sourceMap when `--source-map`.
- `apps/atlasctl/src/commands/dsl/validate.ts`: read file → POST to
  /api/v1/dsl/<kind>/validate → render errors. If errors have sourceRange,
  print the offending line with a `^^^^` underline at the right column.
  Exit 0 on `ok:true`, 1 otherwise.
- `apps/atlasctl/src/commands/dsl/save.ts`: read file → POST to
  /api/v1/intents with a full envelope. Idempotency key derived from
  file content hash + apiName so re-running the same `save` is idempotent.
  Exit 0 on success, 1 on rejection (printing the DSL_* error code).
- Register the group in `apps/atlasctl/src/commands/index.ts`.
- Append the four commands to `specs/crosscut/atlasctl.md`'s command
  table.

Out of scope:

- Tab-completion for `apiName` (Phase B feature per the atlasctl spec).
- `atlasctl dsl run <kind> <apiName> --scope <json>` (evaluation, not
  authoring). Defer; expression DSL has no caller today beyond the
  template + query DSLs that will arrive in their own tickets.
- An interactive REPL. Out of scope for any phase.

## Resume prompt

```
You are the spec-keeper. Scope the `atlasctl dsl` command group.

Read these first:
- specs/crosscut/atlasctl.md (CLI spec — Phase A baseline)
- apps/atlasctl/src/commands/ (existing command structure — health,
  intents validate/submit)
- apps/server/src/routes/dsl.ts (the four HTTP endpoints to wrap)
- modules/dsl/src/queries.ts ValidateDslSourceResult shape (what
  validate prints) and the error shapes from
  modules/dsl/src/errors.ts (codes the CLI surfaces)

Deliverable: append `dsl` subcommands to specs/crosscut/atlasctl.md
covering all four (list/show/validate/save) with the exact request
shape and exit-code contract. Worked example: a developer edits
`./greeting.expr`, runs `pnpm atlasctl dsl validate expression ./greeting.expr`,
sees `DSL_PARSE_ERROR at line 1, col 14`, fixes it, runs
`pnpm atlasctl dsl save expression greeting ./greeting.expr` and gets
`saved version 3 (eventId evt-…)`.

When the spec lands, hand off to module-dev for implementation under
apps/atlasctl/src/commands/dsl/. The HTTP shapes are stable — the work
is CLI ergonomics + error rendering.
```

## Notes / log

- 2026-05-21: created. The HTTP surface this wraps is fully working as
  of `3100026 feat(dsl): close the save path`. Pure CLI ergonomics from
  here on.
