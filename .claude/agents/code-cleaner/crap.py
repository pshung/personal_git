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
from collections import defaultdict, namedtuple

import lizard

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cognitive  # noqa: E402  (lives next to this file)


class FileCoverage:
    """Execution counts per line and branch outcomes per line for one source
    file, summed over every .gcda that compiled it."""

    def __init__(self):
        self.lines = defaultdict(int)
        self.branches = defaultdict(list)   # line -> [count per non-throw edge]

    def add_line(self, line, count, branches=()):
        self.lines[line] += count
        # C++ exception edges are not decisions the code makes; gcov flags them.
        edges = [b["count"] for b in branches if not b.get("throw")]
        have = self.branches[line] if edges else []
        for i, c in enumerate(edges):
            if i < len(have):
                have[i] += c        # same line, another binary: same edge order
            else:
                have.append(c)


def read_coverage(stream):
    """stdin -> {abs_source_path: FileCoverage}, whichever gcov wrote it.

    Counts are summed across every .gcda, so one header compiled into several
    binaries (the unit test and the real sim) merges into a single picture.
    """
    text = stream.read()
    if text.lstrip().startswith("{"):
        return read_gcov_json(text)
    return read_intermediate(text)


def read_gcov_json(text):
    """GCC: `gcov -b --json-format --stdout`, one object per .gcda. Without -b
    the branch lists are empty and coverage falls back to executed lines."""
    counts = defaultdict(FileCoverage)
    for chunk in text.split("\n{"):
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
                counts[path].add_line(line["line_number"], line["count"],
                                      line.get("branches", ()))
    return counts


def read_intermediate(text):
    """Clang: `llvm-cov gcov -b -i`, which has no JSON mode. One block per .gcda:

        cwd:<dir>                        added by crap.sh: where file: resolves
        file:<path>
        lcount:<line>,<count>
        branch:<line>,taken|nottaken|notexec

    Each block is buffered and handed to FileCoverage line by line, so a header
    seen from two binaries merges edge-by-edge exactly like the JSON path.
    """
    counts = defaultdict(FileCoverage)
    cwd, path, block = ".", None, {}

    def flush():
        for ln, (count, edges) in block.items():
            counts[path].add_line(ln, count, [{"count": c} for c in edges])
        block.clear()

    for raw in text.splitlines():
        key, _, val = raw.partition(":")
        if key == "cwd":
            cwd = val
        elif key == "file":
            if path:
                flush()
            path = os.path.normpath(os.path.join(cwd, val))
        elif key == "lcount" and path:
            ln, count = val.split(",")[:2]
            block.setdefault(int(ln), [0, []])[0] += int(count)
        elif key == "branch" and path:
            ln, state = val.split(",")[:2]
            block.setdefault(int(ln), [0, []])[1].append(1 if state == "taken" else 0)
    if path:
        flush()
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


# SonarSource's default per-function threshold. Below it a reader can hold the
# function in their head, whatever CC says about the number of case labels.
COG_FLAT = 15


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


def coverage_of(cov, start, end):
    """(coverage_fraction, had_any_instrumented_line) over an inclusive range.

    Branch outcomes when the range has any, executed lines otherwise: a
    straight-line function has no decisions to cover, only "did it run".
    """
    span = range(start, end + 1)
    edges = [c for ln in span for c in cov.branches.get(ln, ())]
    if edges:
        return sum(1 for c in edges if c > 0) / len(edges), True
    executable = [ln for ln in span if ln in cov.lines]
    if not executable:
        return 0.0, False
    return sum(1 for ln in executable if cov.lines[ln] > 0) / len(executable), True


SOURCE_EXTS = (".c", ".cc", ".cpp", ".cxx", ".h", ".hpp")


def is_git_repo(root):
    return subprocess.run(["git", "-C", root, "rev-parse", "--is-inside-work-tree"],
                          capture_output=True, text=True).returncode == 0


def all_sources(root):
    """Every C/C++ file under root: tracked + untracked when git is there,
    a plain filesystem walk when it is not (--all is how non-git projects
    get gated at all)."""
    if is_git_repo(root):
        listed = subprocess.run(
            ["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard"],
            capture_output=True, text=True).stdout.split()
        return [os.path.join(root, rel) for rel in listed if rel.endswith(SOURCE_EXTS)]
    found = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        found += [os.path.join(dirpath, f) for f in files if f.endswith(SOURCE_EXTS)]
    return found


def nothing_to_gate(reason):
    """An empty gated set is a tool problem, never a pass: nothing was scored,
    so exit 0 here would let the caller report "gate passed" on zero evidence."""
    print(f"crap: nothing to gate - {reason}.\n"
          f"  already committed the work?  --diff HEAD~1 (or HEAD~N)\n"
          f"  want every function scored?  --all", file=sys.stderr)
    return 2


def parse_args():
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
    ap.add_argument("--all", action="store_true",
                    help="stage 1 (alternative): gate every function under --filter. "
                         "The only selector that works without git history.")
    ap.add_argument("--max", type=float, default=30.0,
                    help="stage 2: fail if a gated function scores above this")
    ap.add_argument("--top", type=int, default=15, help="rows to print")
    ap.add_argument("--json", action="store_true",
                    help="print one JSON object instead of the table, for graders and hooks")
    args = ap.parse_args()
    if args.all:
        args.diff, args.min_churn = None, None
    elif args.min_churn is None and args.diff is None:
        args.diff = "HEAD"
    return args


# Stage 1 as data: how a row earns its place in the gated set, and the column
# that shows the reader why it is there.
Stage1 = namedtuple("Stage1", "why column gate scan_all")


def stage1(args):
    if args.all:
        return Stage1("all functions under --filter", "nloc", lambda r: True, True)
    if args.min_churn is not None:
        return Stage1(f"touched by >= {args.min_churn} commits", "churn",
                      lambda r: r["churn"] >= args.min_churn, True)
    return Stage1(f"changed vs {args.diff}", "newln", lambda r: r["newln"] > 0, False)


def select_sources(args, counts, touched, scan_all):
    """Source files come from two places, and the second one is the important
    half: a file that no test ever compiled produces no .gcda at all, so if we
    only trusted gcov's file list, brand-new untested code -- exactly what this
    gate exists to catch -- would silently vanish instead of scoring CC^2 + CC."""
    keep, drop = re.compile(args.filter), re.compile(args.exclude)
    candidates = set(counts)
    candidates.update(os.path.join(args.root, rel) for rel in touched)
    if scan_all:
        candidates.update(all_sources(args.root))
    return sorted(p for p in candidates
                  if p.endswith(SOURCE_EXTS) and keep.search(p)
                  and not drop.search(p) and os.path.exists(p))


def score_file(root, path, cov, touched_lines, want_churn, budget):
    rel = os.path.relpath(path, root)
    rows = []
    for fn in lizard.analyze_file(path).function_list:
        c, has_data = coverage_of(cov, fn.start_line, fn.end_line)
        span = range(fn.start_line, fn.end_line + 1)
        score = crap(fn.cyclomatic_complexity, c)
        rows.append({
            "file": rel, "name": fn.name, "line": fn.start_line, "end": fn.end_line,
            "churn": churn(root, rel, fn.start_line, fn.end_line) if want_churn else 0,
            "newln": len(touched_lines.intersection(span)),
            "cc": fn.cyclomatic_complexity, "nloc": fn.nloc,
            "cov": c, "crap": score, "over": score > budget,
            "has_data": has_data,
        })
    return rows


def add_cognitive(rows, root):
    """r["cog"] for every row, one clang-tidy run per file. None when the tool
    is missing, which is said once so the "-" column is not a mystery."""
    by_file = defaultdict(list)
    for r in rows:
        by_file[r["file"]].append(r)
    missing = False
    for rel, group in by_file.items():
        scores = cognitive.cognitive_complexity(os.path.join(root, rel), root)
        missing |= scores is None
        for r in group:
            r["cog"] = cognitive.score_for(scores, r["line"], r["end"])
    if missing:
        print("crap: clang-tidy not found - the cog column is unavailable "
              "(install clang-tidy to get cognitive complexity)", file=sys.stderr)


def fix_for(r, budget):
    """Say what to DO. Adding tests only helps while coverage is the binding
    constraint; past CC == budget no amount of testing can reach it -- and then
    cognitive complexity decides whether splitting would even help."""
    need = needed_coverage(r["cc"], budget)
    cog = r.get("cog")
    if need is not None:
        hint = f" (cognitive={cog}: nested - a split would help too)" \
            if cog is not None and cog > COG_FLAT else ""
        return f"ADD TESTS: {r['cov'] * 100:.0f}% -> {need * 100:.0f}% coverage needed{hint}"
    if cog is not None and cog <= COG_FLAT:
        return (f"FLAT: CC={r['cc']} but cognitive={cog} - case labels or guard clauses, "
                f"not a tangle. Do not split it; cover what is cheap and report it as left alone")
    return f"SPLIT IT: CC={r['cc']} alone exceeds {budget:g}; tests cannot lower this (cognitive={cog})"


def print_table(rows, gated, n_files, s1, args):
    print(f"stage 1: {len(rows)} functions in {n_files} file(s); "
          f"{len(gated)} {s1.why} -> gated")
    print(f"stage 2: CRAP over the gated set, budget {args.max:g}\n")
    print(f"{'CRAP':>6} {s1.column:>6} {'CC':>4} {'cog':>4} {'cov':>7}  function")
    print("-" * 78)
    for r in gated[: args.top]:
        note = "" if r["has_data"] else "  (no coverage data)"
        cog = "-" if r["cog"] is None else r["cog"]
        print(f"{r['crap']:>6.0f} {r[s1.column]:>6} {r['cc']:>4} {cog:>4} "
              f"{r['cov'] * 100:>6.1f}%  {r['name']}")
        print(f"{'':>6} {'':>6} {'':>4} {'':>4} {'':>7}  {r['file']}:{r['line']}{note}")
    print("-" * 78)
    print(f"{len(gated)} gated, {sum(r['over'] for r in gated)} over budget "
          f"({len(rows) - len(gated)} not gated)")


def print_json(gated, args):
    print(json.dumps({"budget": args.max, "gated": gated,
                      "over": sum(r["over"] for r in gated)}, indent=1))


def print_failures(over, s1, args):
    print(f"\nFAIL: {len(over)} function(s) over CRAP {args.max:g}", file=sys.stderr)
    for r in over:
        print(f"  {r['file']}:{r['line']}  {r['name']}  CRAP={r['crap']:.0f} "
              f"{s1.column}={r[s1.column]}  {fix_for(r, args.max)}", file=sys.stderr)


def main():
    args = parse_args()
    if not args.all and not is_git_repo(args.root):
        print(f"crap: {args.root} is not a git repository, so --diff/--min-churn "
              f"have no history to select functions from.\n"
              f"  fix: pass --all to gate every function under --filter", file=sys.stderr)
        return 2

    counts = read_coverage(sys.stdin)
    touched = changed_lines(args.root, args.diff) if args.diff else {}
    if args.diff and not touched:
        return nothing_to_gate(f"no line changed vs {args.diff}")

    s1 = stage1(args)
    sources = select_sources(args, counts, touched, s1.scan_all)
    if not sources:
        print("crap: no source files matched --filter", file=sys.stderr)
        return 2

    rows = []
    for path in sources:
        rel = os.path.relpath(path, args.root)
        rows += score_file(args.root, path, counts[path], touched.get(rel, set()),
                           s1.column == "churn", args.max)
    gated = sorted(filter(s1.gate, rows), key=lambda r: (-r["crap"], -r[s1.column]))
    if not gated:
        return nothing_to_gate(f"{len(rows)} function(s) found, none {s1.why}")
    add_cognitive(gated, args.root)

    if args.json:
        print_json(gated, args)
    else:
        print_table(rows, gated, len(sources), s1, args)
    sys.stdout.flush()

    over = [r for r in gated if r["over"]]
    if not over:
        return 0
    print_failures(over, s1, args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
