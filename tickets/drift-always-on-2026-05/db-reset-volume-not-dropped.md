---
title: G5 — `make db-reset` does not actually wipe (compose down -v leaves the volume under podman-compose)
status: open
type: drift-finding
owner: port-adapter-dev
phase: 0
capability:
adr: specs/crosscut/always-on.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - Makefile
  - infra/compose/compose.control-plane.yml
acceptance:
  - "`make db-reset` results in an EMPTY control_plane (0 tenants, 0 intent_schemas) and zero atlas_t_* databases — i.e. the volume `compose_postgres_data` is actually removed."
  - "A check confirms the data is gone after db-reset (not just the container recreated)."
created: 2026-05-23
updated: 2026-05-23
---

## Why

Discovered during the W4 wipe→reseed→verify cycle (2026-05-23). `make db-reset` runs `$(COMPOSE_CMD) -f compose.control-plane.yml down -v` then `db-up`. Under **podman-compose**, `down -v` recreated the container but **did NOT remove the named volume `compose_postgres_data`** — the control plane still had all 11 tenant rows, 19 intent_schemas, and every `atlas_t_*` database after a "reset." `make db-reset` silently no-ops the wipe.

Evidence: after `make db-reset`, `SELECT count(*) FROM control_plane.tenants` returned 11 (expected 0); `db-migrate` enumerated 6 existing tenants as "already current." A true wipe required `make db-down` + `podman volume rm compose_postgres_data` + `make db-up` (which then correctly showed 0 tenants / 0 schemas / 0 `atlas_t_*` DBs).

This is a dev-tooling correctness bug: an operator who runs `make db-reset` expecting a clean slate gets stale data, which can mask bugs and produce confusing test state. It also blocks the documented "clean out the db" step of the snapshot/reseed workflow without a manual volume removal.

## Scope

**In:** make `make db-reset` actually drop the volume under the project's `COMPOSE_CMD` (podman-compose). Options: an explicit `podman volume rm` of `compose_postgres_data` in the `db-reset` recipe (most reliable), or switch the down invocation to one that prunes the named volume under podman-compose, or pin the volume name and remove it directly. Add a post-reset assertion (the data is gone).

**Out:** the G1/G2/G3 always-on fixes (separate tickets); broader compose-provider rework.

## Resume prompt

```
Fix `make db-reset` so it actually wipes (compose down -v leaves the named volume
`compose_postgres_data` under podman-compose). Repo evidence: Makefile db-reset
recipe + infra/compose/compose.control-plane.yml volume `postgres_data` →
podman volume `compose_postgres_data`. Make the recipe explicitly remove the
volume (e.g. `podman volume rm -f compose_postgres_data` after down, before up),
and add a check that control_plane has 0 tenants post-reset. Verify with a real
run (podman, not docker).
```

## Notes / log

- 2026-05-23: filed from the W4 cycle. Sibling of the G1/G2/G3 always-on fixes (same set). The W4 cycle worked around it with an explicit `podman volume rm compose_postgres_data`.
