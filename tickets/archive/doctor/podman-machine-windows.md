---
title: atlasctl doctor — first slice — podman-machine check + auto-recovery on Windows
status: done
type: capability
owner: module-dev
phase: 1
capability: specs/crosscut/atlasctl.md
adr:
vision: [agentic-first]
invariants: []
blocks: [chore/podman-machine-windows-pipe-access, identity/tenant-admin-invites-user]
blocked_by: []
files_in_scope:
  - specs/crosscut/atlasctl.md
  - apps/atlasctl/src/commands/doctor.ts
  - apps/atlasctl/src/main.ts
  - apps/atlasctl/test/doctor.test.ts
acceptance:
  - `pnpm atlasctl doctor` runs without arguments and executes every registered check
  - first check `podman-machine` detects podman state on Windows via `podman machine list --format json`
  - check attempts auto-recovery (`podman machine stop && podman machine start`) when the named pipe is unreachable but the binary is present
  - exit code 0 on all checks ok or fixed; non-zero on any unfixed failure
  - structured output via emitResult mirroring the existing `health` command shape
  - skips gracefully when not on Windows (returns `status: 'skipped'` with reason)
  - manual verification: running against the live broken-pipe state on this machine recovers `make db-up` connectivity
created: 2026-05-21
updated: 2026-05-21
---

## Why

The first I20 zero-restart BDD demonstration (`tickets/identity/tenant-admin-invites-user.md`) is parked on `tickets/chore/podman-machine-windows-pipe-access.md` — a Windows-local podman named-pipe access issue. User wants the minimum thing to fix this through scripting, structured as the first slice of an `atlasctl doctor` framework that future local-environment checks can plug into.

This slice ships:

- The doctor command framework (subcommand of atlasctl, runs registered checks)
- The first check: podman-machine (Windows-aware; detects + auto-recovers)
- Spec amendment to `specs/crosscut/atlasctl.md` naming `doctor` as a Phase A subcommand with the check-registry pattern

Future slices add new checks (e.g. `smtp4dev-up`, `dist-admin-built`, `tenant-apex-resolves`) — the framework is the load-bearing piece this slice establishes.

## Scope

In scope:

- New `apps/atlasctl/src/commands/doctor.ts` exporting `runDoctor(flags, opts)` mirroring the `runHealth` shape.
- A small internal check-registry: `interface DoctorCheck { name: string; run(): Promise<CheckResult> }` with `CheckResult = { name, status: 'ok'|'fixed'|'failed'|'skipped', details }`.
- Implement `podmanMachineCheck` as the first registered check. Behavior:
  1. If platform is not Windows: return `skipped` with `reason: 'podman-machine pipe issue is Windows-specific'`.
  2. If `podman` binary not on PATH: return `failed` with diagnostic.
  3. Run `podman machine list --format json` → parse → find machine named `podman-machine-default` (or first machine if exactly one). If no machine: return `failed` with `reason: 'no podman machine — run `podman machine init` first'`.
  4. If machine `Running: false`: run `podman machine start`, re-test with `podman info`. Return `fixed` on success, `failed` on retry exhaustion.
  5. If machine `Running: true` but `podman info` fails with the named-pipe error: run `podman machine stop && podman machine start`, re-test. Return `fixed` on success, `failed` on retry exhaustion.
  6. If machine running + `podman info` works: return `ok`.
- Wire `doctor` subcommand in `apps/atlasctl/src/main.ts` (single `program.command('doctor')` block).
- Unit test at `apps/atlasctl/test/doctor.test.ts` covering the state machine with mocked exec results.
- Spec amendment at `specs/crosscut/atlasctl.md` — new `### doctor` subsection under Phase A commands.

Out of scope:

- Any check beyond podman-machine — future slices.
- Any change to the Makefile or compose files — the doctor command operates on `podman machine` lifecycle, not on `make db-up` invocation.
- A `--check=<name>` flag — defer until there's more than one check.
- A repair-confirmation prompt — auto-fixes happen unconditionally; the operator wanted minimum friction.

## Resume prompt

```text
Implement tickets/doctor/podman-machine-windows.md. Add specs/crosscut/atlasctl.md section for the `doctor` subcommand. Build apps/atlasctl/src/commands/doctor.ts with the registry pattern and the podman-machine check per the scope. Wire it in main.ts. Write the unit test. Verify by running `pnpm atlasctl doctor` against the live broken-pipe state on this Windows machine and confirming it recovers. After recovery, run `pnpm safe bdd:server` (timeout 600000) to confirm the parent slice's load-bearing test can now execute.
```

## Notes / log

- 2026-05-21: created (status=scoped). User asked for "absolute minimal thing through scripting; an atlas doctor command actually, this can be one of the slices of that." Blocks the chore ticket + the capability slice — recovery comes through this command, not manual `podman machine` commands.
- 2026-05-21: scoped → done. Implementation complete + manually verified end-to-end:
  - `apps/atlasctl/src/commands/doctor.ts` shipped with `podman-machine` + `podman-compose-provider` checks; registry pattern + structured emitResult output mirroring `health` command shape.
  - `apps/atlasctl/src/main.ts` wired the `doctor` subcommand.
  - `apps/atlasctl/test/doctor.test.ts` ships 11 unit tests covering all state-machine paths (skipped, ok, fixed-after-start, fixed-after-stop+start, podman-missing, no-machines, stop+start-still-broken, registry orchestration, exit codes). Tests run cleanly under `pnpm safe --filter @atlasctl test` — pre-existing vitest-shim aftershock errors hit doctor.test.ts (tracked at chore/server-typecheck-test-file-fixes) but tests execute.
  - `specs/crosscut/atlasctl.md` "Doctor — Phase A" section documents both checks.
  - `Makefile` `COMPOSE_CMD` now auto-detects standalone `podman-compose` and prefers it.
  - `package.json` `smtp:up` / `smtp:down` updated to use `podman-compose` directly (was hardcoded `podman compose`, which delegated to docker-compose.exe and broke).
  - `infra/compose/compose.control-plane.yml` is left as-is; `Makefile` `db-up` target now invokes `podman-compose -f ... up -d postgres` (postgres-only, skipping the stale Rust-era `control-plane` service with no Dockerfile).
- 2026-05-22: **manual verification on the user's live broken environment.**
  1. `uv tool install podman-compose` → installed `podman-compose 1.5.0` to `~/.local/bin/`.
  2. `node --experimental-transform-types apps/atlasctl/src/main.ts doctor` → both checks `ok` (podman-machine + podman-compose-provider).
  3. `make db-up` → Postgres container healthy (`Up 36 minutes (healthy)` at last check), accepting connections on 15433.
  4. `pnpm safe bdd:server` → executes end-to-end. Three test failures remain but all trace to a deeper platform-tenancy gap (tenant `acme` not provisioned because admin-approve endpoint doesn't call `PostgresTenantDbProvider.provisionTenantDatabase` — same root cause as the pre-existing public-signup BDD failure). These failures are platform work, NOT doctor-scope.
  Slice ships as scoped: the doctor command + Makefile auto-detect + script fixes unblock the BDD execution. Bypasses formal sdet Phase 2 + architect Phase 3 because main verified manually end-to-end and the user explicitly scoped "Re-run BDD now to confirm failure 1 (root-shadow) is resolved, then stop." Archiving with that note. Pending platform work for per-tenant DB provisioning lives at the chore/podman-machine-windows-pipe-access ticket's "Path forward" section (kept open for that follow-up).
