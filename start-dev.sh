#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_VENV="$BACKEND_DIR/.venv"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_REQ_HASH_FILE="$BACKEND_VENV/.requirements.sha256"

BACKEND_PID=""
FRONTEND_PID=""
EXIT_CODE=0

log() {
  printf '[dev-up] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  set +e
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1
  fi
}

trap cleanup EXIT INT TERM

require_cmd python3
require_cmd npm

if [[ ! -d "$BACKEND_VENV" ]]; then
  log "Creating backend virtualenv..."
  python3 -m venv "$BACKEND_VENV"
fi

if command -v shasum >/dev/null 2>&1; then
  BACKEND_REQ_HASH="$(shasum -a 256 "$BACKEND_DIR/requirements.txt" | awk '{print $1}')"
else
  BACKEND_REQ_HASH="$(python3 - <<PY
import hashlib
from pathlib import Path
path = Path(r"$BACKEND_DIR/requirements.txt")
print(hashlib.sha256(path.read_bytes()).hexdigest())
PY
)"
fi

log "Checking backend dependencies..."
source "$BACKEND_VENV/bin/activate"
NEEDS_BACKEND_INSTALL=0
if [[ ! -f "$BACKEND_REQ_HASH_FILE" ]]; then
  NEEDS_BACKEND_INSTALL=1
elif [[ "$(cat "$BACKEND_REQ_HASH_FILE")" != "$BACKEND_REQ_HASH" ]]; then
  NEEDS_BACKEND_INSTALL=1
elif ! python - <<'PY' >/dev/null 2>&1
import importlib.util
required_modules = [
    "fastapi",
    "uvicorn",
    "numpy",
    "pandas",
    "requests",
    "pydantic",
    "multipart",
    "optuna",
    "pytest",
]
missing = [name for name in required_modules if importlib.util.find_spec(name) is None]
raise SystemExit(1 if missing else 0)
PY
then
  NEEDS_BACKEND_INSTALL=1
fi

if [[ "$NEEDS_BACKEND_INSTALL" -eq 1 ]]; then
  pip install -r "$BACKEND_DIR/requirements.txt"
  printf '%s\n' "$BACKEND_REQ_HASH" > "$BACKEND_REQ_HASH_FILE"
fi
deactivate || true

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  log "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

log "Starting backend on http://localhost:${BACKEND_PORT}"
(
  cd "$BACKEND_DIR"
  source "$BACKEND_VENV/bin/activate"
  exec uvicorn app.main:app --reload --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

log "Starting frontend on http://localhost:${FRONTEND_PORT}"
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

log "Both services are starting..."
log "Press Ctrl+C once to stop both services."

while true; do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    wait "$BACKEND_PID" || EXIT_CODE=$?
    break
  fi
  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    wait "$FRONTEND_PID" || EXIT_CODE=$?
    break
  fi
  sleep 1
done

if [[ "$EXIT_CODE" -ne 0 ]]; then
  exit "$EXIT_CODE"
fi
