# Atlas Dev Port Map

Single source of truth for which host ports Atlas's local dev infrastructure
binds. Cross-reference before adding a new service. Cross-reference *first*
when something fails to connect — port collisions are a top source of "auth
failed" / "connection refused" head-scratching during dev.

## Conventions

- **Use 5-digit ports** (≥ 10000) for project-specific services. Standard
  defaults like `5432` (Postgres), `6379` (Redis), `27017` (Mongo) are
  routinely held by native installs on a developer's machine. Picking
  `15433` instead of `5433` permanently removes one entire class of
  collision.
- **Bind to `127.0.0.1`** unless the service genuinely needs LAN exposure.
  Compose `ports:` defaults to `0.0.0.0` — be explicit.
- **Override via env**, not by editing committed defaults. Each port is
  expressed as `${VAR:-DEFAULT}` in compose / Makefile, so a dev with a
  collision can `export VAR=…` in their shell or `.env`.

## Ports in use

| Host port | Container port | Service | Compose / config | Override env |
|-----------|----------------|---------|------------------|--------------|
| **3000** | 3000 | `apps/server` (Hono ingress) | `apps/server/src/config.ts` | `INGRESS_PORT` |
| **5199** | — | `apps/admin` Vite dev | `playwright.config.ts`, `scripts/dev-async.ts` | (positional `--port`) |
| **5181** | — | `apps/authoring` Vite dev | `playwright.config.ts` | (positional `--port`) |
| **5180** | — | `apps/sandbox` Vite dev | (sandbox config) | (positional `--port`) |
| **5182** | — | `apps/sim` Vite dev (BDD) | `playwright.bdd.config.ts` | (positional `--port`) |
| **15433** | 5432 | Postgres (control plane) | `infra/compose/compose.control-plane.yml` | `POSTGRES_PORT` / `DB_PORT` |
| **8081** | 8080 | Keycloak admin | `infra/compose/compose.keycloak.yml` | (in compose) |
| **3001** | 3000 | Grafana | `infra/compose/compose.observability.yml` | (in compose) |
| **9090** | 9090 | Prometheus | `infra/compose/compose.observability.yml` | (in compose) |
| **3100** | 3100 | Loki | `infra/compose/compose.observability.yml` | (in compose) |
| **5050** | 80 | pgAdmin (control plane stack) | `infra/compose/compose.control-plane.yml` | — |

> The legacy Rust `apps/control-plane` (host port 8000), the Workers
> Prometheus exporter (9101), and the Dozzle log viewer (8080) were tied
> to the deleted Rust prototype. Their rows are gone — re-add only if a
> TS replacement claims those ports.

## Adding a new service

1. **Pick a 5-digit host port not already in this table.** Search this file
   first.
2. **Express it as `${VAR:-DEFAULT}`** in compose so devs can override.
3. **Add the row to this table** in the same PR.
4. **Add a one-line entry in `infra/CLAUDE.md`'s Key Ports table** so the
   routing doc stays consistent.

## Diagnostics

When `pnpm dev:async` (or any other launcher) reports `password
authentication failed` or `connection refused`:

1. Confirm the container is up: `podman ps --filter name=atlas`.
2. Confirm port mapping: `podman port atlas-platform-control-plane-db`
   should show `5432/tcp -> 0.0.0.0:15433`.
3. Check what's *actually* listening on the host port:

   ```powershell
   # Windows
   netstat -ano | findstr ":15433"
   Get-Process -Id <PID-from-netstat>
   ```

   ```bash
   # macOS / Linux
   lsof -nP -iTCP:15433 -sTCP:LISTEN
   ```

   If the process is not your podman / docker proxy, you have a collision.
   Either stop the colliding service, or override `POSTGRES_PORT` to a free
   higher number.

4. Confirm the user/db exist *inside* the container — sometimes the
   container started without env vars and `atlas_platform` was never
   created:

   ```bash
   podman exec atlas-platform-control-plane-db env | grep POSTGRES
   podman exec atlas-platform-control-plane-db psql -U atlas_platform -d control_plane -c "select 1"
   ```

   If the env vars are empty or the user doesn't exist, run `make db-reset`
   to drop the volume and re-init with proper credentials.

## Why this file exists

Without a single port table, every dev launcher / compose file / doc has
its own copy of `5433` (or whatever) and they drift. When something
collides, the diagnosis bounces through 4–5 places. This file is the
checklist + the rationale behind each chosen port.
