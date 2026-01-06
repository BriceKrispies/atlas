# Changelog

## [Unreleased] - 2025-01-01

### Added - Podman Support & Database Lifecycle Management

#### Container Runtime Migration
- **Migrated to Podman as default container runtime** (from Docker)
  - Podman is now the default, but Docker is still fully supported
  - Set `CONTAINER_RUNTIME=docker` to use Docker instead
  - All compose files work with both podman-compose and docker-compose

#### Enhanced Database Lifecycle Management

**Makefile Enhancements:**
- Added `db-status` - Check if database container is running and healthy
- Added `db-wait` - Wait for database to accept connections (with retry logic)
- Added `db-logs` - Show database container logs
- Enhanced `db-up` - Now waits for database readiness before returning
- Enhanced `db-migrate` - Now waits for database readiness before running migrations
- Enhanced `db-seed` - Now waits for database readiness before seeding
- All database targets now use podman-compose by default
- Configurable via `CONTAINER_RUNTIME` environment variable

**New Lifecycle Script: `scripts/db-lifecycle.sh`**
- Standalone database lifecycle management script
- Features:
  - `start` - Start database and wait for readiness (with health checks)
  - `stop` - Stop database container
  - `restart` - Restart database
  - `status` - Show container status and health
  - `wait` - Wait for database to be ready
  - `logs` - Show container logs (supports -f to follow)
- Benefits:
  - Colored output for better visibility
  - Smart health checking using `pg_isready`
  - Automatic retry logic (waits up to 30 seconds)
  - Status verification before operations
  - Detailed error messages and warnings
  - Works with both podman and docker
- Executable standalone or via Make targets

#### Health Checking
- Database readiness is verified using `pg_isready` command
- Automatic retry with exponential backoff (30 attempts, 1 second interval)
- Prevents race conditions when running migrations or seeds
- Status command shows both container state and database health

#### Documentation Updates
- Added comprehensive Prerequisites section for podman/docker installation
- Added Windows-specific installation notes (WSL2 recommended)
- Documented both Make and script-based workflows
- Added note about bash shell requirement for Windows users
- Updated Quick Start with new database commands
- Added examples for using Docker instead of Podman

#### Configuration Updates
- Updated `.env.example` with podman/docker compatibility notes
- Added `TENANT_ID` to environment configuration
- Added comments explaining dual-runtime support
- Updated compose file with usage examples

### Technical Details

**Files Modified:**
- `Makefile` - Complete rewrite of database targets with lifecycle management
- `README.md` - Added Prerequisites, enhanced Database Setup section
- `infra/compose/.env.example` - Added compatibility notes and TENANT_ID
- `infra/compose/compose.control-plane.yml` - Added usage comments

**Files Added:**
- `scripts/db-lifecycle.sh` - Standalone lifecycle management script (executable)

**Key Improvements:**
1. **Reliability**: Health checks prevent race conditions
2. **Visibility**: Colored output and detailed status messages
3. **Flexibility**: Works with both podman and docker
4. **Portability**: Platform-agnostic (Linux, macOS, Windows via WSL)
5. **Developer Experience**: Clear feedback on what's happening

### Migration Guide

**For existing users (previously using Docker):**

No changes required! The system still works with Docker:

```bash
# Option 1: Set environment variable
export CONTAINER_RUNTIME=docker
make db-up

# Option 2: Use inline
CONTAINER_RUNTIME=docker make db-up
```

**To switch to Podman (recommended):**

```bash
# Install podman and podman-compose (see README for platform-specific instructions)

# Remove the CONTAINER_RUNTIME override
unset CONTAINER_RUNTIME

# Use normally
make db-up
```

### Breaking Changes

None. Full backward compatibility maintained.

---

## Previous Changes

See previous session summaries for:
- Initial Rust workspace setup
- Control Plane Registry implementation
- Database migrations and seeding
- Bootstrap integration with ingress service
