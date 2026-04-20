# Atlas Infrastructure

## Container Runtime

**Podman by default.** Override with `CONTAINER_RUNTIME=docker`.

All `make` targets use `$(CONTAINER_RUNTIME)-compose` automatically.

## Compose Files

| File | Purpose | Up / Down |
|------|---------|-----------|
| `compose/compose.control-plane.yml` | Postgres DB (port 5433) | `make db-up` / `make db-down` |
| `compose/compose.keycloak.yml` | Keycloak IdP (port 8081) | `make keycloak-up` / `make keycloak-down` |
| `compose/compose.observability.yml` | Prometheus + Grafana + Loki | `make obs-up` / `make obs-down` |
| `compose/compose.dev.yml` | Local dev (combined services) | — |
| `compose/docker-compose.itest.yml` | Full integration test stack | `make itest-up` / `make itest-down` |

## Dockerfiles

| File | Builds |
|------|--------|
| `docker/Dockerfile.ingress` | Ingress service image |
| `docker/Dockerfile.workers` | Workers service image |
| `docker/Dockerfile.itest` | Full-stack test container (single container with all services) |

## Key Ports

| Port | Service |
|------|---------|
| 3000 | Ingress HTTP |
| 5433 | Postgres |
| 8081 | Keycloak admin console |
| 3001 | Grafana |
| 9090 | Prometheus |
| 3100 | Loki |
| 8080 | Dozzle log viewer (itest stack) |
| 9101 | Workers metrics |

## Scripts

| Script | Purpose |
|--------|---------|
| `../scripts/itest-lifecycle.sh` | Integration test stack management |
| `../scripts/db-lifecycle.sh` | Database lifecycle operations |
| `../scripts/wait-for-healthy.sh` | Container health polling |
| `../scripts/logs.sh` | Container log viewer (`bash scripts/logs.sh [service]`) |

## DB Connection

```
postgres://atlas_platform:local_dev_password@localhost:5433/control_plane
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
- App metrics: `http://localhost:3000/metrics` (ingress), `http://localhost:9101/metrics` (workers)
