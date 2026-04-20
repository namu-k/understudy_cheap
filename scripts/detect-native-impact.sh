#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [changed-files.txt]" >&2
}

if [ "$#" -gt 1 ]; then
  usage
  exit 64
fi

cleanup() {
  if [ -n "${_TMP_CHANGED_FILES:-}" ]; then
    rm -f "$_TMP_CHANGED_FILES"
  fi
  return 0
}

trap cleanup EXIT

if [ "$#" -eq 1 ]; then
  changed_files="$1"
else
  _TMP_CHANGED_FILES="$(mktemp)"
  changed_files="$_TMP_CHANGED_FILES"
  cat > "$changed_files"
fi

# Conservative shared inputs for native jobs:
# - repo-wide build/test wiring
# - gui package source
# - shared GUI contracts/helpers now hosted in packages/types
# - Windows-only UIA wiring that is exercised only in Windows-oriented flows
common_native='^(\.github/workflows/ci\.yml|package\.json|pnpm-lock\.yaml|tsconfig\.base\.json|vitest\.package\.config\.ts|packages/(gui|types|tools)/package\.json)$'
shared_gui='^(packages/gui/src/|packages/types/src/(grounding|gui|index)\.ts)$'
windows_native='^(packages/gui/native/win32/|packages/tools/src/(gui-tools|uia-[^/]+)\.ts)$'
macos_native='^scripts/check-optional-real-gui\.mjs$'

matches() {
  local pattern="$1"
  grep -Eq "$pattern" "$changed_files"
}

if matches "$common_native|$shared_gui|$windows_native"; then
  echo "windows_native=true"
else
  echo "windows_native=false"
fi

if matches "$common_native|$shared_gui|$macos_native"; then
  echo "macos_native=true"
else
  echo "macos_native=false"
fi
