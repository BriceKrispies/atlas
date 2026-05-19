#!/usr/bin/env bash
# Run every *.test.ts under the workspace one at a time with a short timeout.
# Print: file, exit_code, wall_seconds. Anything ≥ the timeout is a hang
# suspect. Survives individual hangs because of `timeout`.

set +e
cd "$(dirname "$0")/.."

TIMEOUT=${TIMEOUT:-45}
ROOT=$(pwd)

# Use the same exclusion list atlas-test uses so we don't probe Playwright specs.
EXCLUDES=(
  "/apps/admin/"
  "/apps/authoring/"
  "/apps/sandbox/"
  "/apps/sim/"
  "/apps/control-plane/"
  "/tests/integration/"
  "/tests/blackbox/"
  "/node_modules/"
  "/dist/"
  "/.claude/"
)

is_excluded() {
  local path="$1"
  for e in "${EXCLUDES[@]}"; do
    case "$path" in *$e*) return 0;; esac
  done
  return 1
}

while IFS= read -r f; do
  if is_excluded "$f"; then continue; fi
  rel=${f#$ROOT/}
  start=$(date +%s)
  timeout "$TIMEOUT" "$ROOT/node_modules/.bin/atlas-test" "$f" > /dev/null 2>&1
  rc=$?
  end=$(date +%s)
  dur=$((end - start))
  if [ $rc -eq 124 ]; then
    printf '%-12s %3ds  %s\n' "HANG" "$dur" "$rel"
  elif [ $rc -ne 0 ]; then
    printf '%-12s %3ds  %s\n' "FAIL($rc)" "$dur" "$rel"
  else
    printf '%-12s %3ds  %s\n' "OK" "$dur" "$rel"
  fi
done < <(find . -name "*.test.ts" -type f 2>/dev/null | sort)
