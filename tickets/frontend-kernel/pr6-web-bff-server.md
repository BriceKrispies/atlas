---
title: Stand up apps/web-bff — the always-on edge proxy (serve SPA, forward intents/queries/SSE to ingress)
status: scoped
type: capability
owner: module-dev
phase: 1
adr: specs/decisions/0017-two-kernel-frontend-architecture.md
invariants: [I1, I5]
blocks: [frontend-kernel/pr7-admin-pilot]
blocked_by: [frontend-kernel/pr4-web-kernel-impl]
files_in_scope: [apps/web-bff/src]
acceptance:
  - "apps/web-bff/src imports no @atlas/* except @atlas/web-abi (web-bff-no-domain arch-test green; matrix PASS)"
  - "POST /intents builds the IntentEnvelope (moved wrapIntent) and forwards to {UPSTREAM}/api/v1/intents; GET|POST /q/:ref maps upstream queries; GET /events?tags= pipes upstream SSE"
  - "serves the SPA (generalized from apps/server/src/routes/admin-spa.ts); correlationId threaded onto upstream calls (I5)"
  - "pnpm deps:check 0 errors; pnpm arch:check PASS 0 waivers"
created: 2026-05-25
updated: 2026-05-25
---

## Why

ADR 0017 §2/§4: the BFF is the frontend kernel's server half — an always-on, trusted EDGE between browser and `apps/server`'s ingress. It owns the UI intent+query contract, serves the SPA, and reaches the domain ONLY via the ingress (provably domain-free: ring `bff`, imports only `@atlas/web-abi`). This is what keeps the I1 reinterpretation honest. Contract spec: `specs/frontend/web-bff.md`. Plan PR6.

## Scope

Build the Hono process: `apps/web-bff/src/{main,config,upstream,envelope}.ts` + `routes/{spa,intents,queries,events}.ts`. `envelope.ts` = the canonical `wrapIntent` (moved server-side; web-kernel's direct-mode copy is retired in PR8). `upstream.ts` = trusted ingress client (forward session/bearer; principal resolved upstream; thread correlationId). `spa.ts` generalizes `apps/server/src/routes/admin-spa.ts`. Out of scope: repointing apps to the BFF (PR7), retiring admin-spa.ts (PR8). The package may import `hono`/`@hono/node-server`/a fetch client and `@atlas/web-abi` — nothing else from the workspace.

## Resume prompt

```
PR6 of ADR 0017. Stand up apps/web-bff (Hono, ring bff, frontend stack). Read specs/frontend/web-bff.md + ADR 0017 §2/§4 first. Build src/{main,config,upstream,envelope}.ts + routes/{spa,intents,queries,events}.ts:
- spa.ts: generalize apps/server/src/routes/admin-spa.ts (serveStatic dist/<app> + hash-route fallback + 503-when-unbuilt).
- intents.ts: accept the unwrapped IntentRequest (@atlas/web-abi), build the IntentEnvelope via envelope.ts (the canonical wrapIntent, mirror packages/api-client/src/http/index.ts wrapIntent/deriveSchemaId), forward POST {UPSTREAM}/api/v1/intents.
- queries.ts: GET|POST /q/:ref -> map/aggregate over {UPSTREAM}/api/v1/queries/:id and dedicated reads.
- events.ts: GET /events?tags= -> open upstream SSE and pipe frames through (no buffering).
- upstream.ts: trusted ingress client — forward the user's session/bearer as-is (principal resolved by apps/server, NOT here), thread the request's correlationId onto every upstream call (I5). config.ts reads UPSTREAM_INGRESS_URL + port.
HARD RULE: import no @atlas/* except @atlas/web-abi; only domain door is the upstream URL. Verify: web-bff-no-domain arch-test green, arch:check PASS, deps:check 0 errors, the process boots and proxies a smoke intent+query against a local apps/server. Commit on main + push. Do NOT repoint apps yet (PR7).
```

## Notes / log

- 2026-05-25: created, scoped. Blocked by PR4 (needs the web-kernel transport/contract + the wrapIntent reference to move server-side).
