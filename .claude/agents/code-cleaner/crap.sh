#!/usr/bin/env bash
# crap.sh -- score the functions you just wrote.
#
#   CRAP(f) = CC(f)^2 * (1 - coverage(f))^3 + CC(f)
#
# Complexity is a debt and tests are how you pay it down: a function simple
# enough needs no tests, a complicated one can never be paid off. The default
# scope is your uncommitted work, because that is what you are accountable for.
#
# Usage:
#   crap.sh --filter 'src/'                    # functions changed vs HEAD
#   crap.sh --filter 'src/' --diff HEAD~3      # ... changed in the last 3 commits
#   crap.sh --filter 'src/' --min-churn 5      # audit mode: often-edited old code
#   crap.sh --hook --filter 'src/'             # Claude Code Stop hook exit codes
#
# Needs .gcda files -- run cov_build.sh first. Also: pip install lizard
#
# --hook adapts the exit codes for a Stop hook, where 2 blocks the agent:
#   no C/C++ touched -> 0 immediately, so a plain conversation costs ~10ms
#   over budget, or coverage data missing/stale -> 2, with an actionable message
# Without --hook: 0 pass, 1 over budget, 2 tool problem.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK=0
FILTER="."
GCDA_DIR=""
PY_ARGS=()

COV_GCDA_DIR=""; COV_GCOV=""
# shellcheck disable=SC1090
[ -f "$ROOT/.crap.conf" ] && . "$ROOT/.crap.conf"
# Which gcov: --gcov beats $GCOV in the environment beats what cov_build.sh
# recorded (clang -> "llvm-cov gcov", cross toolchain -> its own gcov).
GCOV="${GCOV:-${COV_GCOV:-gcov}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --gcda) GCDA_DIR="$2"; shift 2 ;;
    --gcov) GCOV="$2"; shift 2 ;;
    --hook) HOOK=1; shift ;;
    --filter) FILTER="$2"; PY_ARGS+=(--filter "$2"); shift 2 ;;
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) PY_ARGS+=("$1"); shift ;;
  esac
done
GCDA_DIR="${GCDA_DIR:-${COV_GCDA_DIR:-$ROOT/build-coverage}}"

# A turn that touched no C/C++ inside --filter has nothing to say. Checked before
# any build artifact is read, so plain conversation never pays for the gate and
# can never be blocked by it.
if [ "$HOOK" = 1 ]; then
  # Collect first, match second. Piping straight into `grep -q` lets grep close
  # the pipe on its first hit, git dies of SIGPIPE, and `set -o pipefail` turns
  # that success into a failure -- silently disabling the whole gate.
  CHANGED=$(git -C "$ROOT" status --porcelain \
            -- '*.c' '*.cc' '*.cpp' '*.cxx' '*.h' '*.hpp' 2>/dev/null | cut -c4-)
  grep -qE "$FILTER" <<<"$CHANGED" || exit 0
fi

mapfile -t GCDA < <(find "$GCDA_DIR" -name '*.gcda' 2>/dev/null | sort)
if [ "${#GCDA[@]}" -eq 0 ]; then
  echo "crap.sh: no coverage data under $GCDA_DIR" >&2
  echo "  fix: run $HERE/cov_build.sh" >&2
  exit 2
fi

STDERR=$(mktemp); JSON=$(mktemp)
trap 'rm -f "$STDERR" "$JSON"' EXIT

# One .gcda -> coverage text on stdout. GCC's gcov emits one JSON object per
# .gcda and crap.py splits the stream back apart. llvm-cov has no JSON mode, so
# it runs in intermediate mode from a scratch dir (it writes files, not stdout)
# with a cwd: line in front so crap.py can resolve relative file: paths.
# Either way gcov runs against the .gcda's own directory to find its .gcno.
dump_one() {
  local f="$1" dir; dir="$(dirname "$f")"
  case "$GCOV" in
    *llvm-cov*)
      local tmp; tmp=$(mktemp -d)
      (cd "$tmp" && $GCOV -b -i "$f" >/dev/null 2>>"$STDERR")
      echo "cwd:$dir"; cat "$tmp"/*.gcov 2>/dev/null; rm -rf "$tmp" ;;
    *)
      (cd "$dir" && $GCOV -b --json-format --stdout "$(basename "$f")" 2>>"$STDERR") ;;
  esac
}
for f in "${GCDA[@]}"; do dump_one "$f"; done > "$JSON"

# A .gcno rewritten by a recompile no longer matches an older .gcda. gcov warns
# on stderr and then reports 0% for the whole file -- which inflates CRAP by
# several times and sends you off writing tests that were never missing.
if grep -q 'stamp mismatch' "$STDERR"; then
  echo "crap.sh: stale coverage data -- recompiled without re-running the tests:" >&2
  grep 'stamp mismatch' "$STDERR" | sed 's/^/  /' >&2
  echo "  fix: rerun $HERE/cov_build.sh" >&2
  exit 2
fi

python3 "$HERE/crap.py" --root "$ROOT" "${PY_ARGS[@]}" < "$JSON"
rc=$?
# crap.py: 0 clean, 1 over budget, 2 nothing matched --filter. Under --hook only
# a real overage may block; "nothing matched" is not the agent's problem.
if [ "$HOOK" = 1 ]; then
  [ "$rc" = 1 ] && exit 2
  exit 0
fi
exit $rc
