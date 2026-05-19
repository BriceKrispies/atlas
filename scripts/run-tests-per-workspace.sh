#!/usr/bin/env bash
# Iterate over every workspace package that has a `test` script and run
# its tests with a strict timeout. Prints a summary at the end.

set +e

cd "$(dirname "$0")/.."

RESULTS=()
FAIL_COUNT=0
HANG_COUNT=0

# Find every workspace with a test script.
PKGS=$(jq -r '.scripts.test // empty | select(. == "atlas-test")' <(echo "{}"))

for pkg in \
  packages/platform-core \
  packages/logging \
  packages/metrics \
  packages/core \
  packages/design \
  packages/widgets \
  packages/widget-host \
  packages/openapi \
  packages/api-client \
  packages/ingress \
  packages/wasm-host \
  packages/arch-tests \
  packages/test-state \
  packages/test-fixtures \
  packages/chaos \
  packages/schemas \
  packages/seeder \
  packages/eslint-plugin-atlas-widgets \
  modules/authz \
  modules/catalog \
  modules/content-pages \
  modules/identity \
  modules/repository \
  modules/tenancy \
  adapters/idb \
  adapters/node \
  adapters/policy-cedar \
  adapters/policy-stub \
  adapters/seed-memory \
  apps/atlasctl \
  apps/projection-worker \
  apps/server \
  bundles/standard \
  ports
do
  if [ ! -f "$pkg/package.json" ]; then
    continue
  fi
  if ! jq -e '.scripts.test == "atlas-test"' "$pkg/package.json" > /dev/null 2>&1; then
    continue
  fi

  echo "=== $pkg ==="
  (cd "$pkg" && timeout 60 ../../node_modules/.bin/atlas-test 2>&1 | tail -8)
  rc=$?
  if [ $rc -eq 124 ]; then
    echo "*** TIMEOUT: $pkg"
    HANG_COUNT=$((HANG_COUNT+1))
    RESULTS+=("HANG: $pkg")
  elif [ $rc -ne 0 ]; then
    echo "*** FAIL ($rc): $pkg"
    FAIL_COUNT=$((FAIL_COUNT+1))
    RESULTS+=("FAIL: $pkg")
  else
    RESULTS+=("OK: $pkg")
  fi
done

echo "============================================"
echo "Summary:"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "  Failures: $FAIL_COUNT, Hangs: $HANG_COUNT"
