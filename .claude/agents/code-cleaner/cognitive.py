#!/usr/bin/env python3
"""Cognitive complexity per function, via clang-tidy.

Cyclomatic complexity counts decisions; cognitive complexity (SonarSource,
2017) counts how hard they are to follow. Nesting is penalised, a flat `switch`
costs 1 however many cases it has, a run of `&&` costs 1. So CC 41 with
cognitive 1 is a lookup table, and CC 16 with cognitive 22 is a tangle -- the
call that cc-judgment.md otherwise asks you to make by counting lines by hand.

    cognitive_complexity(path, root) -> {function_start_line: score} | None

Functions scoring 0 are absent. None means clang-tidy is not installed.

Compile flags come from the compile_commands.json a build left behind
(build-coverage/, build/, or the root) when the file is in it; otherwise from a
small guess that is enough to parse most files on their own. clang recovers
from a missing header and still scores every function body it can see.

Usage as a tool:  cognitive.py <file> [root]
"""
import json
import os
import re
import shutil
import subprocess
import sys

CHECK = "readability-function-cognitive-complexity"
_WARNING = re.compile(r"^.*?:(\d+):\d+: warning: function '.*' has cognitive complexity of (\d+)",
                      re.MULTILINE)


def find_compile_db(root):
    for sub in ("build-coverage", "build", "."):
        d = os.path.join(root, sub)
        if os.path.isfile(os.path.join(d, "compile_commands.json")):
            return d
    return None


def in_compile_db(db_dir, path):
    try:
        with open(os.path.join(db_dir, "compile_commands.json")) as fh:
            entries = json.load(fh)
    except (OSError, ValueError):
        return False
    want = os.path.abspath(path)
    return any(os.path.abspath(os.path.join(e.get("directory", db_dir), e["file"])) == want
               for e in entries if "file" in e)


def fallback_flags(path, root):
    is_c = path.endswith(".c")
    flags = ["-x", "c" if is_c else "c++", "-std=c11" if is_c else "-std=c++17"]
    for inc in (os.path.dirname(path), root, os.path.join(root, "include"),
                os.path.join(root, "src")):
        if os.path.isdir(inc):
            flags += ["-I", inc]
    return flags


def cognitive_complexity(path, root=None, tool="clang-tidy"):
    if shutil.which(tool) is None:
        return None
    path = os.path.abspath(path)
    root = os.path.abspath(root or os.path.dirname(path))
    cmd = [tool, f"-checks=-*,{CHECK}",
           f"-config={{CheckOptions: {{{CHECK}.Threshold: 0}}}}", path]
    db = find_compile_db(root)
    if db and in_compile_db(db, path):
        cmd += ["-p", db]
    else:
        cmd += ["--"] + fallback_flags(path, root)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    return {int(m.group(1)): int(m.group(2)) for m in _WARNING.finditer(out)}


def score_for(scores, start, end):
    """The score of the function spanning start..end. clang-tidy reports the
    line of the function's name, which is normally lizard's start line; when a
    decorated declaration puts them a line apart, the span still finds it."""
    if scores is None:
        return None
    if start in scores:
        return scores[start]
    return next((scores[ln] for ln in range(start, end + 1) if ln in scores), 0)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    result = cognitive_complexity(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    if result is None:
        sys.exit("cognitive.py: clang-tidy is not installed")
    for line, score in sorted(result.items()):
        print(f"{score:>4}  {sys.argv[1]}:{line}")
