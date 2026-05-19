# Plan: `./hsim doctor` - env-health diagnoser

## Context

`./hsim doctor` was deferred to a hypothetical `driver_ROADMAP_v2` (see `driver_ROADMAP.md:189`). User now wants it in scope. Purpose: a read-only command that diagnoses why `./hsim build` or `./hsim test` would fail on a fresh box - missing toolchain, uninit submodules, missing artifacts, or tight `/dev/shm`. Exit code feeds CI.

Read-only by design (no `--fix`). No smoke run included (keeps doctor under 2 seconds).

## Scope (user-locked)

Four check categories:

1. **Artifacts** - `vsim`, `qemu-system-riscv64`, `libhybrid_handoff.so`, `simpoint`, fixture ELF count.
2. **Submodules** - `QEMU/`, `verilator/`, `tools/simpoint/` are checked out (not just registered).
3. **Toolchain** - `ninja`, `make`, `podman` on PATH; `HYBRID_TOOLCHAIN/bin/riscv64-unknown-elf-gcc` resolvable.
4. **Runtime** - `nproc`, `/dev/shm` free GB, suggested `JOBS` value.

## Architecture (leaf-node level)

Each check function returns `list[tuple[name, status, detail]]` where `status in {PASS, FAIL, WARN, INFO}`. `cmd_doctor` iterates sections, prints a fixed-width table, computes exit code = `1 if any FAIL else 0`. `WARN` and `INFO` never fail the run.

```
artifacts:
  [PASS] vsim       /home/.../verilator/build/sim_ax45mpv_premium
  [PASS] qemu       /home/.../build/qemu/qemu-system-riscv64
  [PASS] plugin     /home/.../qemu_plugin/libhybrid_handoff.so
  [PASS] simpoint   /home/.../tools/simpoint/bin/simpoint
  [PASS] fixtures   18 ELFs

submodules:
  [PASS] QEMU/             QEMU/configure
  [PASS] verilator/        verilator/CMakeLists.txt
  [PASS] tools/simpoint/   tools/simpoint/Makefile

toolchain:
  [PASS] ninja                       /usr/bin/ninja
  [PASS] make                        /usr/bin/make
  [PASS] podman                      /usr/bin/podman
  [PASS] riscv64-unknown-elf-gcc     /opt/andes/.../bin/riscv64-unknown-elf-gcc

runtime:
  [INFO] nproc            128
  [PASS] /dev/shm free    240 GB
  [INFO] JOBS suggestion  8 (default cap)

Summary: 12 PASS, 0 FAIL, 0 WARN
```

### Reuse - no duplication

- `_resolve_artifacts()` (`hsim:185`) - already handles `VSIM_BIN`, `VSIM_QEMU`, `VSIM_PLUGIN` env overrides. Doctor reuses it verbatim; failure injection in the RED test is identical to F3's `VSIM_BIN=/no/such/vsim` pattern.
- `_DEFAULT_JOBS = 8` (`hsim:226`) - cited in the JOBS suggestion, single source of truth.
- `REPO_ROOT` (`hsim:27`) - root anchor for all path checks.

### Portability

- No hardcoded host paths. Toolchain path comes from `HYBRID_TOOLCHAIN` env or parsed from `config.env`.
- `os.cpu_count()` not `nproc` shell-out.
- `shutil.disk_usage('/dev/shm')` guarded by `Path('/dev/shm').is_dir()` (macOS / non-Linux gracefully WARN).
- Submodule markers are committed-in files (configure, CMakeLists.txt, Makefile), not generated artifacts.

## Files

### Create

- `tests/hsim/test_hsim_doctor.sh` - RED test, shell, same shape as `test_hsim_test_small.sh`.

### Modify

- `hsim` - add `_doctor_artifacts`, `_doctor_submodules`, `_doctor_toolchain`, `_doctor_runtime`, `cmd_doctor`, and the `p_doctor` subparser. Estimated +90 lines, no edits to existing helpers.
- `driver_ROADMAP.md` - move `./hsim doctor` out of "Out of scope" into a new `### F7` section marked `done`. Structural-only doc edit.

## TDD ordering

### RED phase (commit 1, behavioral)

1. Write `tests/hsim/test_hsim_doctor.sh`.
2. Run it -> all assertions fail (no `doctor` subparser).

### GREEN phase (same commit, behavioral)

3. Add doctor functions + subparser to `hsim`.
4. Re-run RED test -> all PASS.
5. Run `JOBS=8 MODE=both bash scripts/run_e2e.sh` -> still 45 PASS / 0 FAIL (doctor doesn't touch e2e path).
6. Commit `behavioral: add ./hsim doctor subcommand`.

### Structural follow-up (commit 2)

7. Edit `driver_ROADMAP.md`: F7 entry + remove from "Out of scope" list.
8. Commit `structural: record ./hsim doctor as F7 in driver_ROADMAP.md`.

Split is required by `TDD.md`: code + doc-of-code change is one logical unit, but `driver_ROADMAP.md` change is a status-tracking record, not a code-behavior driver; keeping them separate makes both commits trivially revertable.

## RED test assertions (6 checks)

1. `./hsim doctor --help` exits 0, mentions `env-health` or `diagnos`.
2. `./hsim doctor` on this built repo exits 0.
3. Output has the four section headers (`artifacts:`, `submodules:`, `toolchain:`, `runtime:`).
4. Output has a `Summary: N PASS, M FAIL, K WARN` line.
5. `VSIM_BIN=/no/such/vsim ./hsim doctor` exits 1 and includes a `FAIL` row mentioning `vsim`.
6. `./hsim doctor` completes in <=5 seconds (read-only contract).

## Verification

```
chmod +x tests/hsim/test_hsim_doctor.sh
bash   tests/hsim/test_hsim_doctor.sh       # RED test -> all 6 ok
./hsim doctor                               # eyeball: 4 sections, summary, rc=0
./hsim doctor --help                        # subcommand listed in main --help too
JOBS=8 MODE=both bash scripts/run_e2e.sh    # global invariant: 45 PASS / 0 FAIL
```

The `45 PASS / 0 FAIL` line is the contract from `driver_ROADMAP.md:21-26`. Doctor must not regress it because doctor doesn't touch `tests/e2e.sh`, `scripts/run_e2e.sh`, or any built artifact - it only reads.

## Out of scope for this feature

- `--fix` auto-repair (user explicitly chose read-only).
- Smoke-run round-trip inside doctor (user chose no).
- `--json` machine-readable output (defer; no current consumer).
- Toolchain version pinning (e.g., "gcc >= 12") - just existence check.
