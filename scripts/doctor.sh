#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_VENV="$ROOT_DIR/backend/.venv"
FRONTEND_NODE_MODULES="$ROOT_DIR/frontend/node_modules"
EXPECTED_PYTHON_MAJOR=3
EXPECTED_PYTHON_MINOR=11
EXPECTED_NODE_MAJOR=20

fail() {
  printf '[doctor] %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

python_version_tuple() {
  "$1" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
}

node_major_version() {
  node -p 'process.versions.node.split(".")[0]'
}

require_cmd python3
require_cmd node
require_cmd npm

SYSTEM_PYTHON="$(python_version_tuple python3)"
if [[ "$SYSTEM_PYTHON" != "${EXPECTED_PYTHON_MAJOR}.${EXPECTED_PYTHON_MINOR}" ]]; then
  fail "python3 must be ${EXPECTED_PYTHON_MAJOR}.${EXPECTED_PYTHON_MINOR}.x, found ${SYSTEM_PYTHON}. Install Python 3.11 and ensure python3 points to it."
fi

NODE_MAJOR="$(node_major_version)"
if [[ "$NODE_MAJOR" != "$EXPECTED_NODE_MAJOR" ]]; then
  fail "node must be ${EXPECTED_NODE_MAJOR}.x, found $(node -v). Switch to Node 20 before running the project."
fi

if [[ -x "$BACKEND_VENV/bin/python" ]]; then
  VENV_PYTHON="$(python_version_tuple "$BACKEND_VENV/bin/python")"
  if [[ "$VENV_PYTHON" != "${EXPECTED_PYTHON_MAJOR}.${EXPECTED_PYTHON_MINOR}" ]]; then
    fail "backend/.venv uses Python ${VENV_PYTHON}. Recreate it with Python 3.11: rm -rf backend/.venv && ./start-dev.sh"
  fi
fi

if [[ -d "$FRONTEND_NODE_MODULES" ]]; then
  DUPLICATE_PACKAGE_DIRS="$(
    {
      find "$FRONTEND_NODE_MODULES" -mindepth 1 -maxdepth 1 -type d -name '* [0-9]*'
      find "$FRONTEND_NODE_MODULES" -mindepth 2 -maxdepth 2 -type d -path "$FRONTEND_NODE_MODULES/@*/* [0-9]*"
    } | sort
  )"
  if [[ -n "${DUPLICATE_PACKAGE_DIRS//[$'\n\r\t ']}" ]]; then
    fail "frontend/node_modules appears polluted by duplicated package folders. Remove frontend/node_modules and rerun npm ci before building."
  fi
fi

printf '[doctor] Python %s and Node %s look good.\n' "$SYSTEM_PYTHON" "$(node -v)"
