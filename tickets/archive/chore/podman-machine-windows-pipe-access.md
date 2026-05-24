---
title: podman machine named-pipe not accessible on Windows — blocks `make db-up` and therefore `pnpm bdd:server`
status: done
type: chore
owner: user
phase: 0
capability:
adr:
vision: []
invariants: []
blocks: [identity/tenant-admin-invites-user]
blocked_by: []
files_in_scope:
  - Makefile
  - infra/compose/compose.control-plane.yml
acceptance:
  - `make db-up` from a clean shell on Windows reliably brings Postgres up on :15433
  - `pnpm safe bdd:server` reaches the apps/server boot step (no `open //./pipe/podman-machine-default: The system cannot find the file specified.` error)
  - Root cause documented in the log — podman machine state restoration, PATH precedence (docker-compose.exe vs podman compose), or compose-engine selection
created: 2026-05-21
updated: 2026-05-21
---

## Why

Surfaced 2026-05-21 during module-dev's attempt to run `pnpm bdd:server` end-to-end as the load-bearing acceptance check on `tickets/identity/tenant-admin-invites-user.md` (the first I20 zero-restart demonstration slice, capability code already complete). The Makefile correctly defaults to `podman compose` (`Makefile:14, COMPOSE_CMD ?= $(CONTAINER_RUNTIME) compose`, `CONTAINER_RUNTIME ?= podman`) — so the Docker memory invariant (per `feedback_podman.md`: ONLY USE PODMAN, never Docker) is honored at the Makefile layer.

The runtime failure:

```
[WebServer] unable to get image 'postgres:16-alpine': error during connect:
  Get "http://%2F%2F.%2Fpipe%2Fpodman-machine-default/v1.48/images/postgres:16-alpine/json":
  open //./pipe/podman-machine-default: The system cannot find the file specified.
[WebServer] Error: executing C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe \
  -f compose.control-plane.yml up -d: exit status 1
make: *** [Makefile:119: db-up] Error 1
```

`podman` is on PATH (`/c/ProgramData/chocolatey/bin/podman`). The named pipe `//./pipe/podman-machine-default` is the expected interface to the podman VM on Windows. Two things diverge from happy-path:

1. **The pipe is unreachable.** Either the podman machine is stopped, or the pipe lease was lost on a host reboot, or the machine's `--rootful` setting changed (rootful and rootless machines expose different pipes).
2. **`docker-compose.exe` (Docker Desktop's binary) is on PATH at `/c/Program Files/Docker/Docker/resources/bin/docker-compose`.** When `podman compose` delegates on Windows, it can pick up a docker-compose binary in PATH and proxy through it, which is why the error trace shows Docker's bin even though the Makefile asked for podman.

## Scope

User-side investigation + fix. NOT an agent task — local environment recovery.

Recommended first attempts (in order, cheapest first):

1. **Check podman machine state:** `podman machine list` — if "Currently running" is false, `podman machine start`. If it claims running but the pipe is missing, `podman machine stop && podman machine start` to recreate.
2. **If 1 doesn't fix it:** verify `podman version` works; if the CLI itself can talk to the machine, the issue is in the `compose` delegation path. Try forcing the standalone tool via `make COMPOSE_CMD=podman-compose db-up` (would need `pip install podman-compose` if not present). The Makefile already documents this override at line 12.
3. **If neither works:** consider whether Docker Desktop's `docker-compose.exe` should be removed from PATH on this machine, or whether the Makefile should explicitly point at `podman.exe compose` to avoid the PATH-delegation footgun.

Out of scope:

- Any Makefile changes that would silently fall back to Docker (would violate `feedback_podman.md`).
- Replacing podman with Docker — explicitly forbidden.
- Anything code-related in the Atlas tree — this is local environment only.

## Resume prompt

```text
This is a user-side environment fix, not an agent task. Run `podman machine list`; if stopped, `podman machine start`. If running, `podman machine stop && podman machine start`. Then `make db-up` from the repo root should bring Postgres up clean. Once that works, `pnpm safe bdd:server` from the repo root should run the tenant-admin-invites-user BDD scenario end-to-end. Mark this ticket done and unblock identity/tenant-admin-invites-user.
```

## Notes / log

- 2026-05-21: filed by main at the user's request after module-dev's attempt to run the BDD acceptance test on `identity/tenant-admin-invites-user` failed at the Postgres webServer step. module-dev correctly did NOT retry in a loop per the unblock brief — clean failure with diagnostic. Slice code (5 surfaces, serveStatic route, step bindings, BDD config, two §11 retros archived) is complete and architecturally sound; only the local infra blocks the executable witness. User picked option 3 ("file an infra ticket and pause the slice") over alternatives (fix locally + re-run; code review without live BDD).
- 2026-05-21: **root cause identified — different than initially diagnosed.** User asked for "absolute minimal thing through scripting; an atlas doctor command actually, this can be one of the slices of that." Shipped `tickets/doctor/podman-machine-windows.md` capability slice: new `atlasctl doctor` subcommand with two registered checks (`podman-machine` + `podman-compose-provider`). Running it against the live state revealed: **the podman machine + named pipe are healthy** (this ticket's original diagnosis was wrong — the pipe IS reachable for direct `podman info` calls); the actual blocker is `podman compose` auto-delegating to Docker Desktop's `docker-compose.exe` (the "external compose provider" Podman 4+ picks up from PATH). The Docker binary then can't reach the podman pipe because it uses its own connection path. Doctor's second check reports this clearly with the fix: `pip install podman-compose`. Makefile updated (`COMPOSE_CMD` now auto-detects standalone `podman-compose` and prefers it when present). **Recovery path:** (1) user runs `pip install podman-compose` (or `pipx install podman-compose`), (2) re-runs `atlasctl doctor` to confirm green, (3) `make db-up` then succeeds (auto-detect picks up podman-compose), (4) `pnpm bdd:server` can finally run end-to-end. Ticket title says "named-pipe access" but the real category is "compose-provider delegation" — leaving the title for git-history continuity, retitle on close if desired.
- 2026-05-22: **status: open → done.** Recovery path executed end-to-end on the live env:
  1. `uv tool install podman-compose` (user chose uv over pip per session preference) — installed podman-compose 1.5.0 to `~/.local/bin/`.
  2. `atlasctl doctor` ran via `node --experimental-transform-types apps/atlasctl/src/main.ts doctor` — both checks `ok`.
  3. `make db-up` succeeded — Postgres container healthy on :15433.
  4. `pnpm safe bdd:server` reached test code — the BDD harness executes end-to-end. Three test failures remain, but **all three trace to a separate platform-tenancy gap** (tenant `acme` not provisioned because admin-approve endpoint doesn't call `PostgresTenantDbProvider.provisionTenantDatabase`) — NOT this ticket's scope. Filed as `tickets/tenancy/admin-approve-provisions-tenant-db.md` for the platform follow-up. Archiving with that link.
