import json
import os
import shutil
import sys
import tempfile
import textwrap
import unittest

from helpers import AGENT_DIR, SRC_A_C

sys.path.insert(0, AGENT_DIR)
import cognitive  # noqa: E402


class CognitiveComplexityPerFunction(unittest.TestCase):
    """cognitive.py wraps clang-tidy's readability-function-cognitive-complexity
    behind one call: {function start line: cognitive complexity}. Functions
    scoring 0 are simply absent. None means the tool is not installed."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="cog-test-")
        os.makedirs(os.path.join(self.root, "src"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, text):
        p = os.path.join(self.root, rel)
        with open(p, "w") as fh:
            fh.write(textwrap.dedent(text))
        return p

    def test_scores_are_keyed_by_the_functions_start_line(self):
        p = self.write("src/a.c", SRC_A_C)
        self.assertEqual(cognitive.cognitive_complexity(p, self.root), {3: 7})

    def test_uses_compile_commands_json_when_the_build_left_one(self):
        p = self.write("src/m.cpp", """\
            int f(int a) {
            #ifdef NESTED
              if (a) { if (a > 1) { if (a > 2) return 3; } }
            #endif
              return a;
            }
            """)
        os.makedirs(os.path.join(self.root, "build-coverage"))
        with open(os.path.join(self.root, "build-coverage", "compile_commands.json"), "w") as fh:
            json.dump([{"directory": self.root, "file": p,
                        "command": f"g++ -std=c++17 -DNESTED -c {p} -o m.o"}], fh)
        self.assertEqual(cognitive.cognitive_complexity(p, self.root), {1: 6})

    def test_header_only_code_is_analysed_as_c_plus_plus(self):
        p = self.write("src/h.hpp", """\
            #pragma once
            inline int h(int x) { if (x) { while (x--) { if (x % 2) continue; } } return x; }
            """)
        self.assertEqual(cognitive.cognitive_complexity(p, self.root), {2: 6})

    def test_missing_tool_is_none_not_zero(self):
        p = self.write("src/a.c", SRC_A_C)
        self.assertIsNone(cognitive.cognitive_complexity(p, self.root, tool="/nonexistent/clang-tidy"))


if __name__ == "__main__":
    unittest.main()
