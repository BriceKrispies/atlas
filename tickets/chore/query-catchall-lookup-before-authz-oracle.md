---
title: Query catch-all descriptor-lookup runs before authz — registered-vocabulary oracle
status: open
type: drift-finding
owner: spine-owner
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first]
invariants: [I2]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/routes/queries.ts
  - specs/crosscut/action-driven-routing.md
acceptance:
  - spec decision recorded in action-driven-routing.md §4.5 — EITHER (a) accept the descriptor-lookup-before-authz oracle and name it explicitly + justify (the registered vocabulary is non-secret platform contract), OR (b) re-order the catch-all so authz fires against a synthesized resource BEFORE descriptor lookup
  - if (b) is chosen: queries.ts updated so an unregistered queryId returns the same status (403) as an authz-denied known queryId, eliminating the 404-vs-403 distinguisher
  - test added asserting whichever shape lands
created: 2026-05-21
updated: 2026-05-21
---

## Why

Surfaced by architect (Phase 3 gate, agentId a13d5d93480bf7ef5) on `tickets/archive/atlas-on-atlas/query-catch-all-dispatcher.md`. sdet (agentId a9d443a4a82d9ee1f) flagged the 404 body echoing the queryId as a non-blocking finding; architect agreed and applied the inline body-text fix, but identified the deeper issue: the **descriptor lookup at `routes/queries.ts:99` runs BEFORE the `evaluateRead` authz call at line 136**. Even with the body text fixed, an authenticated principal can distinguish "queryId is registered but I'm denied" (403) from "queryId is not registered" (404). For a public-vocabulary platform this is fine; for private-vocabulary tenant queries (future per-tenant query registries, if scoped) this is an oracle.

Today the queryIds are platform-defined and listed in `specs/LEXICON.md` — non-secret. So the oracle is benign in current scope. But the catch-all is the substrate for future per-tenant queries (Extensibility platform). At that point the 404-vs-403 distinction leaks the existence of a per-tenant query name to a tenant principal that should not see it.

Two ways to fix:

- **(a) Accept and name** — document in `action-driven-routing.md` §4.5 that the catch-all's registered vocabulary is non-secret platform contract. Per-tenant queries (when scoped) MUST go through a different surface OR authz the existence-check itself.
- **(b) Re-order** — authz against a synthesized `Resource { type: 'Query', id: queryId }` BEFORE descriptor lookup. Unknown queryIds get 403 (same as denied), eliminating the distinguisher. Costs one extra policy evaluation per request; benefit is the substrate doesn't leak vocabulary by construction.

## Scope

Spec-keeper picks (a) or (b) and records the decision in `action-driven-routing.md` §4.5. If (b), spine-owner scopes the implementation slice (small — re-order two steps in `dispatchQuery`).

Out of scope: actually implementing per-tenant query registries (that's the Extensibility slice, which would consume this decision).

## Resume prompt

```text
Decide between (a) accept-and-name and (b) re-order at action-driven-routing.md §4.5. Argue for one. If (a), edit §4.5 to document the registered-vocabulary-non-secret carve-out. If (b), scope the implementation slice (re-order descriptor lookup AFTER authz in apps/server/src/routes/queries.ts; unknown queryIds become 403; update tests).
```

## Notes / log

- 2026-05-21: filed by architect during Phase 3 gate on query-catch-all-dispatcher. Inline 404-message fix landed in the same PR; this ticket tracks the deeper ordering question.
