#!/bin/bash
set -e

# =============================================================================
# Atlas Integration Test Entrypoint
# Orchestrates: Postgres → Migrate → Seed → Ingress → Frontend → Playwright
# =============================================================================

LOG_DIR="/test-logs"
RESULTS_DIR="/test-results"

DB_USER="atlas_platform"
DB_NAME="control_plane"
DB_PASSWORD="itest_password"
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

echo "=== Atlas Integration Test Container ==="
echo ""

# ---- Phase 1: Start Postgres ------------------------------------------------
echo "[1/6] Starting Postgres..."
pg_ctlcluster 16 main start -- -l "${LOG_DIR}/postgres.log" 2>/dev/null || true

# Wait for Postgres to accept connections
for i in $(seq 1 30); do
  if su postgres -c "pg_isready -h localhost" > /dev/null 2>&1; then
    echo "  Postgres is ready (attempt ${i}/30)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ERROR: Postgres failed to start"
    cat "${LOG_DIR}/postgres.log" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

# Create role and database
su postgres -c "psql -c \"CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';\"" 2>/dev/null || true
su postgres -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"" 2>/dev/null || true

# ---- Phase 2: Run Migrations ------------------------------------------------
echo "[2/6] Running migrations..."
export ATLAS_ENV=dev
export CONTROL_PLANE_DB_URL="${DB_URL}"
migrate 2>&1 | tee "${LOG_DIR}/migrate.log"

# ---- Phase 3: Seed Data -----------------------------------------------------
echo "[3/6] Seeding database..."
export ATLAS_FIXTURES_DIR="/app/specs/fixtures"
export ATLAS_SCHEMAS_DIR="/app/specs/schemas/contracts"
seed 2>&1 | tee "${LOG_DIR}/seed.log"

# ---- Phase 4: Start Ingress -------------------------------------------------
echo "[4/6] Starting ingress..."
export ATLAS_LOG_DIR="${LOG_DIR}"
export CONTROL_PLANE_ENABLED=true
export TEST_AUTH_ENABLED=true
export DEBUG_AUTH_ENDPOINT_ENABLED=true
export TENANT_ID=tenant-itest-001
export RUST_LOG="info,atlas_platform_ingress=debug"

ingress &
INGRESS_PID=$!

# Wait for ingress readiness
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/readyz > /dev/null 2>&1; then
    echo "  Ingress is ready (attempt ${i}/60)"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "  ERROR: Ingress failed to become ready"
    cat "${LOG_DIR}/ingress.log" 2>/dev/null | tail -20
    exit 1
  fi
  sleep 0.5
done

# ---- Phase 5: Start Frontend Dev Server -------------------------------------
echo "[5/6] Starting frontend dev server..."
cd /app/frontend

VITE_BACKEND=http \
VITE_API_URL=http://localhost:3000 \
VITE_TENANT_ID=tenant-itest-001 \
  pnpm --filter @atlas/admin dev --port 5199 \
  > "${LOG_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Wait for Vite dev server
for i in $(seq 1 60); do
  if curl -sf http://localhost:5199 > /dev/null 2>&1; then
    echo "  Frontend is ready (attempt ${i}/60)"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "  ERROR: Frontend dev server failed to start"
    cat "${LOG_DIR}/frontend.log" 2>/dev/null | tail -20
    exit 1
  fi
  sleep 0.5
done

# ---- Phase 6: Run Playwright Tests ------------------------------------------
echo "[6/6] Running integration tests..."
echo ""

cd /app/frontend
TEST_LOG_DIR="${LOG_DIR}" \
TEST_RESULTS_DIR="${RESULTS_DIR}" \
  npx playwright test --config playwright.itest.config.js 2>&1 | tee "${LOG_DIR}/playwright.log"
TEST_EXIT=${PIPESTATUS[0]}

# ---- Cleanup -----------------------------------------------------------------
echo ""
echo "=== Cleanup ==="
kill $FRONTEND_PID $INGRESS_PID 2>/dev/null || true
pg_ctlcluster 16 main stop 2>/dev/null || true

if [ "$TEST_EXIT" -eq 0 ]; then
  echo "=== ALL TESTS PASSED ==="
else
  echo "=== TESTS FAILED (exit code: ${TEST_EXIT}) ==="
  echo "Check logs in /test-logs/ and report in /test-results/"
fi

exit $TEST_EXIT
