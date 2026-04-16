#!/usr/bin/env bash
set -euo pipefail

KEEP_PUSHING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNANA_PROGRAM_ROOT="${RUNANA_PROGRAM_ROOT:-$(cd "$KEEP_PUSHING_ROOT/../runana-program" && pwd)}"

function note() {
  printf '[cleanup] %s\n' "$*"
}

function print_size_if_present() {
  local path="$1"
  if [[ -e "$path" ]]; then
    du -sh "$path" 2>/dev/null || true
  fi
}

note "Stopping local validator and host-run Next.js processes if present"
pkill -f solana-test-validator >/dev/null 2>&1 || true
pkill -f "next dev" >/dev/null 2>&1 || true
pkill -f "next start" >/dev/null 2>&1 || true

note "Disk usage before cleanup"
print_size_if_present "$KEEP_PUSHING_ROOT/.tmp"
print_size_if_present "$KEEP_PUSHING_ROOT/.next"
print_size_if_present "$KEEP_PUSHING_ROOT/test-ledger"
print_size_if_present "$RUNANA_PROGRAM_ROOT/.tmp"
print_size_if_present "$RUNANA_PROGRAM_ROOT/.anchor"
print_size_if_present "$RUNANA_PROGRAM_ROOT/test-ledger"
print_size_if_present "$RUNANA_PROGRAM_ROOT/target"

note "Removing disposable local artifacts"
rm -rf \
  "$KEEP_PUSHING_ROOT/.tmp" \
  "$KEEP_PUSHING_ROOT/.next" \
  "$KEEP_PUSHING_ROOT/test-ledger" \
  "$RUNANA_PROGRAM_ROOT/.tmp/test-ledger" \
  "$RUNANA_PROGRAM_ROOT/.anchor/test-ledger" \
  "$RUNANA_PROGRAM_ROOT/test-ledger" \
  "$RUNANA_PROGRAM_ROOT/target/debug" \
  "$RUNANA_PROGRAM_ROOT/target/release" \
  "$RUNANA_PROGRAM_ROOT/target/sbpf-solana-solana"

note "Disk usage after cleanup"
print_size_if_present "$KEEP_PUSHING_ROOT/.tmp"
print_size_if_present "$KEEP_PUSHING_ROOT/.next"
print_size_if_present "$KEEP_PUSHING_ROOT/test-ledger"
print_size_if_present "$RUNANA_PROGRAM_ROOT/.tmp"
print_size_if_present "$RUNANA_PROGRAM_ROOT/.anchor"
print_size_if_present "$RUNANA_PROGRAM_ROOT/test-ledger"
print_size_if_present "$RUNANA_PROGRAM_ROOT/target"
