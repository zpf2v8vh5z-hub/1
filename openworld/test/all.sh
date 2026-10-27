#!/usr/bin/env bash
# Runs every check. The boot test needs the module loader hook, which is easy to
# forget when invoking files by hand — hence this script.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
run() {
  local label="$1"; shift
  if "$@" >/tmp/lh-test.out 2>&1; then
    printf "  PASS  %s\n" "$label"
  else
    printf "  FAIL  %s\n" "$label"
    tail -12 /tmp/lh-test.out | sed 's/^/        /'
    fail=1
  fi
}

echo "Liberty Heights — test suite"
run "city layout"        node tools/test_city.js
run "vehicle physics"    node test/physics.mjs
run "texture loader"     node test/textures.mjs
run "touch controls"     node test/touch.mjs
run "bootstrap safety"   node test/bootstrap.mjs
run "hostile boot"       node test/boot-fatal.mjs
run "world assembly"     node test/smoke.mjs
run "module boots"       node --import ./test/register-three-stub.mjs test/boot-success.mjs
run "index stamped"      python3 tools/stamp_build.py --check

echo
if [ "$fail" -ne 0 ]; then
  echo "one or more suites failed"
  exit 1
fi
echo "all suites passed"
