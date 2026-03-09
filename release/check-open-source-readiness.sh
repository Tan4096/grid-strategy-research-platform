#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "[oss-check] $1" >&2
  exit 1
}

tracked_forbidden=$(git ls-files | rg '(^|/)(dist/|node_modules/|playwright-report/|test-results/)|(^|/)\.env($|$)|(^|/)\.env\.(local|development|production|test)$|\.sqlite3($|-)|\.sqlite3-(wal|shm)$' || true)
if [[ -n "$tracked_forbidden" ]]; then
  fail "Tracked forbidden artifacts detected:\n$tracked_forbidden"
fi

local_paths=$(
  git ls-files \
    | rg -v '^release/check-open-source-readiness\.sh$' \
    | xargs rg -n '/Users/' --no-heading 2>/dev/null \
    || true
)
if [[ -n "$local_paths" ]]; then
  fail "Local absolute paths found in tracked files:\n$local_paths"
fi

secret_like=$(git ls-files | xargs rg -n 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' --no-heading 2>/dev/null || true)
if [[ -n "$secret_like" ]]; then
  fail "Potential secrets found in tracked files:\n$secret_like"
fi

echo "[oss-check] repository hygiene checks passed"
