#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_VENV="$BACKEND_DIR/.venv"
SCRIPT_NAME="$(basename "$0")"
BACKEND_PYTHON=""

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
BACKEND_REQ_HASH_FILE="$BACKEND_VENV/.requirements.sha256"
FRONTEND_LOCK_HASH_FILE="$FRONTEND_DIR/node_modules/.package-lock.sha256"
EXPECTED_PYTHON_VERSION="3.11"
EXPECTED_NODE_MAJOR="20"

BACKEND_PID=""
FRONTEND_PID=""
EXIT_CODE=0

log() {
  printf '[dev-up] %s\n' "$1"
}

resolve_backend_python() {
  if [[ -x "$BACKEND_VENV/bin/python" ]]; then
    printf '%s\n' "$BACKEND_VENV/bin/python"
    return 0
  fi
  if [[ -x "$BACKEND_VENV/bin/python3" ]]; then
    printf '%s\n' "$BACKEND_VENV/bin/python3"
    return 0
  fi
  return 1
}

is_private_ipv4() {
  local ip="${1:-}"
  [[ "$ip" =~ ^10\. ]] || [[ "$ip" =~ ^192\.168\. ]] || [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]
}

is_ipv4() {
  local ip="${1:-}"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

pick_first_private_ip() {
  local candidate
  for candidate in "$@"; do
    if is_private_ipv4 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

detect_default_iface() {
  local iface=""
  if command -v route >/dev/null 2>&1; then
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$iface" ]]; then
      printf '%s\n' "$iface"
      return 0
    fi
  fi

  if command -v ip >/dev/null 2>&1; then
    iface="$(ip route show default 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="dev") {print $(i+1); exit}}')"
    if [[ -n "$iface" ]]; then
      printf '%s\n' "$iface"
      return 0
    fi
  fi

  return 1
}

detect_iface_ipv4() {
  local iface="${1:-}"
  local ip=""

  if [[ -z "$iface" ]]; then
    return 1
  fi

  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null | tr -d '\r' | awk 'NF{print $1; exit}')"
    if is_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig "$iface" 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
    if is_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 addr show "$iface" 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1)"
    if is_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  return 1
}

detect_lan_ip() {
  if [[ -n "${LAN_IP:-}" ]]; then
    printf '%s\n' "$LAN_IP"
    return 0
  fi

  local ip iface

  iface="$(detect_default_iface || true)"
  if [[ -n "$iface" ]]; then
    ip="$(detect_iface_ipv4 "$iface" || true)"
    if is_private_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  for iface in en0 en1 wlan0 wlp2s0 wlp3s0 eth0; do
    ip="$(detect_iface_ipv4 "$iface" || true)"
    if is_private_ipv4 "$ip"; then
      printf '%s\n' "$ip"
      return 0
    fi
  done

  if command -v hostname >/dev/null 2>&1; then
    local host_ips
    host_ips="$(hostname -I 2>/dev/null || true)"
    if [[ -n "$host_ips" ]]; then
      # shellcheck disable=SC2206
      local host_ip_arr=($host_ips)
      ip="$(pick_first_private_ip "${host_ip_arr[@]}" || true)"
      if [[ -n "$ip" ]]; then
        printf '%s\n' "$ip"
        return 0
      fi
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig 2>/dev/null | awk '
      /^[a-zA-Z0-9]/ {
        iface=$1
        sub(":", "", iface)
      }
      /inet / {
        addr=$2
        if (addr == "127.0.0.1") next
        if (iface ~ /^(lo|utun|awdl|llw|bridge|gif|stf|anpi|ap|docker|veth)/) next
        print addr
      }
    ' | awk '
      /^10\./ || /^192\.168\./ || /^172\.(1[6-9]|2[0-9]|3[0-1])\./ {print; exit}
    ')"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -o -4 addr show up scope global 2>/dev/null | awk '
      {
        iface=$2
        split($4, parts, "/")
        addr=parts[1]
        if (iface ~ /^(lo|docker|veth|br-|tun|tap)/) next
        print addr
      }
    ' | awk '
      /^10\./ || /^192\.168\./ || /^172\.(1[6-9]|2[0-9]|3[0-1])\./ {print; exit}
    ')"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  return 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

python_version_short() {
  "$1" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
}

node_major_version() {
  node -p 'process.versions.node.split(".")[0]'
}

ensure_supported_python() {
  local version
  version="$(python_version_short python3)"
  if [[ "$version" != "$EXPECTED_PYTHON_VERSION" ]]; then
    echo "python3 must be ${EXPECTED_PYTHON_VERSION}.x, found ${version}. Please switch python3 to Python ${EXPECTED_PYTHON_VERSION} before running ${SCRIPT_NAME}." >&2
    exit 1
  fi
}

ensure_supported_node() {
  local major
  major="$(node_major_version)"
  if [[ "$major" != "$EXPECTED_NODE_MAJOR" ]]; then
    echo "node must be ${EXPECTED_NODE_MAJOR}.x, found $(node -v). Please switch to Node ${EXPECTED_NODE_MAJOR} before running ${SCRIPT_NAME}." >&2
    exit 1
  fi
}

ensure_backend_venv_python() {
  local version
  version="$(python_version_short "$1")"
  if [[ "$version" != "$EXPECTED_PYTHON_VERSION" ]]; then
    echo "Backend virtualenv uses Python ${version}, expected ${EXPECTED_PYTHON_VERSION}. Remove backend/.venv and rerun ${SCRIPT_NAME} with Python ${EXPECTED_PYTHON_VERSION}." >&2
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
require_cmd node
require_cmd npm
ensure_supported_python
ensure_supported_node

LAN_IP_DETECTED="$(detect_lan_ip || true)"
if [[ -z "$LAN_IP_DETECTED" ]]; then
  LAN_IP_DETECTED="127.0.0.1"
  log "Warning: unable to auto-detect LAN IP, fallback to 127.0.0.1 (LAN phone access may not work)."
fi

BACKEND_PUBLIC_URL="${BACKEND_PUBLIC_URL:-http://${LAN_IP_DETECTED}:${BACKEND_PORT}}"
FRONTEND_PUBLIC_URL="${FRONTEND_PUBLIC_URL:-http://${LAN_IP_DETECTED}:${FRONTEND_PORT}}"
EFFECTIVE_CORS_ALLOW_ORIGINS="${CORS_ALLOW_ORIGINS:-http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT},${FRONTEND_PUBLIC_URL}}"
EFFECTIVE_VITE_API_BASE="${VITE_API_BASE:-${BACKEND_PUBLIC_URL}}"
if [[ "${LAN_IP_DETECTED}" == "127.0.0.1" ]]; then
  log "Tip: set LAN_IP manually for phone access, e.g. LAN_IP=192.168.x.x ./${SCRIPT_NAME}"
fi

if [[ ! -d "$BACKEND_VENV" ]]; then
  log "Creating backend virtualenv..."
  python3 -m venv "$BACKEND_VENV"
fi

BACKEND_PYTHON="$(resolve_backend_python || true)"
if [[ -z "$BACKEND_PYTHON" ]] || ! "$BACKEND_PYTHON" -c 'import sys' >/dev/null 2>&1; then
  log "Detected broken backend virtualenv (project path may have changed), recreating..."
  rm -rf "$BACKEND_VENV"
  python3 -m venv "$BACKEND_VENV"
  BACKEND_PYTHON="$(resolve_backend_python || true)"
fi

if [[ -z "$BACKEND_PYTHON" ]]; then
  log "Could not find backend python interpreter in $BACKEND_VENV/bin."
  exit 1
fi

ensure_backend_venv_python "$BACKEND_PYTHON"

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
elif ! "$BACKEND_PYTHON" - <<'PY' >/dev/null 2>&1
import importlib.util
required_modules = [
    "fastapi",
    "uvicorn",
    "numpy",
    "pandas",
    "requests",
    "pydantic",
    "pydantic_settings",
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
  "$BACKEND_PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt"
  printf '%s\n' "$BACKEND_REQ_HASH" > "$BACKEND_REQ_HASH_FILE"
fi
deactivate || true

if command -v shasum >/dev/null 2>&1; then
  FRONTEND_LOCK_HASH="$(shasum -a 256 "$FRONTEND_DIR/package-lock.json" | awk '{print $1}')"
else
  FRONTEND_LOCK_HASH="$(python3 - <<PY
import hashlib
from pathlib import Path
path = Path(r"$FRONTEND_DIR/package-lock.json")
print(hashlib.sha256(path.read_bytes()).hexdigest())
PY
)"
fi

NEEDS_FRONTEND_INSTALL=0
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  NEEDS_FRONTEND_INSTALL=1
elif [[ ! -f "$FRONTEND_LOCK_HASH_FILE" ]]; then
  NEEDS_FRONTEND_INSTALL=1
elif [[ "$(cat "$FRONTEND_LOCK_HASH_FILE")" != "$FRONTEND_LOCK_HASH" ]]; then
  NEEDS_FRONTEND_INSTALL=1
fi

if [[ "$NEEDS_FRONTEND_INSTALL" -eq 1 ]]; then
  log "Installing frontend dependencies with npm ci..."
  (cd "$FRONTEND_DIR" && npm ci)
  printf '%s\n' "$FRONTEND_LOCK_HASH" > "$FRONTEND_LOCK_HASH_FILE"
fi

# 若默认后端端口被占用，自动尝试下一个端口
while true; do
  if command -v lsof >/dev/null 2>&1; then
    if ! lsof -i ":$BACKEND_PORT" >/dev/null 2>&1; then
      break
    fi
  fi
  log "Port ${BACKEND_PORT} is in use, trying $((BACKEND_PORT + 1))..."
  BACKEND_PORT=$((BACKEND_PORT + 1))
  if [[ "$BACKEND_PORT" -gt 8010 ]]; then
    log "Could not find a free port for backend (tried up to ${BACKEND_PORT}). Stop the process using port 8000 and retry."
    exit 1
  fi
done
BACKEND_PUBLIC_URL="http://${LAN_IP_DETECTED}:${BACKEND_PORT}"
EFFECTIVE_VITE_API_BASE="${VITE_API_BASE:-${BACKEND_PUBLIC_URL}}"

log "LAN IP: ${LAN_IP_DETECTED}"
log "Frontend LAN URL: ${FRONTEND_PUBLIC_URL}"
log "Backend API URL: ${BACKEND_PUBLIC_URL}"
log "CORS_ALLOW_ORIGINS: ${EFFECTIVE_CORS_ALLOW_ORIGINS}"
log "VITE_API_BASE: ${EFFECTIVE_VITE_API_BASE}"
log "Starting backend on http://${BACKEND_HOST}:${BACKEND_PORT}"
(
  cd "$BACKEND_DIR"
  source "$BACKEND_VENV/bin/activate"
  export CORS_ALLOW_ORIGINS="$EFFECTIVE_CORS_ALLOW_ORIGINS"
  export APP_AUTH_ENABLED="${APP_AUTH_ENABLED:-0}"
  exec "$BACKEND_PYTHON" -m uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

log "Starting frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT}"
(
  cd "$FRONTEND_DIR"
  export VITE_API_BASE="$EFFECTIVE_VITE_API_BASE"
  exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
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
