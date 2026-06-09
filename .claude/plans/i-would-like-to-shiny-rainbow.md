# Plan: Rewrite `hsim` as a native C++ executable

## Context

`hsim` (repo root, 1,591 lines of Python 3) is the end-user driver for the Andes
hybrid simulator. It is `argparse` + `subprocess` + a little file I/O: 11
subcommands that build artifacts, run the QEMU/vsim round-trip in 4 trigger
modes, profile/cluster for SimPoint, and archive/replay snapshots.

You want it to be a compiled executable, not a Python file. Decisions locked with you:

- **Language: C++20.** Matches the repo (C/C++/Python), built with the existing
  clang++/CMake toolchain, and can `#include "hybrid/state_abi.h"` directly so
  there is no hand-copied struct layout to drift (the Python `ctypes` mirror in
  `tools/orchestrator/abi.py` is exactly that liability).
- **Scope: hsim's runtime functionality must be pure C++** - no Python, no shell
  in the functional path. **Build and test infrastructure may stay shell/Python.**
- **No QEMU2 handback.** The new driver does NOT implement phase 3 (restore state
  into a second QEMU via gdbstub). This removes the only hard piece.

### Why "no QEMU2" makes this small

The 3-phase round-trip is QEMU1 (drain) -> vsim (resume + drain) -> QEMU2
(restore + continue to program end). **The cycle figure every mode reports is the
vsim `mcycle` delta** (`hybrid_state_v1::mcycle` after vsim minus after QEMU1);
QEMU2 only continues the program afterward to *validate* correctness. Dropping
QEMU2 from `hsim run` keeps the measurement identical and deletes the gdbstub RSP
client work. The QEMU2 correctness check moves to `hsim test`, which stays shell
(`scripts/run_e2e.sh` -> `tests/e2e.sh` -> `python -m orchestrator.main`).

## Architecture (the whole picture)

```
        ./hsim  (single C++ binary, depends only on libc++ + include/hybrid/state_abi.h)
          |
   +------+----------------------------------------------+
   | arg parse + dispatch (11 subcommands)               |
   +-----------------------------------------------------+
          |                         |                  |
   RUNTIME (pure C++)        DEV/SETUP (shell ok)   TEST (shell ok)
   run/profile/cluster        build  ------------>  test ----------->
   estimate/archive/replay     |  scripts/build_*.sh  |  scripts/run_e2e.sh
          |                     |  make                |   -> tests/e2e.sh
   spawn QEMU1 (drain) --+      |                      |   -> orchestrator (QEMU2 validate)
   spawn vsim   (drain) --+--> read st.mcycle/minstret from state file
   spawn simpoint binary       (no QEMU2, no gdbstub)
```

Everything `hsim run` does is: allocate a `/dev/shm` mmap, spawn QEMU1 with the
plugin (drains to a state file on its trigger), spawn vsim (resumes from that
file, runs the window, drains to a second file), then read two `uint64_t` fields
(`mcycle`, `minstret`) from the drained struct and print the delta. SimPoint adds
a profile pass + the `simpoint` clustering binary + a per-phase loop on top.

## What is C++ vs what stays shell/Python

| Concern | Today | After |
|---|---|---|
| `run` csr/pc/icount/simpoint | py inline + `tests/e2e.sh` (csr/pc) | **C++** (QEMU1+vsim drain, no QEMU2) |
| `profile`, `cluster`, `estimate` | py inline | **C++** |
| `archive` | py `checkpoint.write_archive` | **C++** (port) |
| `replay` | py `orchestrator.main` (vsim or qemu) | **C++**, vsim resume only; `--resume-with qemu` dropped (it is the handback) |
| mmap alloc | `tools/hsim_shm.py` | **C++** (port, ~110 lines) |
| read mcycle | `tools/orchestrator/abi.py` (ctypes) | **C++** (`#include state_abi.h`) |
| `list`, `doctor` | py | **C++** |
| `build` | py -> `scripts/build_*.sh`, `make` | **C++ shells out** (build = setup, allowed) |
| `test` | py -> `scripts/run_e2e.sh` | **C++ shells out** (test, allowed); this is where full round-trip incl. QEMU2 still runs |

The Python `tools/orchestrator/` package and `tests/e2e.sh` are **kept** - they
remain the test/validation path invoked by `hsim test`. They are no longer on
hsim's runtime path.

## Existing code to reuse (cite, do not reinvent)

- `include/hybrid/state_abi.h` - `#include` it; read the drained file straight
  into `struct hybrid_state_v1`. `mcycle`/`minstret`/`flags`/`vlenb` are members,
  no offsets. (For reference: `mcycle`@624, `minstret`@632, `sizeof`==3624.)
- `hsim` (Python) - the authoritative behavior spec for every subcommand,
  output string, exit code, and validation rule. Port literally, keep it as the
  golden reference for differential tests until the final swap.
- `tools/hsim_shm.py` - port `parse_size` / `select_mmap_dir` (statvfs) /
  `allocate` (mkstemp+truncate+status line) verbatim into C++.
- `tools/orchestrator/checkpoint.py::write_archive` + `_build_meta` - port the
  `state.bin` copy, `cp --reflink=auto` mem copy, and `meta.json` builder.
- `tests/lib/roi.sh` + `tests/e2e.sh` (lines 48-71) - the PC-mode logic: resolve
  a symbol or `0x` address to a PC, and derive `milmb` markers from disasm. Port
  symbol resolution by reading the ELF `.symtab` directly in C++ (small reader),
  not by shelling to `nm`.
- `verilator/src/hybrid/gdbstub_*.hpp` - NOT needed now (handback dropped), but
  noted: if QEMU2 restore is ever wanted, these are standalone-compilable C++.

## Build integration

- New `driver/` directory: `driver/CMakeLists.txt` + `driver/*.cpp` / `*.hpp`.
  Standalone target: `clang++ -std=c++20`, include path `include/`, **no
  Verilator, no SystemC, no fmt/spdlog** (use `std::format`). Output `build/hsim`.
- Bootstrap script `scripts/build_driver.sh` (shell - build infra). Add a call to
  it in `setup.sh` and a `--what driver` case to the C++ `hsim build`.
- During development the binary is `build/hsim`; the Python `hsim` stays at repo
  root as the reference. **Final feature swaps** repo-root `hsim` to be the binary
  (move Python to `hsim.py`), so all `./hsim ...` call sites keep working.

## Testing strategy (TDD + closed-loop parity)

Per your TDD gate, each feature is RED first. Two reinforcing mechanisms:

1. **Differential parity harness** (built in F0, the flywheel): a script runs the
   same args through `python3 hsim.py` (golden) and `build/hsim` (new) and diffs
   stdout/stderr/exit-code over a case matrix. `--dry-run`, `list`, `doctor`, and
   `-h` paths need no built artifacts, so most of the surface is testable fast.
   Each ported feature flips its cases from "diff" to "match"; coverage compounds.
2. **Existing smoke tests** `tests/hsim/test_hsim_*.sh` already assert on
   `./hsim <subcmd>` stdout and are binary-agnostic - they become acceptance tests
   pointed at `build/hsim`.

Parity is **byte-exact** for list/doctor/build-dryrun/profile-dryrun/
cluster-dryrun/archive-dryrun/replay-dryrun. For `run`/`estimate` it is
**cycle-figure equivalence**, not byte-exact, because the C++ path drops QEMU2 and
prints a clean drain-pair line instead of `e2e.sh`'s full round-trip log.

## ROADMAP (becomes `hsim_native.md` at repo root)

Note: a 1,000+-line `ROADMAP.md` already exists (FR tracking). Per repo
convention (`gemm_modes.md`, `mode_consolidation.md`) and to avoid clobbering it,
the task breakdown goes in a task-named `hsim_native.md`. Implementation step 1 is
to create that file with the features below (one feature per session, with a
state field).

- **F0 Scaffold + build + parity harness.** `driver/` CMake, `main.cpp` dispatch
  skeleton, REPO_ROOT discovery, `scripts/build_driver.sh`, differential parity
  harness `tests/hsim/parity.sh`. Dep: none.
- **F1 `list` + arg parsing.** MODES table, `parse_fixtures` Makefile regex,
  formatted output, `-h`. Pure. Dep: F0.
- **F2 `doctor`.** artifact/submodule/toolchain/runtime checks, statvfs,
  `HYBRID_TOOLCHAIN` from env/`config.env`. Dep: F0.
- **F3 `build`.** subprocess chain + `--dry-run` (inherits stdio). Dep: F0.
- **F4 Infra.** `run_process(argv, timeout, capture) -> {rc, out}`
  (fork/exec/pipe/poll/kill - the one genuinely new POSIX piece); mmap allocator
  (port `hsim_shm`); state-file reader (`#include state_abi.h`, validate
  magic/version). Dep: F0.
- **F5 `run --mode icount`.** QEMU1 drain (`icount=N`) -> vsim drain
  (`--hybrid-icount M`) -> mcycle delta + banner. No QEMU2. Dep: F4.
- **F6 `run --mode csr|pc`.** Native drain pair with shared mmap; PC-mode ELF
  symbol resolution; `enter_pc=` to plugin, `--hybrid-exit-pc` to vsim; kanata /
  warmup flags. Replaces the `e2e.sh` delegation. Dep: F4.
- **F7 `profile` + `cluster`.** BBV profile pass; `simpoint` binary subprocess +
  parse simpts/weights. Dep: F4.
- **F8 `run --mode simpoint` + `estimate`.** profile-to-exit (`drain_at_exit=1`,
  read `N_total` from `minstret`) -> cluster -> per-phase drain -> weighted CPI.
  Dep: F5, F7.
- **F9 `test`.** wrap `scripts/run_e2e.sh`, parse `results.tsv`, summary line,
  tempdir cleanup. (Full round-trip incl. QEMU2 still validated here.) Dep: F4.
- **F10 `archive` + `replay`.** port `write_archive`; `replay --resume-with vsim`
  reuses the F6 vsim-drain; `--resume-with qemu` dropped. Dep: F4 (F6 for replay).
- **F11 Swap + docs.** repo-root `hsim` becomes the binary; update CLAUDE.md
  key-files, `docs/USER_GUIDE.md`, `README.md`; wire `make`/`build_driver.sh` into
  `setup.sh` and `hsim build`. Final parity sweep. Dep: all.

## Behavior changes to expect (consequences of "no QEMU2")

- `hsim run --mode csr|pc` output changes: it now prints the vsim window-cycle
  line (like `icount`) instead of `tests/e2e.sh`'s full round-trip log. The
  cycle number is unchanged.
- `hsim replay --resume-with qemu` is removed; only `--resume-with vsim` remains.
- `hsim test` is unchanged and remains the place QEMU2 round-trip correctness is
  exercised.

## Verification

- `bash scripts/build_driver.sh` builds `build/hsim` clean (clang++ -std=c++20).
- `bash tests/hsim/parity.sh` is green: every artifact-free case
  (list/doctor/`-h`/all `--dry-run`) is byte-identical between `python3 hsim.py`
  and `build/hsim`.
- With artifacts built (`./hsim build`), for a representative fixture:
  `build/hsim run tests/fixtures/rt_c_v_matmul_free.elf --mode icount` and
  `--mode simpoint --interval 100 --max-k 2` produce the same cycle figures as the
  Python `hsim`.
- `tests/hsim/test_hsim_*.sh` pass against `build/hsim`.
- `hsim test --jobs 8` still passes the full e2e suite (validates the round-trip,
  QEMU2 included, via the retained shell/Python path).
- Final: after F11, `./hsim <any subcommand>` works for every doc/test call site.
