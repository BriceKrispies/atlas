# Tickets — Status Board

Hand-maintained. Organized by **set** (one section per active set folder). See [`CLAUDE.md`](CLAUDE.md) for the contract.

## atlas-on-atlas/

- [stage-3-test-refactor](atlas-on-atlas/stage-3-test-refactor.md) — refactor — scoped — → module-dev — **HIGH** (sdet canary pinned, ADR 0008 §2 on probation)

## chore/

- [handler-userid-propagation-sweep](chore/handler-userid-propagation-sweep.md) — chore — scoped — → module-dev — MEDIUM
- [page-document-canonical-sync](chore/page-document-canonical-sync.md) — chore — scoped — → first-party-apps-owner — MEDIUM
- [widget-config-schema-id-sweep](chore/widget-config-schema-id-sweep.md) — chore — scoped — → port-adapter-dev — LOW
- [sync-schemas-coverage-decision](chore/sync-schemas-coverage-decision.md) — spec — open — → spec-keeper — LOW (decision-only)

## seeder/

- [intent-driver-lift-to-test-fabric](seeder/intent-driver-lift-to-test-fabric.md) — refactor — open — → port-adapter-dev (blocked on @atlas/test-fabric existing)

## identity/

- [auth-itest-preflight](identity/auth-itest-preflight.md) — test — scoped — → sdet
- [security-fixes](identity/security-fixes.md) — refactor — open — → spine-owner — blocked_by: identity/auth-itest-preflight

## spec/

- [runtime-reanchor](spec/runtime-reanchor.md) — spec — scoped — → spec-keeper — HIGH (docs-only re-anchor of Atlas around "Atlas Runtime" concept; preserves I1-I18 verbatim)

## tenancy/

- [admin-approves-signup-bdd](tenancy/admin-approves-signup-bdd.md) — test — review — → architect — HIGH (5/5 slices landed; pending invariant gate + live `pnpm bdd:server` run)

## db-per-tenant-followups/

- [wrapped-tenant-errors-unmapped](db-per-tenant-followups/wrapped-tenant-errors-unmapped.md) — drift-finding — open — → module-dev — LOW (sdet finding: bare instanceof in mapError misses Error.cause wrappers for both tenant-error branches)
- [provisioner-out-of-band-state-coverage](db-per-tenant-followups/provisioner-out-of-band-state-coverage.md) — test — open — → sdet — LOW (architect coverage note: no test for DROP DATABASE-without-DROP ROLE or vice versa)

## load-testing/

- [multi-tenant-seeding](load-testing/multi-tenant-seeding.md) — test — open — → port-adapter-dev — MEDIUM (unlocks multi-tenant scenarios)
- [write-mix-scenarios](load-testing/write-mix-scenarios.md) — test — open — → module-dev — MEDIUM
- [soak-scenario](load-testing/soak-scenario.md) — test — open — → module-dev — LOW
- [remote-load-gen](load-testing/remote-load-gen.md) — test — open — → user — LOW — blocked_by: load-testing/multi-tenant-seeding

---

Done and dropped tickets live in [`archive/`](archive/), preserving the same set structure. They are not listed here.
