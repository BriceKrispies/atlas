---
title: Pilot — repoint apps/admin through web-bff (browser -> bff -> ingress)
status: scoped
type: refactor
owner: frontend-dev
phase: 1
adr: specs/decisions/0017-two-kernel-frontend-architecture.md
invariants: [I1, I5]
blocks: [frontend-kernel/pr8-rollout-cleanup]
blocked_by: [frontend-kernel/pr5-api-client-migration, frontend-kernel/pr6-web-bff-server]
files_in_scope: [apps/admin/src]
acceptance:
  - "admin loads via the web-bff origin; create/delete (intent->bff->ingress->202), list (query->bff aggregate), and a live SSE update all work"
  - "admin Playwright/BDD suite passes pointed at the web-bff origin"
  - "one correlationId threads browser telemetry -> web-bff log -> apps/server log (I5)"
  - "pnpm deps:check 0 errors; pnpm arch:check PASS 0 waivers"
created: 2026-05-25
updated: 2026-05-25
---

## Why

ADR 0017 / plan PR7: prove the whole two-kernel path end-to-end on one app before rolling out. Admin is the pilot — the smallest real SPA that exercises intents, queries, and SSE.

## Scope

Set the web-kernel transport base to the web-bff origin for `apps/admin`; switch the kernel's mutate to BFF (unwrapped) mode; serve admin via `web-bff/routes/spa.ts` (keep `apps/server/src/routes/admin-spa.ts` as the fallback during cut-over). Update `apps/admin/src/main.ts`'s `AtlasSurface.bindBackend(...)` block to bind the kernel `channel()`. Out of scope: authoring/sandbox (PR8), retiring admin-spa.ts (PR8).

## Resume prompt

```
PR7 of ADR 0017. Repoint apps/admin through apps/web-bff. Point the web-kernel transport base at the web-bff origin for admin; flip mutate() to BFF/unwrapped mode (the BFF now owns wrapIntent); update apps/admin/src/main.ts bindBackend to bind the kernel channel(). Serve admin via web-bff spa.ts; KEEP apps/server admin-spa.ts as fallback. Verify end-to-end: build admin, boot apps/web-bff (UPSTREAM_INGRESS_URL=http://localhost:3000) + apps/server (make db-up first), load admin via the bff origin, exercise a create/delete + a list + a live SSE update; run the admin Playwright/BDD suite against the bff origin; confirm one correlationId threads browser->bff->server. deps:check 0 errors, arch:check PASS. Commit on main + push. Do NOT touch authoring/sandbox or retire admin-spa.ts (PR8).
```

## Notes / log

- 2026-05-25: created, scoped. Blocked by PR5 + PR6.
