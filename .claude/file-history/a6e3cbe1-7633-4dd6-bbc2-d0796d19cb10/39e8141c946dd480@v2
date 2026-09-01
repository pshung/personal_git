# Code coverage for recently-modified C/C++ functions

## Context

There is **zero** coverage tooling in this repo today. A grep for
`gcov|lcov|gcovr|--coverage|-fprofile|llvm-cov|kcov` returns hits only inside the
gitignored `build/qemu/` vendor tree. Every in-repo "coverage" hit
(`tests/andes_csr/check_coverage.py`, `docs/csr_transport_ROADMAP.md`, ...) is the
*CSR-transport* domain meaning, not code coverage.

You want to know, quickly, whether the functions you changed in the last few
commits are actually executed by the test suite. Today there is no way to answer
that. The result should be a **per-function table for changed C/C++ functions
only**, and the numbers must come from **exercising real andesim features**, not
from counting the test code itself.

Decisions taken from your answers:
- Report granularity = **C/C++ function**; `driver/*_test.cpp` and `driver/plan_itest.cpp`
  are excluded from the report (they are testing code, not product).
- Coverage is driven by the **contract lane** (34 sequential `tests/andes_sim/*.sh`
  scripts that invoke the real `build/andesim` binary), because that is what runs
  real features. `unit` and `e2e` are selectable lanes, not the default.
- Deliverable = a reusable `scripts/coverage.sh` + `gcovr`.
- Diff range defaults to `HEAD~5..HEAD` and is a flag (`--range`), so you can widen it.

## Why this is the fastest path (the two facts that make it cheap)

1. `driver/CMakeLists.txt` sets **no** `CMAKE_CXX_FLAGS`, so the CMake cache is a
   free injection point.
2. `scripts/build_driver.sh:15-18` re-runs `cmake` on **every** invocation but only
   passes `CMAKE_BUILD_TYPE` and `CMAKE_RUNTIME_OUTPUT_DIRECTORY`. Anything else we
   put in the cache **survives**. Since ~every contract test calls `build_driver()`
   (`tests/lib/log.sh:55`), instrumenting the cache once makes the *entire existing
   test suite* produce coverage with no test-side edits.

Critical detail: inject via **`CMAKE_CXX_FLAGS_RELEASE`**, not `CMAKE_CXX_FLAGS`.
CMake emits `${CMAKE_CXX_FLAGS} ${CMAKE_CXX_FLAGS_RELEASE}`, and `build_driver.sh`
re-pins `-DCMAKE_BUILD_TYPE=Release` every time, so a `-O0` in `CMAKE_CXX_FLAGS`
would be beaten by Release's trailing `-O3 -DNDEBUG`.

## Prerequisite (one command, no root)

```sh
python3 -m pip install 'gcovr>=8'     # /home/nick/.venv is user-writable
```
Host already has `gcov`/`g++` 16.1.1 (matched pair). `lcov`/`gcovr` are absent.
gcovr is what merges `shm.cpp`'s counters across the 4 object dirs that compile it
(`andesim.dir`, `andesim-infra-test.dir`, `andesim-plan-test.dir`, `andesim-memmap-test.dir`).

## Design

### `scripts/coverage.sh` (new)

```
scripts/coverage.sh on                     # instrument build/driver, rebuild
scripts/coverage.sh off                    # restore Release -O3, rebuild
scripts/coverage.sh run [options]          # on + wipe counters + run lanes + report
    --lanes contract|unit|e2e[,...]        default: contract
    --range <git-range>                    default: HEAD~5..HEAD
    --dry-run                              print the commands, execute nothing
```

`on` (this is the whole trick):
```sh
cmake -S "$ROOT/driver" -B "$ROOT/build/driver" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_RUNTIME_OUTPUT_DIRECTORY="$ROOT/build" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O0 -g --coverage" \
  -DCMAKE_EXE_LINKER_FLAGS="--coverage"
cmake --build "$ROOT/build/driver" -j"$(nproc)"
```
`off` re-passes `-DCMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG" -DCMAKE_EXE_LINKER_FLAGS=""`.
Counter reset before each `run`: `find "$ROOT/build/driver" -name '*.gcda' -delete`.

Lanes map to the existing harness, unchanged:
| lane | command | ~time | reaches |
|---|---|---|---|
| `contract` (default) | `bash scripts/test_all.sh contract` | ~5 min | `cmd_run.cpp`, `cmd_doctor.cpp`, `cmd_profile.cpp`, `cmd_list.cpp`, `main.cpp` + everything they call |
| `unit` | `bash scripts/test_all.sh unit` | ~30 s | `shm.cpp`, `memmap.cpp`, `run_plan.cpp`, `manifest.cpp`, ... |
| `e2e` | `JOBS=8 bash scripts/test_all.sh e2e` | ~25-40 min | the 57 hybrid round-trips |

Report step:
```sh
gcovr --root "$ROOT" --object-directory "$ROOT/build/driver" \
      --filter 'driver/' \
      --exclude '.*_test\.cpp' --exclude '.*_itest\.cpp' \
      --json-pretty -o "$ROOT/build/coverage/coverage.json" \
      --html-details "$ROOT/build/coverage/html/index.html" \
      --txt-summary
python3 "$ROOT/scripts/coverage_report.py" \
      --json "$ROOT/build/coverage/coverage.json" --range "$RANGE"
```

### `scripts/coverage_report.py` (new, ~80 lines)

The only new logic. Deliberately split so it is unit-testable without gcov:

**Input** (one of, mutually exclusive):
- `--range HEAD~5..HEAD` -> shells `git diff --unified=0 <range> -- '*.c' '*.cpp' '*.h' '*.hpp'`
- `--diff-file F` -> reads a unified diff from a file (used by the tests)
- `--changed-lines F` -> the already-parsed intermediate, `path:start-end` per line

plus `--json <gcovr json>` and optional `--min N` (exit 1 if changed-line coverage < N%).

**Processing**: gcovr JSON gives `files[].lines[{line_number,count}]` and
`files[].functions[{name,demangled_name,lineno,execution_count}]`. Function extent is
derived by sorting each file's function start lines and taking
`[start_i, start_{i+1} - 1]` (last one runs to EOF) - no dependency on a gcovr
`end_line` field. A function is *changed* if its extent overlaps any changed hunk.

**Output** (stdout, fixed columns):
```
range: HEAD~5..HEAD   lanes: contract

file                function              lines  hit      %  missed
driver/shm.cpp      hybrid_ram_base           6    6  100.0  -
driver/shm.cpp      fast_linux_ram_base       9    0    0.0  140-148
driver/cmd_run.cpp  run_hybrid               88   61   69.3  410,417-421,655
...
CHANGED FUNCTIONS: 12 total, 4 never executed, 63.2% of changed lines covered
html: build/coverage/html/index.html
```

## Work order (TDD, per TDD.md)

1. **RED** - `tests/test_coverage_report.sh` (new; the `tests/test_*.sh` glob means
   `scripts/test_all.sh lint` picks it up automatically, per `test_all.sh:70-75`).
   Feeds a hand-written fixture `tests/data/coverage_sample.json` (2 files, 3
   functions, one fully hit / one partly hit / one never executed) plus a fixture
   `tests/data/coverage_sample.diff`, and asserts the printed table. Run it: fails,
   `coverage_report.py` does not exist.
2. **GREEN** - `scripts/coverage_report.py` with `--json` + `--diff-file` +
   `--changed-lines` only. Test passes.
3. **RED** - extend the same test with the `--min` gate case (expects exit 1).
   **GREEN** - add `--min`.
4. **REFACTOR** - only if the diff parser and the extent mapper want separating.
5. **RED** - `tests/test_coverage_sh.sh` asserting `scripts/coverage.sh --dry-run run`
   prints the `cmake ... CMAKE_CXX_FLAGS_RELEASE=-O0 -g --coverage` line and the
   `test_all.sh contract` line and spawns nothing. **GREEN** - write `scripts/coverage.sh`.
6. Add a short **Code coverage** subsection under `CLAUDE.md`'s *Running Tests*.
   `docs/USER_GUIDE.md` is **not** touched: this is contributor tooling and no
   user-facing andesim behavior changes.

Only two new product files (`scripts/coverage.sh`, `scripts/coverage_report.py`);
no existing script, Makefile, or CMakeLists is modified.

## Verification (end to end)

```sh
python3 -m pip install 'gcovr>=8'
bash scripts/test_all.sh lint                       # the 2 new tests pass
bash scripts/coverage.sh run --lanes unit           # ~1 min, smoke-tests the pipeline
bash scripts/coverage.sh run --lanes contract       # ~5 min, the real answer
bash scripts/coverage.sh off                        # IMPORTANT: back to -O3
```

Expected, and what proves it works:
- `unit` lane: `driver/shm.cpp::hybrid_ram_base` and `fast_linux_ram_base` show
  covered (they are new in `1edb88d`/`9d10a6d` and `driver/infra_test.cpp` was
  extended alongside them); `driver/cmd_run.cpp` shows **0%** - no unit binary links it.
- `contract` lane: `driver/cmd_run.cpp::run_fast` / `run_hybrid` / `check_one_elf`
  become non-zero. That difference between the two lanes is the correctness check
  on the whole setup.
- `build/coverage/html/index.html` opens and lists no `*_test.cpp` file.
- `git status` stays clean (`build/` is gitignored, line 1).

## Known limitations, stated up front

- **Leaving it on is sticky.** The instrumented `-O0 --coverage` driver stays in the
  cache until `scripts/coverage.sh off`. Impact on measurements is nil (QEMU/vsim
  dominate wall time, and the driver does not contribute to the cycle figure), but
  the script prints a loud reminder.
- **Timeout-killed runs lose data.** `tests/e2e.sh:193,217` wrap the legs in
  `timeout`; SIGTERM skips libgcov's atexit flush. Affects the `e2e` lane mostly.
- **`e2e` concurrency**: libgcov `flock`s each `.gcda` on Linux so merges are safe,
  but use `JOBS=8` (per CLAUDE.md:88) not the default 64.
- **`qemu_plugin/` is out of scope here** - it has not changed in 20+ commits. If you
  ever need it: its `Makefile` uses `CFLAGS :=`, so env override is ignored and you
  must restate everything -
  `make -C qemu_plugin CFLAGS='-O2 -fPIC -Wall -Wextra -std=c11 --coverage'`.
- **gcovr/GCC-16 parse risk**: run the `unit` lane first (1 min). If gcovr cannot
  parse GCC 16.1.1's gcov JSON, the fallback is `gcov -f` per object dir with the
  merge done in `coverage_report.py`; the report format does not change.
