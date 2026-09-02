#!/usr/bin/env bash
# cc.sh -- complexity of the functions in one file, no build needed.
#
# Two numbers per function:
#   CC   cyclomatic (lizard)      how many paths there are - drives CRAP
#   cog  cognitive (clang-tidy)   how hard they are to follow - nesting costs,
#                                 a flat switch or guard chain does not
# High CC with low cog is a lookup table or a guard run: leave it. High cog is
# the tangle worth splitting. The column shows "-" if clang-tidy is missing.
#
# Usage:
#   cc.sh <file> [function-pattern]
#
#   cc.sh src/parser.cpp                 # every function, most complex first
#   cc.sh src/parser.cpp parse_header    # just the ones matching
#   cc.sh src/parser.cpp 'parse_.*'      # pattern is a case-insensitive regex
#
# CC works on any language lizard supports (C/C++, Python, Java, JS/TS, Go,
# Rust, ...); cog is C/C++ only.
#
# Needs: pip install lizard;  clang-tidy for the cog column
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -ge 1 ] || { sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 2; }
[ -f "$1" ] || { echo "cc.sh: no such file: $1" >&2; exit 2; }

HERE="$HERE" FILE="$1" PATTERN="${2:-}" \
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" python3 - <<'PY'
import os, re, sys

try:
    import lizard
except ImportError:
    sys.exit("cc.sh: lizard is not installed -- run: python3 -m pip install lizard")
sys.path.insert(0, os.environ["HERE"])
import cognitive

path, pattern, root = os.environ["FILE"], os.environ["PATTERN"], os.environ["ROOT"]
rx = re.compile(pattern, re.IGNORECASE) if pattern else None

fns = [f for f in lizard.analyze_file(path).function_list
       if rx is None or rx.search(f.name)]
if not fns:
    print(f"cc.sh: no function matches '{pattern}' in {path}", file=sys.stderr)
    sys.exit(1)

is_c_family = path.endswith((".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"))
scores = cognitive.cognitive_complexity(path, root) if is_c_family else None
if is_c_family and scores is None:
    print("cc.sh: clang-tidy not found - cog column unavailable", file=sys.stderr)


def budget_hint(cc):
    """Coverage this CC needs to land at CRAP 30, so the number is actionable."""
    if cc <= 5:
        return "ok untested"
    if cc > 30:
        return "OVER: split it"
    return f"needs {(1 - ((30 - cc) / (cc * cc)) ** (1 / 3)) * 100:.0f}% cov"


fns.sort(key=lambda f: -f.cyclomatic_complexity)
print(f"{'CC':>4} {'cog':>4} {'NLOC':>5} {'params':>6}  {'lines':>13}  {'to hit CRAP 30':<15} function")
print("-" * 97)
for f in fns:
    cog = cognitive.score_for(scores, f.start_line, f.end_line)
    span = f"{f.start_line}-{f.end_line}"
    print(f"{f.cyclomatic_complexity:>4} {'-' if cog is None else cog:>4} {f.nloc:>5} "
          f"{f.parameter_count:>6}  {span:>13}  {budget_hint(f.cyclomatic_complexity):<15} {f.name}")
print("-" * 97)
print(f"{len(fns)} function(s) in {path}")
PY
