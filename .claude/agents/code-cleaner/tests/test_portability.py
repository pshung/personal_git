import os
import re
import unittest

from helpers import AGENT_DIR

SKIP_DIRS = {".git", "build-coverage", "__pycache__"}


def agent_files():
    for dirpath, dirnames, files in os.walk(AGENT_DIR):
        rel = os.path.relpath(dirpath, AGENT_DIR)
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not d.startswith("baseline-")]
        for f in files:
            if f.endswith((".md", ".sh", ".py", ".json")) and rel != "evals/fixtures":
                yield os.path.join(dirpath, f)


class NoUserSpecificPaths(unittest.TestCase):
    """The agent must work from any checkout: tools locate each other relative
    to their own file, and the prompt refers to ~/.claude, never one user's home.
    Baseline result records are history and exempt."""

    def test_no_absolute_home_directory_anywhere(self):
        hits = []
        for path in agent_files():
            with open(path, errors="ignore") as fh:
                for n, line in enumerate(fh, 1):
                    if re.search(r"/home/[a-z]", line):
                        hits.append(f"{os.path.relpath(path, AGENT_DIR)}:{n}: {line.strip()[:80]}")
        self.assertEqual(hits, [], "\n".join(hits))


if __name__ == "__main__":
    unittest.main()
