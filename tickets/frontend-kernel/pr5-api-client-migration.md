---
title: Migrate @atlas/api-client onto @atlas/web-kernel (slim to re-exports + query/mutate wrappers)
status: scoped
type: refactor
owner: frontend-dev
phase: 1
adr: specs/decisions/0017-two-kernel-frontend-architecture.md
invariants: []
blocks: [frontend-kernel/pr7-admin-pilot]
blocked_by: [frontend-kernel/pr4-web-kernel-impl]
files_in_scope: [packages/api-client/src]
acceptance:
  - "pnpm exec atlas-test packages/api-client and the apps that import it — 0 failures"
  - "every existing `from '@atlas/api-client'` call-site still resolves (no surface rewrites required this PR)"
  - "pnpm deps:check 0 errors; pnpm arch:check PASS 0 waivers (api-client ui-design -> web-kernel is allowed)"
created: 2026-05-25
updated: 2026-05-25
---

## Why

ADR 0017: the reactive `query/mutate/channel` + transport now live in `@atlas/web-kernel`. `@atlas/api-client` (ring `ui-design`) is slimmed to re-export the kernel primitives and rewrite its typed per-domain wrappers (`content-pages.ts`/`authz.ts`/`identity.ts`) as `query()/mutate()` calls — keeping the many `from '@atlas/api-client'` import sites working so the migration stays always-green. Plan PR5.

## Scope

Repoint `api-client`'s `backend.query/mutate/subscribeTags` onto the kernel; re-export kernel primitives; rewrite the domain wrappers. Keep `wrapIntent`/`deriveSchemaId` working (they were ported into web-kernel in PR4; api-client delegates). Out of scope: deleting api-client (PR8), the BFF (PR6), repointing apps (PR7). Add `@atlas/web-kernel` to `packages/api-client/package.json`.

## Resume prompt

```
PR5 of ADR 0017. @atlas/web-kernel (PR4) now owns query/mutate/channel + transport + the ported wrapIntent. Slim @atlas/api-client (packages/api-client/src) to: (a) re-export the kernel's query/mutate/channel; (b) rewrite the typed domain wrappers in content-pages.ts/authz.ts/identity.ts as thin kernel query()/mutate() calls; (c) keep backend.query/mutate/subscribeTags as adapters over the kernel so existing `from '@atlas/api-client'` call-sites compile unchanged. Add @atlas/web-kernel to api-client's package.json deps. Verify: atlas-test for api-client + the apps that import it (0 fail), deps:check 0 errors, arch:check PASS. Commit on main + push. Do NOT delete api-client (PR8) or touch the BFF (PR6).
```

## Notes / log

- 2026-05-25: created, scoped. Blocked by PR4.
