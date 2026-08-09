#!/usr/bin/env bash
# Run every smoke suite. smoke.mjs expects a live server on :4000; the rest
# spawn their own. Exits non-zero if any suite fails. Used by CI and humans:
#   bash server/tests/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0
node server/src/index.js >/tmp/drivepro-ci-server.log 2>&1 &
SRV=$!
for _ in $(seq 1 60); do
  curl -sf http://localhost:4000/api/health >/dev/null 2>&1 && break
  sleep 0.5
done

printf 'smoke: '
if node server/tests/smoke.mjs >/tmp/smoke.out 2>&1; then
  echo PASS
else
  echo FAIL
  tail -12 /tmp/smoke.out
  fail=1
fi
kill "$SRV" 2>/dev/null || true

for n in 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  printf 'smoke%s: ' "$n"
  if node "server/tests/smoke$n.mjs" >"/tmp/smoke$n.out" 2>&1; then
    echo PASS
  else
    echo FAIL
    tail -12 "/tmp/smoke$n.out"
    fail=1
  fi
done

exit "$fail"
