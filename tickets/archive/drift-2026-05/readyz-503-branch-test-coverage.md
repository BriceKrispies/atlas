---
title: Add test for /readyz 503 branch carrying bootId + startedAt
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
  - test forces the readiness check to fail (registry.hasAction returns false OR controlPlaneSql throws) and asserts the 503 response body still includes bootId + startedAt
created: 2026-05-21
updated: 2026-05-21
---

## Why

Filed by architect at the close of the first §11 retrospective (sdet F3, non-blocking at merge). The `/readyz` 503 branch at apps/server/src/routes/health.ts carries bootId + startedAt but no test exercises it. The I20 probe primarily reads the 200 path, but asymmetric coverage means a future regression on the 503 branch would not be caught — and an operator triaging an unhealthy boot wants the boot identity in the failure response.

## Scope

One test in apps/server/test/routes/health.test.ts that wires withReadyzStubs to return a failing registry (or throwing SQL) and asserts the 503 body still includes bootId === wired.bootId and startedAt === wired.startedAt.toISOString().

## Resume prompt

```text
Add a test to apps/server/test/routes/health.test.ts that forces the /readyz `ready=false` path by stubbing controlPlaneRegistry.hasAction to return false. Assert response status is 503 and the JSON body has `{ status: 'unavailable', bootId, startedAt, checks }` with bootId/startedAt matching the wired AppState values.
```

## Notes / log

- 2026-05-21: filed by architect at first §11 retro gate (sdet F3 carry-over).
