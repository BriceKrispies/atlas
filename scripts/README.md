# Atlas Platform Scripts

Helper scripts for development and operations.

## Dev-stack orchestration — `dev/` (`pnpm devctl`)

`scripts/dev/` is the dev orchestrator: host-side container/stack lifecycle for
local development, run on Node's built-in type-stripping (no Bun, no second
runtime). It is **not** a product surface and does not replace `atlasctl` — for
operations against a running instance, use `atlasctl`.

```bash
pnpm devctl stack <db|keycloak|obs|smtp> <up|down|status|logs|reset|wait>
pnpm devctl logs <service...> [--tail N] [--no-follow]
```

- `--json` emits a one-line envelope (`{ correlationId, status, data, message? }`,
  mirroring atlasctl) so agents can drive and parse it; default output is
  human-readable.
- Compose-command resolution (`podman-compose` vs `podman compose` vs
  `docker compose`) and the Windows podman-compose-provider trap are handled
  inside the tool. `CONTAINER_RUNTIME=docker` overrides podman.
- The `make db-up` / `obs-up` / `keycloak-up` (etc.) targets are thin aliases
  over this; `pnpm smtp:up` / `smtp:down` map to `stack smtp up|down`.

```bash
pnpm devctl stack db up                 # start Postgres, wait for ready
pnpm devctl stack db status --json      # machine-readable status
pnpm devctl stack keycloak wait         # block until healthy
pnpm devctl logs db --tail 100 --no-follow
```

`devctl logs` targets the **live dev containers** (db, keycloak, grafana,
prometheus, loki, promtail, smtp, pgadmin). The `logs.sh` / `logs.ps1` helpers
below are for the separate, Rust-era **itest** stack.

## Bounded pnpm runner — `safe-pnpm.ts`

Wraps any `pnpm` invocation with a wallclock timeout so a hung script
(file-watcher leak, unflushed stdout, deadlocked child) terminates with
exit code 124 instead of blocking forever.

```bash
pnpm safe test                              # 5 min default
SAFE_PNPM_TIMEOUT_MS=60000 pnpm safe lint   # 60s
SAFE_PNPM_TIMEOUT_MS=600000 pnpm safe bdd   # 10 min for slow suites
```

On timeout the wrapper sends SIGTERM to the whole process tree, waits
`SAFE_PNPM_KILL_GRACE_MS` (default 5s), then SIGKILLs anything still alive.
Forwards SIGINT/SIGTERM from the parent shell. On Windows it uses
`taskkill /T` to reach grandchildren that vanilla `kill()` won't.

Use this for any pnpm command an agent or CI runs unattended. Direct
`pnpm <script>` is fine for interactive use.

## Log Inspection (itest stack)

Quick helpers to inspect **integration-test** container logs without opening the
Dozzle web UI. (For the dev stacks, use `pnpm devctl logs <service...>` above.)

### Bash (Linux/macOS/WSL)

```bash
# Follow all Atlas Platform integration test containers
./scripts/logs.sh

# Follow specific service logs
./scripts/logs.sh ingress
./scripts/logs.sh workers
./scripts/logs.sh postgres

# Follow multiple services
./scripts/logs.sh ingress workers

# Show last 200 lines before following
./scripts/logs.sh --tail 200 ingress

# Dump logs without following
./scripts/logs.sh --no-follow postgres
```

### PowerShell (Windows)

```powershell
# Follow all Atlas Platform integration test containers
.\scripts\logs.ps1

# Follow specific service logs
.\scripts\logs.ps1 ingress
.\scripts\logs.ps1 workers
.\scripts\logs.ps1 postgres

# Follow multiple services
.\scripts\logs.ps1 ingress workers

# Show last 200 lines before following
.\scripts\logs.ps1 -Tail 200 ingress

# Dump logs without following
.\scripts\logs.ps1 -NoFollow postgres
```

### Service Names

- `ingress` - Ingress API gateway
- `workers` - Background workers
- `postgres` or `db` - Database
- `control-plane` or `cp` - Control plane API
- `dozzle` - Log viewer UI

### Web UI Alternative

For a richer log viewing experience with filtering and search:

```
http://localhost:8080
```

This opens Dozzle, a real-time log viewer for Docker containers.

## Integration Test Lifecycle

See `itest-lifecycle.sh` for managing the integration test stack:

```bash
# Start the full integration test environment
bash scripts/itest-lifecycle.sh up

# Stop the environment
bash scripts/itest-lifecycle.sh down

# View status
bash scripts/itest-lifecycle.sh status

# Or use the Makefile targets
make itest-up
make itest-down
make itest-status
make itest-logs
```
