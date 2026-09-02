import json
import shutil
import unittest

from helpers import make_project, run_crap


class JsonOutputForTools(unittest.TestCase):
    """--json prints one machine-readable object to stdout so graders and hooks
    do not have to regex the human table (which changes as columns are added)."""

    def setUp(self):
        self.root = make_project(git_init=False)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_json_lists_every_gated_function_with_its_numbers(self):
        p = run_crap(self.root, "--filter", "src/", "--all", "--json")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)   # tangle is over
        doc = json.loads(p.stdout)
        self.assertEqual(doc["budget"], 30)
        by_name = {r["name"]: r for r in doc["gated"]}
        self.assertEqual(set(by_name), {"leaf", "tangle"})
        t = by_name["tangle"]
        self.assertEqual((t["file"], t["line"], t["cc"]), ("src/a.c", 3, 6))
        self.assertEqual(t["cov"], 0.0)
        self.assertEqual(round(t["crap"]), 42)
        self.assertTrue(t["over"])
        self.assertFalse(by_name["leaf"]["over"])
        self.assertEqual(doc["over"], 1)


if __name__ == "__main__":
    unittest.main()
