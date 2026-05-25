# Plan: Make `hsim` the sole orchestrator for all 4 switching modes

## Context

Today, four bash demo scripts under `tests/demos/` (plus their helpers in
`tests/lib/`) ship the headline switching-mode flows: csr-marker, pc-trigger,
icount, and the SimPoint pipeline. The Python `hsim` driver already covers the
same modes via `./hsim run --mode csr|pc|icount|slice` and `./hsim estimate`,
so the bash demos are now duplicated logic. They also drift: each demo has its
own banner format, its own env-var contract, and its own ad-hoc PC derivation
(`tests/lib/kernel_roi.sh`).

This refactor collapses the two surfaces into one: `hsim` becomes the single
orchestrator with explicit per-mode args, a uniform banner, and no bash
ancillaries. Goal: one obvious way to invoke each mode, with the key
parameters printed at runtime so the call is self-documenting.

## Final CLI shape (user-confirmed)

```
./hsim run <elf> --mode csr                            (no mode-specific args)
./hsim run <elf> --mode pc       --pc-start S --pc-end E   (both required)
./hsim run <elf> --mode icount   --qemu-icount N --vsim-icount M
./hsim run <elf> --mode simpoint --interval N [--max-k K] [--icount T] [--vsim-icount M]
```

Banner prints on every run-mode invocation. Subcommands `estimate`, `profile`,
`cluster`, `archive`, `replay`, `list`, `build`, `test`, `doctor` are kept
unchanged.

## Files to modify

### `hsim` (the Python driver)

Remove:
- `cmd_demo` and the helpers `_DEMO_ORDER`, `_demo_script`, `_resolve_demo`,
  `_parse_demo_passthrough` (hsim:578-677).
- The `demo` subparser registration in `build_parser` (hsim:1373-1398).
- `list_demos` and the `demos` choice in `cmd_list` / `p_list` (hsim:108-122,
  1241).
- The argv-splitting on `--` in `main()` (hsim:1590-1597) -- only the demo
  passthrough needed it.

Rename / change:
- In the `MODES` table (hsim:46-51): drop the `slice` row; add a `simpoint`
  row.
- In `cmd_run` (hsim:203-240) and `p_run` (hsim:1263-1333):
  - `--mode` choices become `csr|pc|icount|simpoint` (drop `slice`).
  - Rename `--roi-start` / `--roi-end` to `--pc-start` / `--pc-end` and make
    them **required** when `--mode pc`. Drop the fallback to
    `_hybrid_enter_pc` / `_hybrid_exit_pc` ELF markers (per user choice).
  - Rename `--slice` to `--interval` for `--mode simpoint`. Drop `--slice-at`
    from the run-mode surface (it was the slice-mode one-phase knob, no longer
    needed once `slice` mode is removed).
  - When `--mode simpoint`, dispatch into the same workflow that
    `cmd_estimate` runs (factor the body of `cmd_estimate` into a new
    `_run_simpoint_pipeline()` helper; both `cmd_run --mode simpoint` and
    `cmd_estimate` call it).
- Add `_print_run_banner(args, elf)`: prints a uniform header block --
  Mode, Fixture, Trigger description (mode-specific), Key params (the
  explicit args the user passed). Called at the top of `cmd_run` for every
  mode.

Keep:
- `_run_via_e2e`, `_run_drain_pair`, `_qemu_drain_argv`, `_vsim_drain_argv`,
  `_read_state_mcycle`, `_load_hsim_shm`, `_resolve_artifacts`,
  `_estimate_one_phase`, `_run_drain_at_exit_profile`, and `cmd_estimate`'s
  workflow logic (now reachable via `--mode simpoint`).

### Files to delete

```
tests/demos/demo_archive_replay.sh
tests/demos/demo_bbv_profile.sh
tests/demos/demo_csr_oneshot.sh
tests/demos/demo_icount_roundtrip.sh
tests/demos/demo_pc_oneshot.sh
tests/demos/demo_simpoint_loop.sh
tests/demos/demo_slice_consume_roundtrip.sh
tests/demos/test_demo_pc_oneshot_kernel.sh
tests/demos/test_demos_use_gemm.sh
tests/hsim/test_hsim_demo.sh
tests/lib/kernel_roi.sh
```

If `tests/demos/` ends up empty, remove the directory too. `tests/lib/paths.sh`
and `tests/lib/roi.sh` stay -- they are still consumed by `tests/e2e.sh`.

### Docs to update

- `docs/USER_GUIDE.md`: lines 154, 279, 401, 503, 546, 613, 620, 656, 682,
  684, 690, 708, 715, 857, 873 -- replace every `bash tests/demos/...` and
  `./hsim demo ...` example with the equivalent `./hsim run --mode ...` or
  `./hsim estimate ...` invocation. Update the mode table to drop `slice` and
  add `simpoint`. Update PC-mode examples to use `--pc-start` / `--pc-end`.
- `docs/switching_modes_tutorial.md`: lines 129, 201, 273, 280, 347-360 --
  same substitutions.
- `gemm_modes.md`: lines 5, 89, 90, 105, 106, 114, 115 -- swap T-id /
  demo-script references for the new `./hsim run --mode ...` form.
- `driver_ROADMAP.md` F8 spec (lines 231-260) -- mark F8 as removed in favor
  of the unified `run` surface.

## TDD slices

Per the global TDD gate, every non-test edit needs a failing test first.
Order of slices, each is one RED -> GREEN cycle:

1. **R1: pc-mode requires --pc-start / --pc-end.**
   New `tests/hsim/test_hsim_run_pc_required.sh`: invokes
   `./hsim run someelf.elf --mode pc` (no PC args) and asserts non-zero exit
   + an error message mentioning `--pc-start`. Then runs with both args and
   asserts argparse accepts. Make it pass by editing `p_run` in
   `build_parser`.

2. **R2: `--mode simpoint` exists; `--mode slice` is gone.**
   New `tests/hsim/test_hsim_run_simpoint.sh`: asserts
   `./hsim run elf --mode simpoint --interval 20` is accepted (argparse-only
   check via missing-elf rc=2 path) and `./hsim run elf --mode slice` is
   rejected by argparse (rc=2 with usage). Make it pass by editing `p_run`
   choices and dispatch.

3. **R3: banner prints on every run invocation.**
   New `tests/hsim/test_hsim_run_banner.sh`: invokes a `--dry-run`-ish path
   for each mode (use `VSIM_BIN=/dev/null` to force the `not built` exit
   path, but capture stdout before that). Asserts the banner header
   `Mode:` / `Fixture:` / `Key params:` lines appear. Make it pass by adding
   `_print_run_banner` at the top of `cmd_run`.

4. **R4: `demo` subcommand and `list demos` are removed.**
   New `tests/hsim/test_hsim_demo_removed.sh`: asserts `./hsim demo T1` exits
   non-zero with an argparse-unknown-subcommand error, and
   `./hsim list demos` is rejected (argparse choice). Make it pass by
   dropping the registrations.

5. **R5: structural cleanup.**
   After R1-R4 are green: delete the bash demos + tied tests + kernel_roi.sh
   listed above. Re-run the existing `tests/hsim/test_hsim_*.sh` smoke suite
   to confirm nothing else broke. Update docs in the same commit (structural
   change separate from behavioral, per Tidy First).

## Verification (end-to-end)

After all slices are green:

1. Each mode runs and prints its banner:
   ```
   ./hsim run tests/fixtures/rt_c_v_matmul.elf      --mode csr
   ./hsim run tests/fixtures/rt_c_v_matmul_free.elf --mode pc \
       --pc-start vmatmul_kernel --pc-end <derived 0x>
   ./hsim run tests/fixtures/rt_c_v_matmul_free.elf --mode icount \
       --qemu-icount 2000 --vsim-icount 1000
   ./hsim run tests/fixtures/rt_c_v_matmul.elf      --mode simpoint \
       --interval 20 --max-k 2 --icount 2000
   ```
   Each prints a banner, runs end-to-end, exits 0.
2. `./hsim list` accepts `fixtures`, `modes`; rejects `demos`.
3. `./hsim demo ...` and `./hsim run --mode slice ...` both error with usage.
4. `find tests/demos -type f` returns empty (or the dir is gone).
5. `JOBS=8 bash scripts/run_e2e.sh` still passes (e2e suite is independent of
   the demos).
6. `./hsim doctor` still green.
7. Grep `tests/demos\|hsim demo\|--mode slice\|--roi-start\|--roi-end` across
   the repo returns no hits (or only in driver_ROADMAP.md historical notes).
