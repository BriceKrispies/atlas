---
title: Fix pre-existing `Type 'never' has no call signatures` errors in apps/server test files (vitest → @atlas/test shim aftershock)
status: open
type: chore
owner: port-adapter-dev
phase: 1
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/routes/identity-a7.test.ts
  - apps/server/src/routes/repositories.test.ts
  - packages/test/src/node.ts
acceptance:
  - pnpm safe --filter @atlas/server typecheck green (no `Type 'never' has no call signatures` errors)
  - root cause documented in commit message — the vitest → @atlas/test shim aftershock from commit ffe5f4c
created: 2026-05-21
updated: 2026-05-21
---

## Why

Surfaced by sdet (agentId a9d443a4a82d9ee1f) during Phase 2 review of `query-catch-all-dispatcher`. Not introduced by that slice — these errors exist on `main` already from commit `ffe5f4c` (the vitest → @atlas/test shim migration). Worth a tracked chore because they noise up future typecheck runs and make legitimate new errors harder to spot.

## Scope

Update `packages/test/src/node.ts` (or the equivalent shim) so the test files at `apps/server/src/routes/{identity-a7,repositories}.test.ts` typecheck cleanly. Likely fix: extend the shim's typed export to include the assertion helpers the failing call sites use, OR migrate those test files to the canonical vitest API.

Out of scope: any behavior change in the tests themselves; any change to non-test code.

## Resume prompt

```text
Run pnpm safe --filter @atlas/server typecheck with explicit Bash timeout 180000. Identify the call sites failing with `Type 'never' has no call signatures`. Trace to packages/test/src/node.ts. Either extend the shim's exports or migrate the call sites. Verify pnpm safe --filter @atlas/server test still passes after the fix.
```

## Notes / log

- 2026-05-21: filed by architect during Phase 3 gate on query-catch-all-dispatcher (sdet F-secondary). Pre-existing repo-wide; unrelated to the catch-all slice.
