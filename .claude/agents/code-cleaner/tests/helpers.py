"""Shared fixtures for the code-cleaner script tests.

Every test builds its own tiny project under a temp dir, so the tests never
depend on each other or on the eval fixtures.
"""
import os
import subprocess
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(HERE)
CRAP_PY = os.path.join(AGENT_DIR, "crap.py")

# CC 1 (leaf) and CC 6 (tangle) so tests can tell "gated" from "over budget".
SRC_A_C = textwrap.dedent("""\
    int leaf(int x) { return x + 1; }

    int tangle(int a, int b)
    {
      int r = 0;
      for (int i = 0; i < a; i++) {
        if (i % 2) r += 1;
        else if (i % 3) r += 2;
        if (b > i && r > 3) r -= 1;
      }
      return r;
    }
""")


def git(root, *args):
    return subprocess.run(["git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t",
                           *args], capture_output=True, text=True, check=True)


def make_project(commit=True, git_init=True):
    """A temp project with src/a.c. Returns its root. Caller removes it."""
    root = tempfile.mkdtemp(prefix="crap-test-")
    os.makedirs(os.path.join(root, "src"))
    with open(os.path.join(root, "src", "a.c"), "w") as fh:
        fh.write(SRC_A_C)
    if git_init:
        git(root, "init", "-q")
        if commit:
            git(root, "add", "-A")
            git(root, "commit", "-qm", "init")
    return root


def run_crap(root, *args, stdin=""):
    """Run crap.py the way crap.sh does: gcov JSON on stdin, --root given."""
    return subprocess.run(["python3", CRAP_PY, "--root", root, *args],
                          input=stdin, capture_output=True, text=True)
