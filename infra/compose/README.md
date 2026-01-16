# Atlas Platform Infrastructure Compose

Local development infrastructure for the Atlas platform.

## Available Stacks

| Stack | Compose File | Description |
|-------|--------------|-------------|
| **Local Dev** | `compose.dev.yml` | Ingress + Keycloak for local OIDC development |
| Keycloak (standalone) | `compose.keycloak.yml` | Identity provider only |
| Observability | `compose.observability.yml` | Prometheus, Grafana, Loki, Promtail |
| Control Plane | `compose.control-plane.yml` | Postgres, pgAdmin, Control Plane service |
| Integration Tests | `docker-compose.itest.yml` | Full stack for integration testing |

---

## Local Development with OIDC (Recommended)

The `compose.dev.yml` stack runs ingress + Keycloak together on the `atlas-dev` network for seamless local OAuth2/OIDC development.

### Quick Start

```bash
cd infra/compose

# Start the dev stack (ingress + keycloak)
docker compose -f compose.dev.yml up -d

# View logs
docker compose -f compose.dev.yml logs -f

# Stop the stack
docker compose -f compose.dev.yml down
```

### Access URLs

| Service | URL | Notes |
|---------|-----|-------|
| Ingress API | http://localhost:3000 | Main API endpoint |
| Ingress Health | http://localhost:3000/ | Health check |
| Debug Whoami | http://localhost:3000/debug/whoami | Returns authenticated principal |
| Keycloak Admin | http://localhost:8081/admin | Admin console (admin/admin) |
| Keycloak OIDC | http://localhost:8081/realms/atlas | OIDC discovery endpoint |

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    atlas-dev network                         │
│  ┌─────────────┐              ┌─────────────────────────┐   │
│  │   ingress   │─────────────▶│       keycloak          │   │
│  │  :3000      │  http://     │  :8080                  │   │
│  └─────────────┘  keycloak:   └─────────────────────────┘   │
│        │          8080               │                      │
└────────│─────────────────────────────│──────────────────────┘
         │                             │
    localhost:3000               localhost:8081
         │                             │
    ┌────▼─────────────────────────────▼────┐
    │              Host Machine              │
    └────────────────────────────────────────┘
```

### Setting Up Keycloak for Local Dev

1. **Start the dev stack:**
   ```bash
   docker compose -f compose.dev.yml up -d
   ```

2. **Create a realm** (one-time setup):
   - Open http://localhost:8081/admin
   - Login: admin / admin
   - Click "Create Realm"
   - Name: `atlas`
   - Click "Create"

3. **Create a client** (one-time setup):
   - Select realm "atlas"
   - Go to Clients → Create client
   - Client ID: `atlas-ingress`
   - Client authentication: ON
   - Service accounts roles: ON (for client credentials)
   - Click Save
   - Go to Credentials tab → copy the Client Secret

4. **Get an access token:**
   ```bash
   # Client credentials grant (service-to-service)
   curl -X POST http://localhost:8081/realms/atlas/protocol/openid-connect/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials" \
     -d "client_id=atlas-ingress" \
     -d "client_secret=<your-client-secret>"
   ```

5. **Test the debug endpoint:**
   ```bash
   # Use the access_token from the previous response
   curl -H "Authorization: Bearer <access_token>" \
     http://localhost:3000/debug/whoami
   ```

### Issuer URL Consistency

Tokens minted by Keycloak contain an `iss` (issuer) claim. For token validation to succeed, ingress must use the same issuer URL.

**How it works:**
- Keycloak is configured with `KC_HOSTNAME=keycloak` and `KC_HOSTNAME_PORT=8080`
- All tokens have `iss: http://keycloak:8080/realms/atlas`
- Ingress validates tokens against `OIDC_ISSUER_URL=http://keycloak:8080/realms/atlas`
- Since both services are on the `atlas-dev` network, the hostname `keycloak` resolves correctly

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYCLOAK_ADMIN` | `admin` | Keycloak admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin` | Keycloak admin password |
| `KEYCLOAK_PORT` | `8081` | Keycloak host port |
| `INGRESS_PORT` | `3000` | Ingress host port |
| `OIDC_ISSUER_URL` | `http://keycloak:8080/realms/atlas` | OIDC issuer for token validation |
| `OIDC_AUDIENCE` | `atlas-ingress` | Expected audience in tokens |
| `TENANT_ID` | `tenant-dev` | Default tenant ID |

### Data Persistence

Data is stored in Docker volumes:
- `atlas-dev-keycloak-data` - Keycloak realms, clients, users

To reset all data:
```bash
docker compose -f compose.dev.yml down -v
```

---

## Keycloak Standalone

If you only need Keycloak (without ingress), use `compose.keycloak.yml`:

```bash
# Start Keycloak only
docker compose -f compose.keycloak.yml up -d

# Access admin console
open http://localhost:8081/admin
```

This is useful when running ingress locally (not in Docker) but needing Keycloak for OIDC.

---

## Observability Stack

Local development observability with Prometheus (metrics), Loki (logs), and Grafana (visualization).

## Quick Start

```bash
# Start observability stack
make obs-up

# Start application services
make run-ingress  # Terminal 1
make run-workers  # Terminal 2

# Access Grafana
# Open http://localhost:3001 (no login required)
```

## Available Commands

```bash
make obs-up        # Start all observability services
make obs-down      # Stop all observability services
make obs-status    # Check service status
make obs-logs      # Follow logs from observability containers
make obs-reset     # Reset (down, remove volumes, up)
make obs-open      # Show service URLs
```

## Service URLs

- **Grafana**: http://localhost:3001 (anonymous auth enabled for local dev)
- **Prometheus**: http://localhost:9090
- **Loki**: http://localhost:3100

## Application Metrics Endpoints

- **Ingress**: http://localhost:3000/metrics
- **Workers**: http://localhost:9101/metrics

## Available Metrics

### Ingress Service

- `http_requests_total{route, method, status}` - Total HTTP requests
- `http_request_duration_seconds{route, method}` - Request latency histogram
- `events_appended_total{tenant_id, event_type}` - Events written to event store
- `policy_evaluations_total{decision}` - Policy evaluation outcomes (allow/deny)

### Workers Service

- `worker_heartbeats_total` - Worker process heartbeats

### Example Prometheus Queries

```promql
# Request rate by status code
rate(http_requests_total[5m])

# 95th percentile request latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Error rate (4xx + 5xx)
sum(rate(http_requests_total{status=~"4..|5.."}[5m]))

# Events appended per second by type
rate(events_appended_total[1m])

# Policy deny rate
rate(policy_evaluations_total{decision="deny"}[5m])

# Worker heartbeat frequency
rate(worker_heartbeats_total[1m])
```

## Log Queries in Grafana

### Access Loki Logs

1. Open Grafana: http://localhost:3001
2. Click "Explore" (compass icon) in left sidebar
3. Select "Loki" datasource from dropdown
4. Use LogQL queries below

### Example LogQL Queries

```logql
# All logs from ingress container
{container_name=~".*ingress.*"}

# All logs from workers container
{container_name=~".*workers.*"}

# Error-level logs across all services
{container_name=~"atlas-platform-.*"} |= "ERROR"

# Warning and error logs
{container_name=~"atlas-platform-.*"} |~ "WARN|ERROR"

# Logs from last 5 minutes
{container_name=~"atlas-platform-.*"} | __timestamp__ > 5m

# Filter by specific tenant
{container_name=~".*ingress.*"} | json | tenant_id="tenant-123"

# Count errors per minute
sum(count_over_time({container_name=~"atlas-platform-.*"} |= "ERROR" [1m]))
```

## Creating Dashboards in Grafana

### Method 1: Manual Dashboard Creation

1. Open Grafana → Dashboards → New → New Dashboard
2. Click "Add visualization"
3. Select datasource (Prometheus or Loki)
4. Enter query (see examples above)
5. Configure visualization options
6. Click "Apply" and "Save dashboard"

### Method 2: Import Dashboard JSON

Create a dashboard JSON file and place it in:
```
infra/compose/config/grafana/provisioning/dashboards/
```

Example dashboard structure:
```json
{
  "dashboard": {
    "title": "Atlas Platform Overview",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      }
    ]
  }
}
```

Dashboards in this directory are auto-loaded on Grafana startup.

## Troubleshooting

### Services won't start

```bash
# Check container status
make obs-status

# View logs
make obs-logs

# Hard reset
make obs-reset
```

### Metrics not appearing in Prometheus

1. Check if metrics endpoints are accessible:
   ```bash
   curl http://localhost:3000/metrics  # Ingress
   curl http://localhost:9101/metrics  # Workers
   ```

2. Check Prometheus targets:
   - Open http://localhost:9090/targets
   - Verify "ingress" and "workers" jobs show as UP

3. Verify services are running on host (not in containers):
   ```bash
   # Prometheus scrapes host.docker.internal
   # Services must run locally for metrics to be scraped
   ```

### Logs not appearing in Loki

1. Check if containers are running:
   ```bash
   docker ps | grep atlas-platform
   ```

2. Verify Promtail is scraping:
   - Open http://localhost:3001/explore
   - Select Loki datasource
   - Run: `{job="docker"}`

3. Check container name regex:
   - Promtail only scrapes containers matching: `/(atlas-platform-.*|ingress|workers)`
   - If running services in Docker, ensure container names match

### Grafana shows "no data"

1. Check time range selector (top right)
2. Verify datasource configuration:
   - Settings → Data Sources
   - Test "Prometheus" and "Loki" connections

## Architecture Notes

### Metrics Collection

- **Prometheus** scrapes metrics via HTTP polling (pull model)
- Services expose `/metrics` endpoints in Prometheus text format
- Scrape interval: 5s for apps, 15s default
- Ingress metrics on same port as API (3000)
- Workers metrics on dedicated port (9101)

### Log Collection

- **Promtail** scrapes Docker container logs via Docker socket
- Only scrapes containers with names matching regex pattern
- Pushes logs to Loki via HTTP (push model)
- Supports JSON log parsing for structured fields

### Data Storage

- All data stored in Docker volumes (persists across restarts)
- Volumes: `prometheus_data`, `grafana_data`, `loki_data`
- Reset volumes with: `make obs-reset`

## Development Workflow

1. Start observability stack: `make obs-up`
2. Start application services: `make run-ingress`, `make run-workers`
3. Generate traffic:
   ```bash
   curl -X POST http://localhost:3000/api/v1/intents \
     -H "Content-Type: application/json" \
     -d '{
       "tenant_id": "test-tenant",
       "event_type": "UserSignedUp",
       "idempotency_key": "unique-key-123",
       "payload": {}
     }'
   ```
4. View metrics in Grafana:
   - Create dashboard with Prometheus queries
   - Add panels for request rate, latency, errors
5. View logs in Grafana:
   - Use Explore with Loki datasource
   - Filter by container, log level, or JSON fields
6. Iterate and monitor application behavior

## Production Considerations

This setup is designed for **local development only**:

- Anonymous auth enabled (no security)
- Data stored in local volumes (not durable)
- Prometheus scrapes `host.docker.internal` (Docker Desktop only)
- No retention policies configured
- No alerting configured

For production deployments:
- Use proper authentication/authorization
- Configure remote storage for metrics/logs
- Set up retention policies
- Configure alerting rules
- Use service discovery instead of static configs
- Deploy as part of Kubernetes/cloud infrastructure
