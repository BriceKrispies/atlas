#!/usr/bin/env bash
# Same per-workspace iteration but using `atlas-test-bun` (delegates to bun test).

set +e
cd "$(dirname "$0")/.."

RESULTS=()
for pkg in \
  packages/platform-core \
  packages/logging \
  packages/metrics \
  packages/core \
  packages/design \
  packages/widgets \
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
  if [ ! -f "$pkg/package.json" ]; then continue; fi
  if ! jq -e '.scripts.test == "atlas-test"' "$pkg/package.json" > /dev/null 2>&1; then continue; fi

  echo "=== $pkg ==="
  out=$(cd "$pkg" && timeout 90 ../../node_modules/.bin/atlas-test-bun 2>&1)
  rc=$?
  tail_line=$(echo "$out" | tail -5 | grep -E "pass|fail" | head -1)
  if [ $rc -eq 124 ]; then
    echo "*** TIMEOUT: $pkg"
    RESULTS+=("HANG: $pkg")
  elif [ $rc -ne 0 ]; then
    echo "*** FAIL ($rc): $pkg :: $tail_line"
    RESULTS+=("FAIL: $pkg :: $tail_line")
  else
    echo "OK: $tail_line"
    RESULTS+=("OK: $pkg :: $tail_line")
  fi
done

echo "============================================"
for r in "${RESULTS[@]}"; do echo "  $r"; done
