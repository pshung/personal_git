import shutil
import unittest

from helpers import make_project, run_crap


class EmptyGatedSetIsNotAPass(unittest.TestCase):
    """crap.py must never exit 0 without having scored at least one function.

    A clean exit with "0 gated" is what the agent reads as "gate passed", so an
    empty gated set has to be a loud tool error, with the fix in the message.
    """

    def setUp(self):
        self.roots = []

    def tearDown(self):
        for r in self.roots:
            shutil.rmtree(r, ignore_errors=True)

    def project(self, **kw):
        root = make_project(**kw)
        self.roots.append(root)
        return root

    def test_committed_work_with_default_diff_is_an_error_with_a_hint(self):
        root = self.project(commit=True)
        p = run_crap(root, "--filter", "src/")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("nothing to gate", p.stderr)
        self.assertIn("--diff HEAD~", p.stderr)
        self.assertIn("--all", p.stderr)

    def test_non_git_root_names_the_cause(self):
        root = self.project(git_init=False)
        p = run_crap(root, "--filter", "src/")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("not a git repository", p.stderr)
        self.assertIn("--all", p.stderr)

    def test_all_gates_every_function_even_without_git(self):
        root = self.project(git_init=False)
        p = run_crap(root, "--filter", "src/", "--all")
        # tangle: CC 6, no coverage data -> CRAP 42 -> over budget -> exit 1
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("2 gated", p.stdout)
        self.assertIn("tangle", p.stderr)


if __name__ == "__main__":
    unittest.main()
