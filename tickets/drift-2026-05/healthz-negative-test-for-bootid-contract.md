---
title: Add /healthz negative test asserting it does NOT carry bootId / startedAt
status: open
type: drift-finding
owner: sdet
phase: 2
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas]
invariants: [I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/test/routes/health.test.ts
acceptance:
  - test asserts GET /healthz body has shape { status: 'ok' } only (no bootId, no startedAt)
  - mechanically locks the "liveness stays terse" contract documented in apps/server/src/routes/health.ts and the §11 retro at tickets/archive/kernel-extraction/bootid-for-i20-probe.md §3
created: 2026-05-21
updated: 2026-05-21
---

## Why

Filed by architect at the close of the first §11 retrospective (sdet F2, non-blocking at merge). The /readyz positive test exists; the /healthz negative test does not, so a future change widening /healthz to include bootId would not break a test. Lock the contract.

## Scope

One test in apps/server/test/routes/health.test.ts asserting GET /healthz returns exactly `{ status: 'ok' }`. No other coverage change.

## Resume prompt

```text
Add a single test to apps/server/test/routes/health.test.ts: GET /healthz returns `{ status: 'ok' }` and the response body has no `bootId` and no `startedAt` keys. Use the same `buildFakeAppState` + Hono harness pattern the existing /readyz tests use.
```

## Notes / log

- 2026-05-21: filed by architect at first §11 retro gate (sdet F2 carry-over).
