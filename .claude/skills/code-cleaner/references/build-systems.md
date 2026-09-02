# Getting --coverage into the build

Read this when `cov_build.sh` cannot detect the project, when it reports zero
`.gcda` files, or when the coverage numbers look impossible (everything 0%,
everything 100%, or a function you know is tested showing as untested).

The failures in this area are quiet. Coverage instrumentation that never reached
the compiler does not produce an error - it produces 0%, which multiplies CRAP by
up to four and sends you writing tests that were never missing. Treat an
implausible number as a tooling bug until you have ruled it out.

## Contents

- [How it works](#how-it-works) - the three files, and why order matters
- [Per build system](#per-build-system) - CMake, Make, single file, Bazel/Meson
- [The five traps](#the-five-traps)
- [Reading raw gcov by hand](#reading-raw-gcov-by-hand)

## How it works

```
1. compile with --coverage   ->  binary + <name>.gcno   static: counter <-> line map
2. run the binary            ->  <name>.gcda            dynamic: counts per counter
3. gcov merges .gcno+.gcda   ->  per-line, per-function execution counts
```

`.gcda` is written by an `atexit` handler, so **the process has to exit
normally**. A test killed by a timeout, a signal, or `_exit()` writes nothing.

Counts from several `.gcda` files **add up**. That matters for header-only code:
a header compiled into five test binaries has five separate sets of counters, and
only their sum tells you whether a line is covered. `crap.sh` feeds gcov every
`.gcda` it finds and sums them, so point it at a directory, not one file.

## Per build system

### CMake

Use a separate build tree so the project's normal build keeps its own flags:

```sh
cmake -S . -B build-coverage -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_FLAGS='--coverage -O0 -g' \
  -DCMAKE_CXX_FLAGS='--coverage -O0 -g' \
  -DCMAKE_EXE_LINKER_FLAGS='--coverage'
cmake --build build-coverage -j"$(nproc)"
ctest --test-dir build-coverage
```

If you must instrument the project's *existing* build tree - because a wrapper
script rebuilds it and would overwrite your binary - be aware that CMake emits
`${CMAKE_CXX_FLAGS} ${CMAKE_CXX_FLAGS_<CONFIG>}` in that order. A wrapper that
re-passes `-DCMAKE_BUILD_TYPE=Release` on every run will append `-O3 -DNDEBUG`
after your `-O0`, and `-O3` wins. Put the flags in `CMAKE_CXX_FLAGS_RELEASE`
instead; the cache keeps them across re-configures because the wrapper never
passes that variable itself.

### Make

Override `CC`/`CXX`, not `CFLAGS`:

```sh
make CC="gcc --coverage -O0 -g" CXX="g++ --coverage -O0 -g"
```

Many Makefiles assign `CFLAGS :=`, which ignores the environment, and replacing
it on the command line drops flags the project needs (`-fPIC`, `-std=`, include
paths). A command-line `CC`/`CXX` beats any assignment in the file except
`override`, and rides along into both compile and link.

### A single test binary

Often the fastest path, especially for header-only code whose tests link nothing:

```sh
g++ -std=c++20 --coverage -O0 -g -I src -I include tests/foo.test.cpp -o build-coverage/foo
build-coverage/foo
```

The `.gcno`/`.gcda` land next to the **output binary**, named
`<exe-basename>-<source-basename>.gcda` - not `<exe>.gcda`, which trips people up
when they pass the wrong name to `gcov`.

This is worth checking for before assuming a full build is needed. If the tests
are header-only and framework-only (doctest, Catch2, a single-header gtest
drop-in), a whole containerised build can collapse into a one-line `g++`.

### Bazel, Meson, other

Bazel: `bazel coverage //...` produces `.dat` in lcov format, not `.gcda`;
`crap.py` reads gcov JSON, so convert or fall back to per-target `g++`.
Meson: `meson setup build-coverage -Db_coverage=true`, then run the tests.
Either way, record the working commands in `.crap.conf` so the next run is
deterministic.

## The five traps

**1. Stale `.gcda` (`stamp mismatch`).** You recompiled but did not re-run the
tests, so the new `.gcno` no longer matches the old `.gcda`. gcov warns on stderr
and then reports **0% for the entire file**. `crap.sh` detects this and refuses
to score; if you are running gcov by hand, do not redirect its stderr to
`/dev/null`. Fix: re-run the tests.

**2. Counters accumulate.** `.gcda` files are merged, not replaced. Run a binary
twice and every count doubles; delete a test and its `.gcda` keeps contributing
until you remove it. Always `find <dir> -name '*.gcda' -delete` before a
measurement run.

**3. Optimisation moves lines.** At `-O2`/`-O3` the compiler merges, inlines and
reorders, so gcov attributes counts to lines that no longer match the source.
Use `-O0 -g` for anything you intend to read line by line.

**4. gcov version must match the compiler.** `.gcno`/`.gcda` are version-locked.
Building with GCC 14 and reading with the host's GCC 16 `gcov` fails; with a
cross-toolchain, use *its* `gcov` (`riscv64-unknown-elf-gcov`). Clang's
`llvm-cov gcov` reads only Clang-produced data.

**5. Parallel runs and `fork`/`exec`.** On Linux libgcov takes a lock per
`.gcda`, so concurrent test processes merge safely - but a child that calls
`_exit()` (as after a failed `execvp`) skips the flush entirely, and a parent
killed by a timeout takes its counters with it.

## Reading raw gcov by hand

When you want to check one function without the scripts:

```sh
cd <repo root>                       # gcov resolves source paths relative to cwd
gcov -f -m -o <gcda dir> <gcda dir>/<exe>-<src>.gcda
```

`-f` prints per-function summaries, `-m` demangles C++ names, `-o` says where the
data lives. Output:

```
Function 'hybrid::ResumeDriver::resume(hybrid_state_v1 const&)'
Lines executed:96.30% of 108
Branches executed:95.59% of 136
```

It also writes `<source>.gcov` next to you, where `#####` marks lines that never
executed:

```sh
grep -n '#####' resume_driver.hpp.gcov
```

Clean those `.gcov` files up afterwards - they are build litter, and there can be
dozens of them (including one per system header).
