# Atlas Infrastructure

## Container Runtime

**Podman by default.** Override with `CONTAINER_RUNTIME=docker`.

All `make` targets use `$(CONTAINER_RUNTIME)-compose` automatically.

## Compose Files

| File | Purpose | Up / Down |
|------|---------|-----------|
| `compose/compose.control-plane.yml` | Postgres DB (host port 15433) | `make db-up` / `make db-down` |
| `compose/compose.keycloak.yml` | Keycloak IdP (port 8081) | `make keycloak-up` / `make keycloak-down` |
| `compose/compose.observability.yml` | Prometheus + Grafana + Loki | `make obs-up` / `make obs-down` |
| `compose/compose.dev.yml` | Local dev (combined services) | — |
| `compose/docker-compose.itest.yml` | Full integration test stack | `make itest-up` / `make itest-down` |

## Dockerfiles

> **Stale.** The Dockerfiles below were authored for the Rust prototype
> (multi-stage `cargo` builds) and have not been ported to the TS stack
> yet. They reference deleted `crates/` / `tools/` / `tests/blackbox`
> paths. A TS Dockerfile for `apps/server` is on the backlog.

| File | Status |
|------|--------|
| `docker/Dockerfile.ingress` | Stale (Rust); rewrite for `apps/server` pending |
| `docker/Dockerfile.workers` | Stale (Rust); rewrite for `apps/projection-worker` pending |
| `docker/Dockerfile.itest` | Stale (Rust); itest stack to be re-thought against TS |

## Key Ports

Atlas dev services use **uncommon port numbers** (mostly 5-digit) to avoid
collisions with native installs on a developer's machine. See
[`../PORTS.md`](../PORTS.md) at the repo root for the canonical list and
the rationale.

| Host Port | Service |
|-----------|---------|
| 3000 | Ingress HTTP |
| 15433 | Postgres (was 5433 — moved to dodge native postgres collision) |
| 8081 | Keycloak admin console |
| 3001 | Grafana |
| 9090 | Prometheus |
| 3100 | Loki |

## Scripts

| Script | Purpose |
|--------|---------|
| `../scripts/itest-lifecycle.sh` | Integration test stack management |
| `../scripts/db-lifecycle.sh` | Database lifecycle operations |
| `../scripts/wait-for-healthy.sh` | Container health polling |
| `../scripts/logs.sh` | Container log viewer (`bash scripts/logs.sh [service]`) |

## DB Connection

```
postgres://atlas_platform:local_dev_password@localhost:15433/control_plane
```

Env var: `CONTROL_PLANE_DB_URL`

## Keycloak

- Admin console: `http://localhost:8081/admin` (admin/admin)
- Internal URL (on atlas-dev network): `http://keycloak:8080`
- Issuer URL: `http://keycloak:8080/realms/<realm>`

## Observability

- Grafana: `http://localhost:3001` (admin/admin)
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- App metrics: `http://localhost:3000/metrics` (server)
