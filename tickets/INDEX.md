# Tickets — Status Board

Hand-maintained. Organized by **set** (one section per active set folder). See [`CLAUDE.md`](CLAUDE.md) for the contract.

## atlas-on-atlas/

- [atlasctl-query-parity](atlas-on-atlas/atlasctl-query-parity.md) — capability — open — → spine-owner — MEDIUM (I17 parity follow-up for query-side catch-all; surfaced by query-catch-all-dispatcher PR)
- [stage-3-test-refactor](atlas-on-atlas/stage-3-test-refactor.md) — refactor — scoped — → module-dev — **HIGH** (sdet canary pinned, ADR 0008 §2 on probation)
- [stage-4-kernel-observability-invariant](atlas-on-atlas/stage-4-kernel-observability-invariant.md) — spec — scoped — → spec-keeper — (add I19 Kernel State Machine-Readability + always-on §10 testability amendment)
- [stage-5-kernel-ports](atlas-on-atlas/stage-5-kernel-ports.md) — refactor — scoped — → port-adapter-dev — blocked_by: atlas-on-atlas/stage-4
- [stage-6-kernel-package](atlas-on-atlas/stage-6-kernel-package.md) — capability — scoped — → module-dev — blocked_by: atlas-on-atlas/stage-5
- [stage-7-kernel-migration](atlas-on-atlas/stage-7-kernel-migration.md) — refactor — scoped — → module-dev — blocked_by: atlas-on-atlas/stage-6 — ⚠ NEEDS RE-SCOPE: still plans to collapse query routes that the landed query-side catch-all already owns (see sweep finding)
- [stage-8-manifests-and-drift-probe](atlas-on-atlas/stage-8-manifests-and-drift-probe.md) — refactor — scoped — → module-dev — blocked_by: atlas-on-atlas/stage-6
- [stage-9-operator-surface](atlas-on-atlas/stage-9-operator-surface.md) — capability — scoped — → module-dev — blocked_by: atlas-on-atlas/stage-7, atlas-on-atlas/stage-8
- [control-plane-schema-registry](atlas-on-atlas/control-plane-schema-registry.md) — capability — **Phase-1 BUILT, verify** — → spine-owner — **HIGH** (2026-05-24 recon: `PostgresControlPlaneRegistry` + `registry-refresh.ts` already implement registry-as-data with the O1 snapshot/N+1 design; frontmatter stale. REMAINING: verify idb parity + always-on no-restart test + deps:check, then advance — do NOT re-dispatch as greenfield)

## chore/

- [query-catchall-lookup-before-authz-oracle](chore/query-catchall-lookup-before-authz-oracle.md) — drift-finding — open — → spine-owner — MEDIUM (descriptor lookup runs before authz; registered-vocabulary oracle; spec decision needed at action-driven-routing.md §4.5)
- [server-typecheck-test-file-fixes](chore/server-typecheck-test-file-fixes.md) — chore — open — → port-adapter-dev — LOW (pre-existing `Type 'never'` errors from ffe5f4c vitest shim aftershock)
- [page-document-canonical-sync](chore/page-document-canonical-sync.md) — chore — scoped — → first-party-apps-owner — MEDIUM
- [widget-config-schema-id-sweep](chore/widget-config-schema-id-sweep.md) — chore — scoped — → port-adapter-dev — LOW
- [sync-schemas-coverage-decision](chore/sync-schemas-coverage-decision.md) — spec — open — → spec-keeper — LOW (decision-only)

## seeder/

- [intent-driver-lift-to-test-fabric](seeder/intent-driver-lift-to-test-fabric.md) — refactor — open — → port-adapter-dev (blocked on @atlas/test-fabric existing)

## identity/

- [tenant-admin-invites-user](identity/tenant-admin-invites-user.md) — capability — **BLOCKED** — → frontend-dev — **HIGH** (Phase 1 code complete + 2 §11 retros closed; doctor unblocker landed 2026-05-22; **now blocked_by: tenancy/admin-approve-provisions-tenant-db** — BDD reaches test code but all 3 failures bottleneck on admin-approve not provisioning per-tenant DBs)
- [auth-itest-preflight](identity/auth-itest-preflight.md) — test — scoped — → sdet
- [security-fixes](identity/security-fixes.md) — refactor — open — → spine-owner — blocked_by: identity/auth-itest-preflight

## spec/

- [runtime-reanchor](spec/runtime-reanchor.md) — spec — scoped — → spec-keeper — HIGH (docs-only re-anchor of Atlas around "Atlas Runtime" concept; preserves I1-I18 verbatim)

## tenancy/

- [admin-approve-provisions-tenant-db](tenancy/admin-approve-provisions-tenant-db.md) — capability — **BUILT (unit), verify-BDD** — → spine-owner — **HIGH** (2026-05-24 recon: `provisionAndMigrateTenant` already wired into the approve route + 4/4 unit tests green → acceptance #1–#4 met. REMAINING: live `bdd:server` for #5–#7, then close + unblock tenant-admin-invites-user + admin-approves-signup-bdd. Do NOT dispatch an implementer.)
- [admin-approves-signup-bdd](tenancy/admin-approves-signup-bdd.md) — test — **BLOCKED** — → module-dev — HIGH (5/5 slices landed but scenario fails end-to-end with 503 TENANT_DATABASE_NOT_PROVISIONED; blocked_by: tenancy/admin-approve-provisions-tenant-db)

## load-testing/

- [multi-tenant-seeding](load-testing/multi-tenant-seeding.md) — test — open — → port-adapter-dev — MEDIUM (unlocks multi-tenant scenarios)
- [write-mix-scenarios](load-testing/write-mix-scenarios.md) — test — open — → module-dev — MEDIUM
- [soak-scenario](load-testing/soak-scenario.md) — test — open — → module-dev — LOW
- [remote-load-gen](load-testing/remote-load-gen.md) — test — open — → user — LOW — blocked_by: load-testing/multi-tenant-seeding

## kernel-extraction/

- [admin-spa-serve-static](kernel-extraction/admin-spa-serve-static.md) — drift-finding — scoped — → architect — MEDIUM (§11 retro #4; closes the admin-SPA same-origin category for the BDD path; supersedes predecessor CORS retro)
- [admin-spa-root-shadow](kernel-extraction/admin-spa-root-shadow.md) — drift-finding — scoped — → architect — MEDIUM (§11 retro #5; legacy `GET /` version-JSON handler shadowed the SPA serveStatic catch-all; corrects retro #4's `closed` claim)

## drift-2026-05/

- [healthz-negative-test-for-bootid-contract](drift-2026-05/healthz-negative-test-for-bootid-contract.md) — drift-finding — open — → sdet — LOW (locks /healthz terse contract per first §11 retro F2)
- [readyz-503-branch-test-coverage](drift-2026-05/readyz-503-branch-test-coverage.md) — drift-finding — open — → sdet — LOW (closes asymmetric coverage on /readyz 503 branch per first §11 retro F3)

## drift-always-on-2026-05/

- [db-wipe-reseed-forces-restart](drift-always-on-2026-05/db-wipe-reseed-forces-restart.md) — drift-finding — open — → vision-keeper — **HIGH** (umbrella; acceptance MET by W4: bootId stable across wipe→reseed; closes on merge of G1/G2/G3)
- [pool-reconnect-config](drift-always-on-2026-05/pool-reconnect-config.md) — drift-finding — architect-passed — → port-adapter-dev — HIGH (G1; W1 proven live: container bounce, bootId stable; awaiting merge)
- [tenant-pool-invalidation-hook](drift-always-on-2026-05/tenant-pool-invalidation-hook.md) — drift-finding — architect-passed — → port-adapter-dev — MEDIUM (G2; invalidate/invalidateAll; awaiting merge)
- [out-of-band-migration-runner](drift-always-on-2026-05/out-of-band-migration-runner.md) — drift-finding — architect-passed — → port-adapter-dev — MEDIUM (G3; fork (a) standalone runner; proven in W4: migrate-no-boot; awaiting merge)
- [db-reset-volume-not-dropped](drift-always-on-2026-05/db-reset-volume-not-dropped.md) — drift-finding — open — → port-adapter-dev — MEDIUM (G5: `make db-reset` doesn't drop the volume under podman-compose → silent no-op wipe; found in W4)

## dsl/

- [template-dsl](dsl/template-dsl.md) — capability — open — → spec-keeper — MEDIUM (re-uses expression DSL as embedded primitive; ADR 0007 §10)
- [query-dsl](dsl/query-dsl.md) — capability — open — → spec-keeper — MEDIUM (first effectful-host-op DSL; port: 'EntityStore'; ADR 0007 §10)
- [atlasctl-dsl-cli](dsl/atlasctl-dsl-cli.md) — capability — open — → spec-keeper — LOW (CLI wrappers for the 4 live HTTP endpoints; agentic-first dogfood)
- [bdd-roundtrip](dsl/bdd-roundtrip.md) — test — open — → sdet — MEDIUM (closes slice-workflow Phase 2 gate for the DSL surface)
- [cedar-policy-bdd-witness](dsl/cedar-policy-bdd-witness.md) — test — open — → sdet — LOW (architect followup #1; wire-level authz BDD; blocked_by: dsl/cedar-policy-actions)
- [expression-capability-spec](dsl/expression-capability-spec.md) — spec — open — → spec-keeper — MEDIUM (retro DSL capability README; spec-first gate was bypassed for the whole DSL surface)

## testing-floor/

- [scaffold-tooling](testing-floor/scaffold-tooling.md) — capability — open — → module-dev — HIGH (atlasctl test scaffold; mechanical floor for Phase 1.0 of every slice; specs/crosscut/testing.md §2.1 §8)
- [property-generators](testing-floor/property-generators.md) — test — open — → sdet — HIGH (fast-check properties for I3/I5/I6/I9/I10/I12/I13/I16 in packages/contract-tests; testing.md §2.2 mandatory)
- [coverage-and-linkage-gates](testing-floor/coverage-and-linkage-gates.md) — chore — open — → sdet — HIGH (per-package branch-coverage floors + bidirectional @spec linkage check; testing.md §5 §9)
- [retrofit-chore-set](testing-floor/retrofit-chore-set.md) — refactor — open — → user — MEDIUM (parent ticket; blocked_by all three above; sequenced spine→extensibility→first-party→adapters→frontend per testing.md §11)

---

Done and dropped tickets live in [`archive/`](archive/), preserving the same set structure. They are not listed here.
