#!/usr/bin/env bash
# cov_build.sh -- build the project with --coverage and run its tests, so that
# .gcda counter files exist for crap.sh to read.
#
# Injecting coverage instrumentation is where this workflow usually breaks, and
# it breaks quietly: you get 0% coverage and a CRAP score several times too high,
# with no error. This script handles the common build systems, refuses to guess
# when it cannot tell, and remembers the answer.
#
# Usage:
#   cov_build.sh                 # detect (or reuse .crap.conf), build, run tests
#   cov_build.sh --show          # print the plan, run nothing
#   cov_build.sh --reset         # forget the cached config and re-detect
#
# Configuration lives in <repo-root>/.crap.conf and overrides detection. Write it
# by hand when the project needs something specific:
#
#   COV_BUILD_CMD='cmake --build build-coverage -j'
#   COV_TEST_CMD='ctest --test-dir build-coverage'
#   COV_GCDA_DIR='build-coverage'
#   COV_GCOV='llvm-cov gcov'     # added for you after the build if missing
#
# .crap.conf and build-coverage/ are added to .git/info/exclude, so the project's
# own `git status` stays clean.
#
# Requires: gcc/g++ or clang (+ llvm-cov), and whatever the project needs to build.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONF="$ROOT/.crap.conf"
BUILD_DIR="$ROOT/build-coverage"
SHOW=0

# -O0 keeps line numbers honest: at -O2 the optimiser merges and reorders lines,
# so gcov attributes counts to lines that no longer correspond to the source and
# coverage looks worse (or better) than it is.
COV_FLAGS="--coverage -O0 -g"

while [ $# -gt 0 ]; do
  case "$1" in
    --show)  SHOW=1; shift ;;
    --reset) rm -f "$CONF"; echo "cov_build.sh: cleared $CONF"; shift ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "cov_build.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

COV_BUILD_CMD=""; COV_TEST_CMD=""; COV_GCDA_DIR=""; COV_GCOV=""
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

detect_cmake() {
  # A separate build tree, so the project's normal build keeps its own flags and
  # nobody ships an instrumented binary by accident. compile_commands.json is
  # what gives clang-tidy (cognitive complexity) the real include paths.
  COV_BUILD_CMD="cmake -S '$ROOT' -B '$BUILD_DIR' -DCMAKE_BUILD_TYPE=Debug \
-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
-DCMAKE_C_FLAGS='$COV_FLAGS' -DCMAKE_CXX_FLAGS='$COV_FLAGS' \
-DCMAKE_EXE_LINKER_FLAGS='--coverage' >/dev/null && cmake --build '$BUILD_DIR' -j\$(nproc)"
  COV_TEST_CMD="ctest --test-dir '$BUILD_DIR' --output-on-failure"
  COV_GCDA_DIR="$BUILD_DIR"
}

# The test target that actually exists, found with a dry run. The real run is
# then plain `make <target>`: a failing test must fail this script, so there is
# no `|| true` and no hidden stderr.
make_test_target() {
  local t
  for t in test check; do
    make -C "$ROOT" -n "$t" >/dev/null 2>&1 && { echo "$t"; return 0; }
  done
  return 1
}

detect_make() {
  local target
  target=$(make_test_target) || { WHY="Makefile has no 'test' or 'check' target"; return 1; }
  # Ride in on CC/CXX rather than CFLAGS. Many Makefiles assign CFLAGS with `:=`,
  # which ignores the environment, and overriding it on the command line would
  # drop flags the project needs (-fPIC, -std=..., include paths). A command-line
  # CC/CXX beats any assignment in the file except `override`.
  COV_BUILD_CMD="make -C '$ROOT' CC=\"\${CC:-gcc} $COV_FLAGS\" CXX=\"\${CXX:-g++} $COV_FLAGS\""
  COV_TEST_CMD="make -C '$ROOT' $target"
  COV_GCDA_DIR="$ROOT"
}

WHY="no CMakeLists.txt, no Makefile"
detect() {
  if [ -f "$ROOT/CMakeLists.txt" ]; then detect_cmake; return 0; fi
  if [ -f "$ROOT/Makefile" ] || [ -f "$ROOT/makefile" ]; then detect_make; return $?; fi
  return 1
}

# .gcda files are version-locked to the compiler that wrote them: GCC's gcov
# cannot read clang's, and a cross toolchain wants its own gcov. Decide from the
# compiler the build actually used (the CMake cache when there is one, else the
# environment), and let crap.sh pick it up from .crap.conf.
detect_gcov() {
  local compiler="${CXX:-${CC:-gcc}}" name
  if [ -f "$BUILD_DIR/CMakeCache.txt" ]; then
    compiler=$(sed -n 's/^CMAKE_C[X]*_COMPILER:[A-Z]*=//p' "$BUILD_DIR/CMakeCache.txt" | head -1)
  fi
  name=$(basename "${compiler:-gcc}")
  case "$name" in
    *clang*) echo "llvm-cov gcov" ;;
    *g++*)   echo "${name/g++/gcov}" ;;    # riscv64-unknown-elf-g++ -> ...-gcov
    *gcc*)   echo "${name/gcc/gcov}" ;;    # gcc-14 -> gcov-14
    *)       echo "gcov" ;;
  esac
}

# Keep the project's `git status` clean: neither file is the project's business.
exclude_from_git() {
  local ex pat
  ex=$(cd "$ROOT" && git rev-parse --git-path info/exclude 2>/dev/null) || return 0
  case "$ex" in /*) ;; *) ex="$ROOT/$ex" ;; esac
  mkdir -p "$(dirname "$ex")"
  for pat in ".crap.conf" "build-coverage/"; do
    grep -qxF "$pat" "$ex" 2>/dev/null || echo "$pat" >> "$ex"
  done
}

if [ -z "$COV_BUILD_CMD" ] || [ -z "$COV_TEST_CMD" ]; then
  if ! detect; then
    cat >&2 <<MSG
cov_build.sh: cannot tell how to build and test this project ($WHY).

Ask the user how their tests are built and run, then write $CONF:

  COV_BUILD_CMD='g++ -std=c++20 --coverage -O0 -g -I include tests/foo.test.cpp -o build-coverage/foo'
  COV_TEST_CMD='build-coverage/foo'
  COV_GCDA_DIR='build-coverage'

A single self-contained test binary is a perfectly good target -- it does not
have to be the whole project.
MSG
    exit 2
  fi
  if [ "$SHOW" = 0 ]; then
    cat > "$CONF" <<CONF_EOF
# Written by cov_build.sh. Edit freely; it will not be overwritten.
COV_BUILD_CMD="$COV_BUILD_CMD"
COV_TEST_CMD="$COV_TEST_CMD"
COV_GCDA_DIR="$COV_GCDA_DIR"
CONF_EOF
    echo "cov_build.sh: detected build system, wrote $CONF"
  fi
fi

if [ "$SHOW" = 1 ]; then
  printf 'root:  %s\nbuild: %s\ntest:  %s\ngcda:  %s\ngcov:  %s\n' \
    "$ROOT" "$COV_BUILD_CMD" "$COV_TEST_CMD" "$COV_GCDA_DIR" "${COV_GCOV:-$(detect_gcov)}"
  exit 0
fi

exclude_from_git
mkdir -p "$BUILD_DIR"

# .gcda files accumulate: run a binary twice and every counter doubles, and a
# test you deleted keeps contributing until its .gcda is removed. Start clean so
# the numbers describe this run only.
find "$COV_GCDA_DIR" -name '*.gcda' -delete 2>/dev/null

echo "==> build"
eval "$COV_BUILD_CMD" || { echo "cov_build.sh: build failed" >&2; exit 1; }

if [ -z "$COV_GCOV" ]; then
  COV_GCOV=$(detect_gcov)
  printf 'COV_GCOV="%s"\n' "$COV_GCOV" >> "$CONF"
  echo "==> gcov: $COV_GCOV (recorded in $CONF)"
fi

echo "==> test"
eval "$COV_TEST_CMD"
rc=$?

n=$(find "$COV_GCDA_DIR" -name '*.gcda' 2>/dev/null | wc -l)
echo "==> $n .gcda file(s) under $COV_GCDA_DIR"
if [ "$n" -eq 0 ]; then
  cat >&2 <<MSG
cov_build.sh: the build produced no coverage data.
  Either no test ran, or --coverage did not reach the compiler. Check with:
    cov_build.sh --show
  A test killed by a timeout or a signal also writes nothing: the counters are
  flushed by an atexit handler, so the process has to exit normally.
MSG
  exit 1
fi
[ "$rc" -eq 0 ] || echo "cov_build.sh: tests FAILED (exit $rc) - coverage data is from a failing run" >&2

echo
echo "next: $(dirname "${BASH_SOURCE[0]}")/crap.sh --filter '<path prefix>'"
exit $rc
