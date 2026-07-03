#!/usr/bin/env bash
set -u
WT=/home/nick/work/andesim/.claude/worktrees/f6-last-mile
MAIN=/home/nick/work/andesim
T=/home/nick/.claude/jobs/d3a6c200/tmp
FILES=(
  driver/transport_csrs.hpp driver/transport_csrs.cpp driver/transport_csrs_test.cpp
  tests/engines/config_hash.sh driver/CMakeLists.txt driver/run_plan.hpp
  driver/run_plan.cpp driver/plan_test.cpp tests/engines/test_registration_guard.sh
  tests/engines/README.md scripts/render_csr_matrix.py
  tests/engines/ax45mpv_premium-5bea8bdc/gen_manifest.py
  tests/engines/ax46mpv_advanced-a13f86a3/gen_manifest.py
  docs/engine_registration_completeness_ROADMAP.md docs/andes_csr_transport_ROADMAP.md
  scripts/config_inc_to_andes_caps.py tests/andes_sim/test_andes_sim_caps_parity.sh
)
: > "$T/f6.patch"
for f in "${FILES[@]}"; do
  a="$MAIN/$f"; b="$WT/$f"
  [ -f "$a" ] || a=/dev/null
  [ -f "$b" ] || b=/dev/null
  d=$(diff -u "$a" "$b" 2>/dev/null)
  if [ -n "$d" ]; then
    add=$(printf '%s\n' "$d" | grep -c '^+'); del=$(printf '%s\n' "$d" | grep -c '^-')
    kind="edit"; [ "$a" = /dev/null ] && kind="NEW "; [ "$b" = /dev/null ] && kind="DEL "
    printf '%s %-55s +%-4s -%s\n' "$kind" "$f" "$add" "$del"
    printf '%s\n' "$d" >> "$T/f6.patch"
  fi
done
echo "=== patch: $(wc -l < "$T/f6.patch") lines ==="
