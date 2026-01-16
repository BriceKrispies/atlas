# Atlas Platform Scripts

Helper scripts for development and operations.

## Log Inspection

Quick helpers to inspect container logs without opening the Dozzle web UI.

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
