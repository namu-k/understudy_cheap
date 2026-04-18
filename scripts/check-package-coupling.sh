#!/usr/bin/env bash
# check-package-coupling.sh — Enforce package dependency hierarchy
# Rules:
#   packages/types:     no @understudy/* imports
#   packages/core:      no @understudy/{tools,gui,gateway,channels} imports
#   packages/tools:     no @understudy/{gui,gateway,channels} imports (after Phase 0 fix)
#   packages/gateway:   no @understudy/{channels} imports (gui is allowed for now)

set -euo pipefail

check_package() {
  local pkg="$1"
  local forbidden_pattern="$2"
  local desc="$3"
  
  violations=$(grep -rn "from ['\"]${forbidden_pattern}" "packages/${pkg}/src/" --include='*.ts' 2>/dev/null | grep -v test | grep -v node_modules || true)
  
  if [ -n "$violations" ]; then
    echo "❌ COUPLING VIOLATION in ${pkg}: ${desc}"
    echo "$violations"
    echo ""
    return 1
  fi
  echo "✅ ${pkg}: clean"
}

errors=0

check_package "types"    "@understudy/"      "types must have zero internal deps" || ((errors++))
check_package "core"     "@understudy/(tools|gui|gateway|channels)"  "core must not import tools/gui/gateway/channels" || ((errors++))
check_package "tools"    "@understudy/(gui|gateway|channels)"        "tools must not import gui/gateway/channels" || ((errors++))

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "❌ ${errors} coupling violation(s) found"
  exit 1
fi

echo ""
echo "All package coupling checks passed"
