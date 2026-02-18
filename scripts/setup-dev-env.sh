#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_MIN_MAJOR=22
NODE_MIN_MINOR=12
PNPM_VERSION="10.23.0"

status_ok() { printf "\033[32m[ok]\033[0m %s\n" "$*"; }
status_warn() { printf "\033[33m[warn]\033[0m %s\n" "$*"; }
status_info() { printf "\033[36m[info]\033[0m %s\n" "$*"; }

version_ge() {
  local version="$1"
  local min_major="$2"
  local min_minor="$3"
  local major="${version%%.*}"
  local rest="${version#*.}"
  local minor="${rest%%.*}"
  [[ "$major" -gt "$min_major" ]] || { [[ "$major" -eq "$min_major" && "$minor" -ge "$min_minor" ]]; }
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local current
    current="$(node -v | sed 's/^v//')"
    if version_ge "$current" "$NODE_MIN_MAJOR" "$NODE_MIN_MINOR"; then
      status_ok "Node $current is compatible."
      return 0
    fi
    status_warn "Node $current is below required ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+."
  else
    status_warn "Node is not installed."
  fi

  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    status_info "Installing Node v${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0 via nvm..."
    nvm install "${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0"
    nvm alias default "${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0"
    nvm use "${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0" >/dev/null
    status_ok "Node $(node -v) active."
    return 0
  fi

  status_warn "nvm not found; please install Node ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ manually."
  return 1
}

ensure_pnpm() {
  status_info "Ensuring pnpm@$PNPM_VERSION..."
  npm install -g "pnpm@$PNPM_VERSION" >/dev/null 2>&1 || npm install -g "pnpm@$PNPM_VERSION"
  status_ok "pnpm $(pnpm -v)"
}

run_gate() {
  local name="$1"
  shift
  status_info "Running $name..."
  if "$@"; then
    status_ok "$name passed."
    return 0
  fi
  status_warn "$name failed."
  return 1
}

main() {
  local build_ok=0
  local check_ok=0
  local test_ok=0

  ensure_node
  ensure_pnpm

  status_info "Installing dependencies..."
  pnpm install
  status_ok "Dependencies installed."

  git config core.hooksPath git-hooks
  status_ok "Git hooks path set to git-hooks."

  run_gate "build" pnpm build && build_ok=1 || true
  run_gate "check" pnpm check && check_ok=1 || true
  run_gate "test" pnpm test && test_ok=1 || true

  printf "\nSummary:\n"
  printf "  build: %s\n" "$([[ $build_ok -eq 1 ]] && echo PASS || echo FAIL)"
  printf "  check: %s\n" "$([[ $check_ok -eq 1 ]] && echo PASS || echo FAIL)"
  printf "  test:  %s\n" "$([[ $test_ok -eq 1 ]] && echo PASS || echo FAIL)"

  if [[ $build_ok -eq 1 && $check_ok -eq 1 && $test_ok -eq 1 ]]; then
    exit 0
  fi
  exit 1
}

main "$@"
