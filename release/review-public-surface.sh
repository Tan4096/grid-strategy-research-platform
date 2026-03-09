#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

status_output="$(git status --short)"
if [[ -z "$status_output" ]]; then
  echo "[review-surface] working tree is clean"
  exit 0
fi

echo "[review-surface] current working tree summary"
echo
printf '%s\n' "$status_output"
echo

group() {
  local name="$1"
  local pattern="$2"
  local matches
  matches="$(printf '%s\n' "$status_output" | rg "$pattern" || true)"
  if [[ -n "$matches" ]]; then
    echo "## $name"
    printf '%s\n' "$matches"
    echo
  fi
}

group "GitHub / community" '^.. (\.github/|LICENSE|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|CHANGELOG\.md|README\.md)'
group "Backend" '^.. backend/'
group "Frontend" '^.. frontend/'
group "Deploy" '^.. deploy/'
group "Release / docs / examples" '^.. (release/|docs/|examples/|Makefile|start\.sh|start-dev\.sh)'

echo "[review-surface] review each group before public staging"
