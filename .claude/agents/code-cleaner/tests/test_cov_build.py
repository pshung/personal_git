import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest

from helpers import AGENT_DIR, SRC_A_C, git

COV_BUILD = os.path.join(AGENT_DIR, "cov_build.sh")
CRAP_SH = os.path.join(AGENT_DIR, "crap.sh")

TEST_C = "int tangle(int, int); int leaf(int);\nint main(void) { return tangle(4, 2) == 4 && leaf(1) == 2 ? 0 : 1; }\n"
CMAKE = textwrap.dedent("""\
    cmake_minimum_required(VERSION 3.20)
    project(p C)
    enable_testing()
    add_executable(t tests/t.c src/a.c)
    add_test(NAME t COMMAND t)
    """)
MAKEFILE_OK = "t: tests/t.c src/a.c\n\t$(CC) -o $@ $^\ntest: t\n\t./t\n"
MAKEFILE_FAILING_TEST = "t: tests/t.c src/a.c\n\t$(CC) -o $@ $^\ntest: t\n\t./t && false\n"
MAKEFILE_NO_TEST_TARGET = "t: tests/t.c src/a.c\n\t$(CC) -o $@ $^\n"


def project(files):
    root = tempfile.mkdtemp(prefix="covb-test-")
    for rel, text in {"src/a.c": SRC_A_C, "tests/t.c": TEST_C, **files}.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        with open(os.path.join(root, rel), "w") as fh:
            fh.write(text)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "init")
    return root


def run(cmd, root, env=None):
    return subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                          env={**os.environ, **(env or {})}, timeout=300)


class CovBuildLeavesTheRepoClean(unittest.TestCase):
    def setUp(self):
        self.root = project({"CMakeLists.txt": CMAKE})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_cmake_build_exports_compile_commands_for_clang_tidy(self):
        p = run([COV_BUILD], self.root)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.root, "build-coverage", "compile_commands.json")))

    def test_build_artifacts_do_not_show_up_in_git_status(self):
        run([COV_BUILD], self.root)
        status = git(self.root, "status", "--porcelain").stdout
        self.assertEqual(status, "", f"repo polluted:\n{status}")


class MakefileTestsAreNotMasked(unittest.TestCase):
    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_a_failing_make_test_fails_cov_build(self):
        self.root = project({"Makefile": MAKEFILE_FAILING_TEST})
        p = run([COV_BUILD], self.root)
        self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("test", p.stderr + p.stdout)

    def test_passing_make_test_produces_coverage(self):
        self.root = project({"Makefile": MAKEFILE_OK})
        p = run([COV_BUILD], self.root)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertRegex(p.stdout, r"[1-9]\d* \.gcda file")

    def test_no_test_target_is_a_configuration_error_not_a_pass(self):
        self.root = project({"Makefile": MAKEFILE_NO_TEST_TARGET})
        p = run([COV_BUILD], self.root)
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("COV_TEST_CMD", p.stderr)


@unittest.skipUnless(shutil.which("clang") and shutil.which("llvm-cov"), "needs clang + llvm-cov")
class ClangToolchainIsDetected(unittest.TestCase):
    def setUp(self):
        self.root = project({"CMakeLists.txt": CMAKE})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_clang_build_records_llvm_cov_and_crap_sh_reads_it(self):
        p = run([COV_BUILD], self.root, env={"CC": "clang", "CXX": "clang++"})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        with open(os.path.join(self.root, ".crap.conf")) as fh:
            self.assertIn('COV_GCOV="llvm-cov gcov"', fh.read())
        q = run([CRAP_SH, "--filter", "src/", "--all"], self.root)
        self.assertIn(q.returncode, (0, 1), q.stdout + q.stderr)
        self.assertRegex(q.stdout, r"(?m)^\s+\d+\s+\d+\s+6\s+7\s+\d+\.\d%\s+tangle")


if __name__ == "__main__":
    unittest.main()
