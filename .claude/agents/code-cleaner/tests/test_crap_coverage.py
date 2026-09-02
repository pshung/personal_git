import io
import json
import os
import shutil
import sys
import unittest

from helpers import AGENT_DIR, make_project, run_crap

sys.path.insert(0, AGENT_DIR)
import crap  # noqa: E402


def gcov_json(root, lines):
    """One gcov --json-format document for src/a.c.
    lines: {line_number: (count, [branch_count, ...])}"""
    return json.dumps({
        "current_working_directory": root,
        "files": [{"file": "src/a.c", "lines": [
            {"line_number": ln, "count": cnt,
             "branches": [{"count": b, "throw": False, "fallthrough": i % 2 == 0}
                          for i, b in enumerate(brs)]}
            for ln, (cnt, brs) in lines.items()]}]})


class BranchCoverageDrivesCrap(unittest.TestCase):
    """CRAP uses branch coverage when a function has branches. Line coverage
    calls `x = c ? a : b;` covered when only one arm ever ran, which is exactly
    the gap the agent is told to close ("one case per decision outcome")."""

    def setUp(self):
        self.root = make_project(git_init=False)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_every_line_ran_but_only_70_percent_of_branches(self):
        doc = gcov_json(self.root, {
            4: (5, []), 5: (5, []),
            6: (5, [5, 1]),          # for: 2/2
            7: (10, [3, 2]),         # if: 2/2
            8: (7, [0, 2]),          # else if: 1/2
            9: (10, [1, 0, 0, 1]),   # a && b: 2/4
            10: (5, []), 11: (5, []),
        })
        p = run_crap(self.root, "--filter", "src/", "--all", stdin=doc)
        self.assertIn("70.0%", p.stdout, p.stdout + p.stderr)
        # 7 of 10 edges taken. CC 6, cov .7 -> 36 * 0.3^3 + 6 = 7.0
        self.assertRegex(p.stdout, r"(?m)^\s+7\s+.*tangle", p.stdout)

    def test_function_without_branches_falls_back_to_line_coverage(self):
        doc = gcov_json(self.root, {1: (0, [])})   # leaf never ran
        p = run_crap(self.root, "--filter", "src/", "--all", stdin=doc)
        self.assertRegex(p.stdout, r"(?m)^\s+2\s+.*0\.0%\s+leaf", p.stdout)

    def test_throw_edges_are_not_branches(self):
        cov = crap.FileCoverage()
        cov.add_line(6, 5, [{"count": 5, "throw": False}, {"count": 0, "throw": True}])
        self.assertEqual(crap.coverage_of(cov, 6, 6), (1.0, True))


if __name__ == "__main__":
    unittest.main()


class LlvmIntermediateFormat(unittest.TestCase):
    """clang builds are read with `llvm-cov gcov -i`, which has no JSON mode.
    crap.sh prefixes each block with `cwd:` so relative file: paths resolve."""

    def test_lcount_and_branch_lines_become_file_coverage(self):
        text = ("cwd:/b\nfile:src/a.c\nlcount:6,5\nbranch:6,taken\nbranch:6,nottaken\n"
                "lcount:7,0\nbranch:7,notexec\nbranch:7,notexec\n")
        cov = crap.read_coverage(io.StringIO(text))["/b/src/a.c"]
        self.assertEqual(dict(cov.lines), {6: 5, 7: 0})
        self.assertEqual(dict(cov.branches), {6: [1, 0], 7: [0, 0]})

    def test_same_file_from_two_binaries_merges_edge_by_edge(self):
        text = ("cwd:/b\nfile:/b/h.hpp\nlcount:2,1\nbranch:2,taken\nbranch:2,nottaken\n"
                "cwd:/b\nfile:/b/h.hpp\nlcount:2,1\nbranch:2,nottaken\nbranch:2,taken\n")
        cov = crap.read_coverage(io.StringIO(text))["/b/h.hpp"]
        self.assertEqual(crap.coverage_of(cov, 2, 2), (1.0, True))

    def test_json_stream_still_dispatches_to_the_json_reader(self):
        doc = json.dumps({"current_working_directory": "/b", "files": [
            {"file": "a.c", "lines": [{"line_number": 1, "count": 3, "branches": []}]}]})
        cov = crap.read_coverage(io.StringIO(doc))["/b/a.c"]
        self.assertEqual(dict(cov.lines), {1: 3})
