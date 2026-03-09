#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GROUPS_DIR="$ROOT_DIR/release/commit-groups"

usage() {
  cat <<'EOF'
Usage:
  bash release/stage-commit-group.sh [--reset] <group>

Groups:
  01-oss-surface
  02-backend-infra
  03-backend-features
  04-frontend-features
  05-generated-assets
EOF
}

reset_index=0
if [[ "${1:-}" == "--reset" ]]; then
  reset_index=1
  shift
fi

group="${1:-}"
if [[ -z "$group" ]]; then
  usage
  exit 1
fi

pathspec_file="$GROUPS_DIR/$group.pathspec"
if [[ ! -f "$pathspec_file" ]]; then
  echo "Unknown group: $group" >&2
  usage
  exit 1
fi

cd "$ROOT_DIR"

if [[ "$reset_index" -eq 1 ]]; then
  git reset
fi

git add --pathspec-from-file="$pathspec_file"

echo "[stage-commit-group] staged $group"
git status --short
