import json
import os
import shutil
import subprocess
import unittest

from helpers import AGENT_DIR, make_project, run_crap

FLAT_SWITCH = ("const char* opname(int op) {\n  switch (op) {\n"
               + "".join(f'    case {i}: return "op{i}";\n' for i in range(40))
               + "  }\n  return \"?\";\n}\n")


class CognitiveColumnInCrap(unittest.TestCase):
    def setUp(self):
        self.root = make_project(git_init=False)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_json_rows_carry_cognitive_complexity(self):
        p = run_crap(self.root, "--filter", "src/", "--all", "--json")
        by_name = {r["name"]: r for r in json.loads(p.stdout)["gated"]}
        self.assertEqual(by_name["tangle"]["cog"], 7)
        self.assertEqual(by_name["leaf"]["cog"], 0)

    def test_table_shows_cog_next_to_cc(self):
        p = run_crap(self.root, "--filter", "src/", "--all")
        self.assertRegex(p.stdout, r"(?m)^\s+CRAP\s+nloc\s+CC\s+cog\s+cov\s+function")
        self.assertRegex(p.stdout, r"(?m)^\s+42\s+\d+\s+6\s+7\s+0\.0%\s+tangle")

    def test_flat_switch_over_budget_is_reported_as_flat_not_split(self):
        with open(os.path.join(self.root, "src", "sw.cpp"), "w") as fh:
            fh.write(FLAT_SWITCH)
        p = run_crap(self.root, "--filter", "sw\\.cpp", "--all")
        self.assertEqual(p.returncode, 1)               # the gate still fails
        self.assertIn("FLAT", p.stderr)
        self.assertIn("cognitive=1", p.stderr)
        self.assertNotIn("SPLIT IT", p.stderr)


class CcShShowsCog(unittest.TestCase):
    def test_cc_sh_prints_a_cog_column(self):
        root = make_project(git_init=False)
        try:
            p = subprocess.run([os.path.join(AGENT_DIR, "cc.sh"), os.path.join(root, "src", "a.c")],
                               capture_output=True, text=True)
        finally:
            shutil.rmtree(root, ignore_errors=True)
        self.assertRegex(p.stdout, r"(?m)^\s+CC\s+cog\s+NLOC")
        self.assertRegex(p.stdout, r"(?m)^\s+6\s+7\s+\d+\s+.*tangle")


if __name__ == "__main__":
    unittest.main()
