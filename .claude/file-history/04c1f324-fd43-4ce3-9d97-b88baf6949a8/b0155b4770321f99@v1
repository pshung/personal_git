#!/usr/bin/env python3
"""Two-stage risk gate: rank functions by importance, then CRAP-gate the top.

  Stage 1  IMPORTANCE = churn, the number of commits that touched the
           function's lines (`git log -L start,end:file`). Code that keeps
           changing is where bugs live. Needs no build -- lizard supplies the
           function boundaries, git supplies the count.

  Stage 2  RISK = CRAP(f) = CC(f)^2 * (1 - coverage(f))^3 + CC(f), computed
           ONLY for the functions stage 1 kept. Needs a --coverage build that
           has been run.

Why two stages: gating every function punishes harmless code. A 70-case switch
lookup table scores CC=70 and can never pass, but if nobody ever edits it, it
is not where the bugs are. Churn filters it out before it wastes anyone's time.

Input  : `gcov --json-format --stdout` output on stdin, one object per .gcda.
Output : a table, and exit 1 if any GATED function is over --max.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

import lizard


def read_gcov_json(stream):
    """stdin -> {abs_source_path: {line_number: total_execution_count}}.

    Counts are summed across every .gcda, so one header compiled into several
    binaries (the unit test and the real sim) merges into a single picture.
    """
    counts = defaultdict(lambda: defaultdict(int))
    for chunk in stream.read().split("\n{"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if not chunk.startswith("{"):
            chunk = "{" + chunk
        try:
            doc = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        cwd = doc.get("current_working_directory", ".")
        for entry in doc.get("files", []):
            path = os.path.normpath(os.path.join(cwd, entry["file"]))
            for line in entry.get("lines", []):
                counts[path][line["line_number"]] += line["count"]
    return counts


def churn(repo, relpath, start, end):
    """Commits that touched these lines. Verify by hand with:
        git -C <repo> log --oneline -L <start>,<end>:<relpath>
    """
    out = subprocess.run(
        ["git", "-C", repo, "log", "--format=%H", f"-L{start},{end}:{relpath}"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return 0
    return sum(1 for ln in out.stdout.splitlines() if re.fullmatch(r"[0-9a-f]{40}", ln))


def changed_lines(repo, ref):
    """{relpath: set(line numbers)} for lines added/changed vs `ref`.

    This is the stage-1 selector for NEW code: churn cannot rank a function
    written five minutes ago, but the diff knows exactly which lines an agent
    just touched. Untracked files count whole -- every line is new.

    Verify by hand with:  git -C <repo> diff --unified=0 <ref>
    """
    changed = defaultdict(set)
    diff = subprocess.run(
        ["git", "-C", repo, "diff", "--unified=0", ref],
        capture_output=True, text=True,
    ).stdout
    path = None
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("@@") and path:
            # @@ -old,n +new,m @@  -- we only care about the new-side range.
            m = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if m:
                start, count = int(m.group(1)), int(m.group(2) or 1)
                changed[path].update(range(start, start + count))

    untracked = subprocess.run(
        ["git", "-C", repo, "ls-files", "--others", "--exclude-standard"],
        capture_output=True, text=True,
    ).stdout.split()
    for rel in untracked:
        full = os.path.join(repo, rel)
        if os.path.isfile(full):
            try:
                with open(full, errors="ignore") as fh:
                    changed[rel].update(range(1, sum(1 for _ in fh) + 1))
            except OSError:
                pass
    return changed


def crap(cc, coverage):
    return cc * cc * (1.0 - coverage) ** 3 + cc


def needed_coverage(cc, target):
    """Coverage that would bring CRAP down to `target`, or None if unreachable.

    Solving cc^2 * (1-c)^3 + cc = target gives c = 1 - cbrt((target-cc)/cc^2).
    At coverage 1.0 CRAP equals CC, so cc >= target can never pass: the only
    remaining fix is to split the function.
    """
    if cc >= target:
        return None
    return 1.0 - ((target - cc) / (cc * cc)) ** (1.0 / 3.0)


def coverage_of(line_counts, start, end):
    """(coverage_fraction, had_any_instrumented_line) over an inclusive range."""
    executable = [ln for ln in range(start, end + 1) if ln in line_counts]
    if not executable:
        return 0.0, False
    covered = [ln for ln in executable if line_counts[ln] > 0]
    return len(covered) / len(executable), True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.getcwd(),
                    help="source repo root; also the git repo churn is read from")
    ap.add_argument("--filter", default=".", help="regex on source path: what to consider")
    ap.add_argument("--exclude", default=r"/external/|\.test\.cpp$|/tests?/",
                    help="regex on source path: what to drop")
    ap.add_argument("--diff", nargs="?", const="HEAD", metavar="REF",
                    help="stage 1 (default): gate only functions changed vs REF. "
                         "Bare --diff means HEAD, i.e. the uncommitted work an "
                         "agent just wrote. Use this for NEW code.")
    ap.add_argument("--min-churn", type=int, metavar="N",
                    help="stage 1 (alternative): gate functions touched by >= N "
                         "commits. Use this to audit EXISTING code; churn cannot "
                         "rank a function that was written five minutes ago.")
    ap.add_argument("--max", type=float, default=30.0,
                    help="stage 2: fail if a gated function scores above this")
    ap.add_argument("--top", type=int, default=15, help="rows to print")
    args = ap.parse_args()
    if args.min_churn is None and args.diff is None:
        args.diff = "HEAD"

    counts = read_gcov_json(sys.stdin)
    touched = changed_lines(args.root, args.diff) if args.diff else {}

    # Source files come from two places, and the second one is the important
    # half: a file that no test ever compiled produces no .gcda at all, so if we
    # only trusted gcov's file list, brand-new untested code -- exactly what this
    # gate exists to catch -- would silently vanish instead of scoring CC^2 + CC.
    keep, drop = re.compile(args.filter), re.compile(args.exclude)
    candidates = set(counts)
    candidates.update(os.path.join(args.root, rel) for rel in touched)
    if args.min_churn is not None:
        tracked = subprocess.run(
            ["git", "-C", args.root, "ls-files",
             "*.c", "*.cc", "*.cpp", "*.cxx", "*.h", "*.hpp"],
            capture_output=True, text=True).stdout.split()
        candidates.update(os.path.join(args.root, rel) for rel in tracked)

    sources = sorted(
        p for p in candidates
        if p.endswith((".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"))
        and keep.search(p) and not drop.search(p) and os.path.exists(p))
    if not sources:
        print("crap: no source files matched --filter", file=sys.stderr)
        return 2

    rows = []
    for path in sources:
        rel = os.path.relpath(path, args.root)
        for fn in lizard.analyze_file(path).function_list:
            cov, has_data = coverage_of(counts[path], fn.start_line, fn.end_line)
            span = range(fn.start_line, fn.end_line + 1)
            rows.append({
                "file": rel, "name": fn.name, "line": fn.start_line,
                "churn": churn(args.root, rel, fn.start_line, fn.end_line)
                         if args.min_churn is not None else 0,
                "changed": len(touched.get(rel, set()).intersection(span)),
                "cc": fn.cyclomatic_complexity, "nloc": fn.nloc,
                "cov": cov, "crap": crap(fn.cyclomatic_complexity, cov),
                "has_data": has_data,
            })

    if args.min_churn is not None:
        gated = [r for r in rows if r["churn"] >= args.min_churn]
        why = f"touched by >= {args.min_churn} commits"
        rank = "churn"
    else:
        gated = [r for r in rows if r["changed"] > 0]
        why = f"changed vs {args.diff}"
        rank = "changed"
    gated.sort(key=lambda r: (-r["crap"], -r[rank]))

    print(f"stage 1: {len(rows)} functions in {len(sources)} file(s); "
          f"{len(gated)} {why} -> gated")
    print(f"stage 2: CRAP over the gated set, budget {args.max:g}\n")
    label = "churn" if rank == "churn" else "newln"
    print(f"{'CRAP':>6} {label:>6} {'CC':>4} {'cov':>7}  function")
    print("-" * 78)
    for r in gated[: args.top]:
        note = "" if r["has_data"] else "  (no coverage data)"
        print(f"{r['crap']:>6.0f} {r[rank]:>6} {r['cc']:>4} {r['cov'] * 100:>6.1f}%  {r['name']}")
        print(f"{'':>6} {'':>6} {'':>4} {'':>7}  {r['file']}:{r['line']}{note}")

    over = [r for r in gated if r["crap"] > args.max]
    print("-" * 78)
    print(f"{len(gated)} gated, {len(over)} over budget "
          f"({len(rows) - len(gated)} not gated)")
    sys.stdout.flush()
    if not over:
        return 0

    # Say what to DO. Adding tests only helps while coverage is the binding
    # constraint; past CC == --max no amount of testing can reach the budget.
    print(f"\nFAIL: {len(over)} function(s) over CRAP {args.max:g}", file=sys.stderr)
    for r in over:
        need = needed_coverage(r["cc"], args.max)
        fix = (f"SPLIT IT: CC={r['cc']} alone exceeds {args.max:g}; tests cannot lower this"
               if need is None else
               f"ADD TESTS: {r['cov'] * 100:.0f}% -> {need * 100:.0f}% coverage needed")
        print(f"  {r['file']}:{r['line']}  {r['name']}  "
              f"CRAP={r['crap']:.0f} {label}={r[rank]}  {fix}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
