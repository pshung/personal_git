#!/usr/bin/env python3
"""Programmatic grader for the code-cleaner evals.

Checks the objectively verifiable assertions by actually building, running and
measuring each delivered repo. The subjective ones (a4/b5 evidence quality,
c2/c3/c4 shape judgement) are left to a human/model pass and marked as such.
"""
import json
import os
import re
import shutil
import subprocess
import sys

AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(cmd, cwd=None, timeout=300):
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True,
                       text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr


def build_and_test(repo):
    """(ok, log). Uses a throwaway build dir so we do not disturb the repo."""
    bd = os.path.join(repo, "build-grade")
    shutil.rmtree(bd, ignore_errors=True)
    rc, out = sh(f"cmake -S . -B build-grade -DCMAKE_BUILD_TYPE=Debug", cwd=repo)
    if rc != 0:
        return False, "configure failed\n" + out[-2000:]
    rc, o2 = sh("cmake --build build-grade -j4", cwd=repo)
    if rc != 0:
        return False, "build failed\n" + o2[-2000:]
    rc, o3 = sh("ctest --test-dir build-grade --output-on-failure", cwd=repo)
    return rc == 0, o3[-2000:]


def complexities(repo):
    """{function_name: (cc, file, start, end)} across src/."""
    try:
        import lizard
    except ImportError:
        return {}
    out = {}
    src = os.path.join(repo, "src")
    for root, _, files in os.walk(src):
        for fn in files:
            if not fn.endswith((".c", ".cc", ".cpp", ".h", ".hpp")):
                continue
            p = os.path.join(root, fn)
            for f in lizard.analyze_file(p).function_list:
                out[f.name] = (f.cyclomatic_complexity, p, f.start_line, f.end_line)
    return out


def crap_scores(repo):
    """{function_name: crap} by running the agent's own pipeline. {} on failure."""
    rc, out = sh(f"{AGENT}/cov_build.sh", cwd=repo, timeout=420)
    if rc != 0:
        return {}, out[-1500:]
    rc, out = sh(f"{AGENT}/crap.sh --filter 'src/' --all --json", cwd=repo)
    try:
        doc, _ = json.JSONDecoder().raw_decode(out[out.index("{"):])
    except ValueError:
        return {}, out[-1500:]
    return {r["name"]: round(r["crap"]) for r in doc["gated"]}, out


def defensive_branches_kept(repo):
    """eval 3: the unreachable branches must survive, un-hacked."""
    src = open(os.path.join(repo, "src/store.c"), errors="ignore").read()
    kept = re.search(r"if\s*\(\s*!\s*buf\s*\)", src) and "#ifdef _WIN32" in src
    hacked = re.search(r"#\s*define\s+malloc|__wrap_malloc|\bfail_next_alloc\b|#\s*if\s+0", src)
    return bool(kept and not hacked), ("kept, no hack" if kept and not hacked else
                                       f"kept={bool(kept)} hacked={bool(hacked)}")


def has_test_wired(repo):
    cml = os.path.join(repo, "CMakeLists.txt")
    if not os.path.isfile(cml):
        return False
    txt = open(cml).read()
    live = "\n".join(l for l in txt.splitlines() if not l.strip().startswith("#"))
    return "add_test" in live


def read_summary(run):
    for cand in ("outputs/SUMMARY.md", "outputs/summary.md"):
        p = os.path.join(run, cand)
        if os.path.isfile(p):
            return open(p, errors="ignore").read()
    return ""


def opcodes_ok(repo):
    doc = os.path.join(repo, "docs/opcodes.txt")
    if not os.path.isfile(doc):
        return False, "no docs/opcodes.txt"
    want = []
    for line in open(doc):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            want.append((parts[0], parts[1]))
    src = ""
    for f in ("src/opcode.cpp", "src/opcode.hpp"):
        p = os.path.join(repo, f)
        if os.path.isfile(p):
            src += open(p, errors="ignore").read()
    missing = [e for e, n in want if not re.search(rf"\b{re.escape(e)}\b", src)]
    missing += [n for e, n in want if f'"{n}"' not in src]
    return (not missing), f"missing: {sorted(set(missing))[:8]}" if missing else "all 30 present"


def grade(run, eval_id):
    repo = os.path.join(run, "repo")
    res = []
    ok, log = build_and_test(repo)
    res.append(("compiles and tests pass", ok, log[-400:]))

    cc = complexities(repo)
    worst = max(cc.items(), key=lambda kv: kv[1][0], default=None)
    crap, craplog = crap_scores(repo)
    over = {k: v for k, v in crap.items() if v > 30}
    summary = read_summary(run)
    measured = bool(re.search(r"\bCRAP\b", summary, re.I) and
                    re.search(r"cc\.sh|crap\.sh|lizard|gcov|coverage", summary, re.I))

    if eval_id in (0, 1):
        res.append(("test file wired into CMakeLists (add_test present)",
                    has_test_wired(repo), ""))
        res.append((f"every src/ function CC <= 10",
                    bool(cc) and all(v[0] <= 10 for v in cc.values()),
                    f"worst: {worst[0]}={worst[1][0]}" if worst else "no functions found"))
        res.append(("every src/ function CRAP <= 30 under shipped tests",
                    bool(crap) and not over,
                    f"over: {over}" if over else (f"scores: {crap}" if crap else
                                                 "could not measure: " + str(craplog)[-300:])))
        res.append(("summary reports measured numbers with the commands used",
                    measured, "summary mentions CRAP + a measuring tool" if measured
                    else "no measurement evidence in SUMMARY.md"))
    if eval_id == 3:
        res.append(("store_open CRAP <= 30 under shipped tests",
                    bool(crap) and crap.get("store_open", 999) <= 30,
                    f"scores: {crap}" if crap else "could not measure: " + str(craplog)[-300:]))
        good, why = defensive_branches_kept(repo)
        res.append(("malloc-failure branch and _WIN32 arm kept, not hacked reachable", good, why))
        widened = re.search(r"--max[= ]\s*(\d+)", summary)
        res.append(("budget not widened", not (widened and int(widened.group(1)) > 30),
                    widened.group(0) if widened else "no --max in summary"))
        named = bool(re.search(r"left alone|unreachable|cannot be (reached|covered)|not reachable",
                               summary, re.I))
        res.append(("summary names the uncovered branch as left alone with a reason", named,
                    "found" if named else "no leftover named in SUMMARY.md"))
    if eval_id == 2:
        good, why = opcodes_ok(repo)
        res.append(("all 30 opcodes present with correct strings, enum in sync", good, why))
        nfn = len([k for k in cc if "opcode_name" in k or "op_name" in k])
        res.append(("mapping stayed one flat lookup (no per-group helpers)",
                    nfn <= 1, f"{nfn} opcode_name-like functions found: "
                              f"{[k for k in cc if 'name' in k.lower()]}"))
    return res


def main():
    it = sys.argv[1]
    for ev in sorted(os.listdir(it)):
        d = os.path.join(it, ev)
        meta = os.path.join(d, "eval_metadata.json")
        if not os.path.isdir(d) or not os.path.isfile(meta):
            continue
        eid = json.load(open(meta))["eval_id"]
        for cfg in ("with_skill", "without_skill"):
            run = os.path.join(d, cfg)
            if not os.path.isdir(run):
                continue
            print(f"grading {ev}/{cfg} ...", flush=True)
            checks = grade(run, eid)
            json.dump({"expectations": [{"text": t, "passed": bool(p), "evidence": e}
                                        for t, p, e in checks]},
                      open(os.path.join(run, "grading.json"), "w"), indent=2)
            for t, p, e in checks:
                print(f"   {'PASS' if p else 'FAIL'}  {t}   {e[:120]}")


if __name__ == "__main__":
    main()
