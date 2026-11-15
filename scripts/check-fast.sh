#!/usr/bin/env bash
# The fast local gate: what every change must pass before it is handed back.
# CI runs the same checks on Linux.
# Quiet by default: one line per step, and a step's output only when it fails.
# Set VERBOSE=1 to see everything.
set -euo pipefail
cd "$(dirname "$0")/.."

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

step() {
  local name="$1"
  shift
  if [[ "${VERBOSE:-0}" == "1" ]]; then
    echo "== $name"
    "$@"
    return
  fi
  if "$@" >"$log" 2>&1; then
    echo "ok    $name"
  else
    echo "FAIL  $name"
    tail -n 80 "$log"
    exit 1
  fi
}

step "ruff check" uv run --locked ruff check .
step "ruff format" uv run --locked ruff format --check .
step "ty" uv run --locked ty check
step "import rules" uv run --locked lint-imports
step "pytest (not slow)" uv run --locked pytest -q -m "not slow" -n auto
step "js lint" bun run lint
step "js typecheck" bun run typecheck
step "js tests" bun run test
step "viewer browser tests" bash -c "bun run build && bun run --cwd viewer test:browser"
echo "gate passed"
