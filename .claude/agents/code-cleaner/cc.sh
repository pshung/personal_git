#!/usr/bin/env bash
# cc.sh -- cyclomatic complexity of the functions in one file.
#
# Needs no build and no coverage data, so run it the moment you finish writing
# a function -- it is the cheapest feedback in the loop.
#
# Usage:
#   cc.sh <file> [function-pattern]
#
#   cc.sh src/parser.cpp                 # every function, most complex first
#   cc.sh src/parser.cpp parse_header    # just the ones matching
#   cc.sh src/parser.cpp 'parse_.*'      # pattern is a case-insensitive regex
#
# Works on any language lizard supports (C/C++, Python, Java, JS/TS, Go, Rust,
# ...), not only C/C++.
#
# Needs: pip install lizard
set -uo pipefail

[ $# -ge 1 ] || { sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 2; }
[ -f "$1" ] || { echo "cc.sh: no such file: $1" >&2; exit 2; }

FILE="$1" PATTERN="${2:-}" python3 - <<'PY'
import os, re, sys

try:
    import lizard
except ImportError:
    sys.exit("cc.sh: lizard is not installed -- run: python3 -m pip install lizard")

path, pattern = os.environ["FILE"], os.environ["PATTERN"]
rx = re.compile(pattern, re.IGNORECASE) if pattern else None

fns = [f for f in lizard.analyze_file(path).function_list
       if rx is None or rx.search(f.name)]
if not fns:
    print(f"cc.sh: no function matches '{pattern}' in {path}", file=sys.stderr)
    sys.exit(1)


def budget_hint(cc):
    """Coverage this CC needs to land at CRAP 30, so the number is actionable."""
    if cc <= 5:
        return "ok untested"
    if cc > 30:
        return "OVER: split it"
    return f"needs {(1 - ((30 - cc) / (cc * cc)) ** (1 / 3)) * 100:.0f}% cov"


fns.sort(key=lambda f: -f.cyclomatic_complexity)
print(f"{'CC':>4} {'NLOC':>5} {'params':>6}  {'lines':>13}  {'to hit CRAP 30':<15} function")
print("-" * 92)
for f in fns:
    span = f"{f.start_line}-{f.end_line}"
    print(f"{f.cyclomatic_complexity:>4} {f.nloc:>5} {f.parameter_count:>6}  "
          f"{span:>13}  {budget_hint(f.cyclomatic_complexity):<15} {f.name}")
print("-" * 92)
print(f"{len(fns)} function(s) in {path}")
PY
