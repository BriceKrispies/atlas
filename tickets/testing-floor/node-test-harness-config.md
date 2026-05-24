---
title: Node adapter test harness uses prepare:false + Postgres property-parity leg is HAS_DB-gated
status: open
type: drift-finding
owner: port-adapter-dev
phase: 0
adr:
vision: []
invariants: [I3]
blocks: []
blocked_by: []
files_in_scope:
  - adapters/node/test/_setup.ts
  - .github/workflows/quality.yml
acceptance:
  - "adapters/node test harness connects with prepare:true (matching the production EventStore binding) OR documents why prepare:false is required, per CLAUDE.md 'Tests match production configuration'"
  - "the Postgres leg of the wired contract properties (I3/I6/I12 on EventStore, I9/I10 on Cache) runs in CI — a DB-backed job sets TEST_TENANT_DB_URL so node parity isn't silent-skipped"
created: 2026-05-24
updated: 2026-05-24
---

## Why

Two architect findings on `testing-floor/property-generators` (2026-05-24), both **pre-existing** (not introduced by that ticket):

1. `adapters/node/test/_setup.ts:33` uses `prepare: false`. CLAUDE.md "Tests match production configuration" names this exact anti-pattern — the production EventStore I3 dedup runs prepared (`ON CONFLICT`), so the node I3 property witness executes in a *different binding mode* than production, weakening it.
2. The 5 wired contract properties run against Postgres only when `HAS_DB` (`TEST_TENANT_DB_URL` set); the default CI path is IDB-only. So "both adapters run the wired properties" is conditional — CI must run the DB-backed leg, or Postgres parity is theoretical.

## Scope

Decide on `prepare: true` (or document why `prepare: false` is necessary), and ensure a DB-backed CI job exercises the node contract suites so the Postgres parity leg actually runs.

## Notes / log

- 2026-05-24: filed from the property-generators architect gate (config-divergence + conditional-parity findings).
