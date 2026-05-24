---
title: G1 — postgres.js pools must survive a Postgres container bounce without an Atlas restart
status: review
type: drift-finding
owner: port-adapter-dev
phase: 1
capability: specs/domains/runtime/capabilities/pool-resilience/README.md
adr: specs/crosscut/always-on.md
vision: [atlas-on-atlas]
invariants: [I20]
blocks: []
blocked_by:
  - drift-always-on-2026-05/db-wipe-reseed-forces-restart
files_in_scope:
  - apps/server/src/bootstrap.ts
  - adapters/node/src/tenant-db-provider.ts
acceptance:
  - "After the Postgres container is bounced (make db-down && make db-up, or db-reset), a still-running apps/server serves the next request successfully without a process restart — bootId from /readyz unchanged."
  - "Both the control-plane pool (bootstrap.ts:264) and per-tenant pools (openPostgresFromInfo) carry explicit resilience config; an integration test bounces the container and asserts recovery."
  - "pnpm test green; architect invariant gate pass (I20; no pipeline-order change)."
created: 2026-05-23
updated: 2026-05-23
---


## Why

The control-plane and per-tenant `postgres()` pools are created with no reconnect/backoff options. When the Postgres container restarts (the `make db-reset` wipe), every pooled connection in a live Atlas errors on next use and does not recover — forcing a process restart, contradicting always-on §1. See parent `drift-always-on-2026-05/db-wipe-reseed-forces-restart`.

## Scope

**In:** add reconnection/backoff resilience to both pool constructors so a DB bounce self-heals. **First confirm postgres.js's actual reconnect semantics empirically** (it reconnects per-query for transient drops by default; the real gap may be config + a regression test rather than new reconnection code — do NOT over-build). **Out:** zero-bounce in-place reseed; the other two gaps.

## Resume prompt

```
Slice: make CP + per-tenant postgres.js pools survive a Postgres container bounce
without an apps/server restart (always-on §1, I20). Files: apps/server/src/bootstrap.ts:264
(CP pool), adapters/node/src/tenant-db-provider.ts:224-242 (openPostgresFromInfo).
FIRST empirically test current postgres.js behavior under `make db-down && make db-up`
with a running server — it may already reconnect per-query; if so the work is explicit
resilience config + a regression test. Phase 0 spec, user checkpoint, failing scaffold
(bounce-the-container integration test asserting stable bootId), impl, architect gate.
```

## Notes / log

- 2026-05-23: filed. Child of db-wipe-reseed-forces-restart.
- 2026-05-23: scoped (spec-keeper, Phase 0). Capability README written at `specs/domains/runtime/capabilities/pool-resilience/README.md` under the `runtime` platform-substrate domain. Spec leads with an empirical-first directive (measure postgres.js's existing per-query reconnect before writing any reconnection code), names I20 as load-bearing and I1/I2/I3/I12 as unaffected-confirm, scopes G2/G3/zero-bounce-reseed out, and pins acceptance to a `/readyz` bootId-stable bounce integration test. Shared-file edits (LEXICON.md, always-on.md §1 ledger) flagged as Spec-PR TODOs inside the README for orchestrator application; INDEX.md untouched per dispatch. status → scoped. Awaiting user spec-approval checkpoint before Phase 1.0.
- 2026-05-23: implemented (port-adapter-dev, Phase 1) combined with G2 (tenant-pool-invalidation-hook) since both share `tenant-db-provider.ts`. **EMPIRICAL PROBE RESULT (postgres.js 3.4.9):** the driver ALREADY recovers per-query after a real container bounce (`podman restart`, connection-drop-equivalent to `make db-down && make db-up`). Same pool object: first post-bounce query errored `CONNECTION_CLOSED`, the next few hit `57P03` ("database system is starting up" / "not yet accepting connections"), then `SELECT 1` succeeded on ~attempt 7 (~12s wall — dominated by Postgres restart+startup, NOT driver latency). Same behaviour with default `{max:5}` and with tuned options. **Therefore, per the spec's empirical-first branch: deliverable is EXPLICIT documented resilience config at both pool sites + a regression test — NO bespoke retry loop.** Added `POSTGRES_RESILIENCE_OPTIONS` (`connect_timeout:30, idle_timeout:20, max_lifetime:1800`) in `adapters/node/src/tenant-db-provider.ts`, exported from the adapter index, applied at `apps/server/src/bootstrap.ts:264` (CP pool, `max:5` unchanged) and in `openPostgresFromInfo` (per-tenant; config-object form + `onnotice` swallow preserved). Each site carries an inline comment citing this capability + I20 + always-on §1. Regression test `apps/server/test/always-on/pool-resilience.itest.ts` (HAS_DB-gated): constructs the CP pool with the shared options, drives the REAL `healthRoutes` `/readyz` via Hono `.fetch`, captures bootId → real `podman restart` bounce → asserts the FIRST post-bounce probe observed a severed connection (non-vacuous guard) → polls to recovery → asserts SAME bootId + `checks.control_plane_db==='ok'`; a second case bounces a per-tenant pool from `openPostgresFromInfo`. RED first (missing `POSTGRES_RESILIENCE_OPTIONS` export), then GREEN (2/2). I1/I2/I3/I12 confirmed unaffected — no pipeline/dispatch/route file touched. Scoped typecheck (`tsgo --noEmit`) clean for `bootstrap.ts`, `tenant-db-provider.ts`, `index.ts`, and the test (repo-wide typecheck is environmentally broken via the `@atlas/test` shim — pre-existing). status → review.
- 2026-05-23: independent verification re-run against the live shared container (port 15433). **GREEN:** `apps/server/test/always-on/pool-resilience.itest.ts` 2/2 pass via real `podman restart` bounce — CP-pool case (~14.6s) and per-tenant-pool case (~14.2s); the non-vacuous guard fired (first post-bounce `/readyz` observed `control_plane_db` not ok), proving the bounce actually severed the pool and recovery is witnessed, not vacuous; recovered `bootId` equals the pre-bounce `bootId` (I20 stable-process witness). Container left healthy/up after the run. **RED re-confirmed** by removing the `POSTGRES_RESILIENCE_OPTIONS` re-export from `adapters/node/src/index.ts`: the test module fails to load (`does not provide an export named 'POSTGRES_RESILIENCE_OPTIONS'`) — the exact RED reason recorded above — then restored to GREEN. Scoped typecheck: `src/bootstrap.ts` and `src/tenant-db-provider.ts`/`src/index.ts` produce zero errors; the itest's only diagnostics are the repo-wide `@atlas/test` shim `TS2349` noise. Port interface unchanged (`TenantDbProvider` = `getPool` only; nothing in `ports/`). Pipeline untouched (no `submit-intent`/`state.ts`/`tenant-loop`/dispatch file in the diff). status stays `review`.
