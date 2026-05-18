# Plan: `./hsim` end-user driver

## Context

The hybrid simulator (QEMU + vsim) today exposes a developer-grade
surface: `source ./setup.sh`, then `make -C tests/fixtures`, then
`JOBS=8 bash scripts/run_e2e.sh`, or per-test
`FIXTURE=... TRIGGER_MODE=... bash tests/e2e.sh`. End users have to
know seven env vars (`JOBS`, `MODE`, `FILTER`, `TRIGGER_MODE`,
`TIMEOUT`, `EXPECT_RC`, `LOG_DIR`), the right `JOBS=8` cap on a 128-core
host, how to source `setup.sh`, the two-step build, and the fact that
the README's `./build.sh` reference is stale.

The goal: ship one entry point, `./hsim`, that any new user can run
without reading docs first. It must hide build/path/mmap/log-file
plumbing and call into the existing scripts -- no reimplementation,
no logic duplication.

User decisions captured (from clarifying questions):

- Name + location: **`./hsim` at repo root** (most discoverable).
- Language: **Python 3** (already a host dep; better argparse UX).
- Run scope: **fixtures by name AND arbitrary ELF paths**.
- Missing artifacts: **fail with one-line hint** -- no auto-build.
- v1 subcommands: **build, run, test, list** (drop demo/doctor for v1).
- Output: **quiet + `--verbose`** flag.
- Trigger mode: **require explicit `--mode csr|pc`** (no auto-detect in v1).

## Architecture

```
./hsim  (Python 3 stdlib only, no pip deps)
  |
  +-- build [--what qemu|vsim|plugin|simpoint|fixtures|all]
  |     -> subprocess: bash setup.sh        (artifacts 1-4)
  |     -> subprocess: make -C tests/fixtures   (fixtures)
  |
  +-- run <elf-or-fixture> --mode csr|pc [--vlen 512] [--timeout 60] [-v]
  |     -> subprocess: FIXTURE=... TRIGGER_MODE=... bash tests/e2e.sh
  |        (with VSIM_ELF override when arg is an arbitrary path)
  |
  +-- test [--filter REGEX] [--mode csr|pc|both] [--jobs N]
  |     -> subprocess: JOBS=<N or 8> MODE=... FILTER=... bash scripts/run_e2e.sh
  |
  +-- list <fixtures|demos|modes>
        -> parse tests/fixtures/Makefile, ls tests/demos/, hardcoded M1..M8 table
```

Path resolution (mirrors `tests/lib/paths.sh::hybrid_resolve_paths`):

- `VSIM_QEMU = build/qemu/qemu-system-riscv64`
- `VSIM_BIN  = verilator/build/sim_ax45mpv_premium`
- `VSIM_PLUGIN = qemu_plugin/libhybrid_handoff.so`
- `SIMPOINT_BIN = tools/simpoint/bin/simpoint`
- Read `HYBRID_TOOLCHAIN` from `config.env` if not in env.

For each subcommand that needs artifacts, check presence up front and
exit 2 with one-line hint: `hsim: vsim not built -- run ./hsim build`.

## Interface (input / output contract)

```
./hsim build                          # build everything
./hsim build --what vsim              # rebuild only vsim
./hsim run rt_c_hello --mode csr      # fixture by name
./hsim run my/app.elf --mode pc       # arbitrary ELF path
./hsim run rt_c_v_regs --mode csr -v  # verbose: dump QEMU/vsim stdout
./hsim test                           # JOBS=8 MODE=both bash scripts/run_e2e.sh
./hsim test --filter rt_c_v --mode csr
./hsim list fixtures                  # table of fixture names + family
./hsim list modes                     # M1..M8 short table
./hsim --help                         # global help; per-subcommand --help also
```

Output style:

- `run` (default quiet):
    ```
    [hsim] rt_c_hello mode=csr vlen=512
    [1/3] QEMU1 drain ......... ok (1.2s)
    [2/3] vsim ROI execute .... ok (4.7s)
    [3/3] QEMU2 resume ........ ok (0.4s)
    PASS rt_c_hello in 6.3s
    ```
- On failure: print the underlying log path at the end so user can `cat`
  it; do not dump 100+ lines of SystemC noise inline (unless `-v`).
- `test` (default quiet): suppress per-test phase output; print a
  final summary `PASS 32, FAIL 0, SKIP 0  (total 51.2s)`; on failure
  also print the per-test log paths.

Exit codes:

- 0: success
- 1: test/run failure (functional)
- 2: missing artifact, bad arg, env not set (configuration)
- 77: skip (artifact missing in CTest-style contexts; preserved for
  compatibility with `tests/lib/paths.sh`)

## Files

**Create:**
- `hsim` (executable Python 3 script, ~250-350 lines, stdlib only).
  Lives at `/home/nick/work/hybrid_sim/hsim`. Single file -- no
  package directory until v2. argparse with subparsers.
- `tests/hsim/test_hsim_list.sh` -- RED test for `list fixtures` (TDD).
- `tests/hsim/test_hsim_build_dry.sh` -- RED test for `build --dry-run`
  prints the underlying commands without executing.
- `tests/hsim/test_hsim_run_smoke.sh` -- RED test that
  `./hsim run rt_c_hello --mode csr` exits 0 (requires built artifacts;
  matches existing skip-77 convention).

**Modify:**
- `README.md` -- replace the stale `./build.sh` block with `./hsim`
  quickstart (3 lines: build, run, test). The Host deps + Outputs
  sections stay.
- `docs/USER_GUIDE.md` -- prepend a new "Section 0.5: Quick start with
  `./hsim`" that shows the four subcommands only. The existing
  Sections 1-7 stay for developers who want the raw env-var surface.
- `CLAUDE.md` (repo) -- under "Build Commands" add `./hsim build` and
  `./hsim test` as the primary path; mark the raw scripts as
  "developer escape hatch".

**Leverage unchanged (per "don't duplicate code"):**
- `setup.sh` -- still does all artifact builds; `hsim build` just calls it.
- `tests/fixtures/Makefile` -- `hsim build --what fixtures` just runs
  `make -C tests/fixtures` with `HYBRID_TOOLCHAIN` from `config.env`.
- `tests/e2e.sh` -- `hsim run` passes `FIXTURE`, `TRIGGER_MODE`,
  `EXPECT_RC`, `TIMEOUT`, and (for arbitrary ELF) `VSIM_ELF`.
- `scripts/run_e2e.sh` -- `hsim test` passes `JOBS`, `MODE`, `FILTER`.
- `tests/lib/paths.sh` -- logic mirrored in Python (`Paths` dataclass)
  but the bash version is still source-of-truth for the harness.

## Key functions to reuse from the codebase

- `tests/lib/paths.sh:hybrid_resolve_paths` (logic, not file) -- exit
  code 77 for skip, the four env var defaults.
- `scripts/run_e2e.sh:default_jobs()` -- already caps JOBS sensibly;
  `hsim test` just passes through `JOBS=8` unless user overrides.
- `setup.sh::_hybrid_setup_main` -- supports `clean [target]` already;
  `hsim build --clean [target]` maps directly to this.

## Implementation order (TDD: RED -> GREEN per subcommand)

Per the TDD gate in user CLAUDE.md, each subcommand follows
RED -> GREEN -> REFACTOR with structural and behavioral commits
separated. Build one subcommand at a time:

1. **`list`** (lowest risk -- pure parsing, no subprocess):
   - RED: `tests/hsim/test_hsim_list.sh` asserts that
     `./hsim list fixtures` outputs lines containing `rt_c_hello` and
     `rt_all_gprs`; assert `./hsim list modes` outputs `M1` and `M8`.
   - GREEN: parse `tests/fixtures/Makefile` for `.elf` targets;
     hardcode M1..M8 table from USER_GUIDE.md.
2. **`build`**:
   - RED: `--dry-run` flag prints `bash setup.sh` and
     `make -C tests/fixtures` without running.
   - GREEN: argparse subparser; subprocess.run with check=True.
   - Behavioral commit: actual exec, no --dry-run.
3. **`run`**:
   - RED: argparse rejects missing `--mode`; rejects unknown fixture;
     accepts arbitrary `.elf` path; exits 2 with hint when vsim binary
     missing.
   - GREEN: wire into `tests/e2e.sh` with the right env vars.
   - Quiet output formatting is a separate structural change.
4. **`test`**:
   - RED: `./hsim test --jobs 1 --filter rt_c_hello --mode csr` runs
     and reports `PASS 1, FAIL 0`.
   - GREEN: wrap `scripts/run_e2e.sh`, parse its results.tsv, print
     summary.

After all four pass: structural-only commit to refactor shared
`run_subprocess` / `Paths` helpers if duplication appears. Never
mix structural with behavioral in one commit.

## Verification (end-to-end)

Smoke sequence the maintainer can run after the driver lands:

```sh
# From a clean checkout, no env sourced:
./hsim                                 # prints help + 4 subcommands
./hsim list fixtures                   # exits 0, lists ~17 fixtures
./hsim run rt_c_hello --mode csr       # exits 2 with "run ./hsim build" hint
./hsim build                           # ~5 min on cold cache; exits 0
./hsim list fixtures                   # unchanged
./hsim run rt_c_hello --mode csr       # exits 0, PASS in ~6s
./hsim run rt_c_hello --mode csr -v    # same but with QEMU/vsim stdout
./hsim run tests/fixtures/rt_all_gprs.elf --mode csr   # arbitrary path
./hsim run rt_c_v_regs --mode pc       # uses _hybrid_enter_pc symbol
./hsim test --filter rt_c --mode csr   # runs ~7 tests with JOBS=8 cap
./hsim test                            # full suite, ~5 min, summary
```

Each line above is a checkbox the implementor must tick before
calling v1 done. The three `tests/hsim/test_hsim_*.sh` files give a
CI-grade automated version of the first 4-5 steps.

## Out of scope for v1 (deferred)

- `demo <T1..T7>` subcommand (wrap `tests/demos/demo_*.sh`).
- `doctor` env-health subcommand.
- Auto-detect trigger mode by ELF inspection (`--mode auto`).
- Building user's own ELF -- v1 only RUNS user binaries that are
  already hybrid-compatible (have CSR triggers or `_hybrid_enter_pc`).
- Bash-completion file for the subcommand names.
- M3..M8 (icount, BBV, slice, archive, replay) -- v1 covers M1 (csr)
  and M2 (pc) only, matching the only modes `tests/e2e.sh` supports
  today. Other modes stay reachable via the existing demo scripts.
