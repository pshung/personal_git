# Plan: promote M3..M7 + add SimPoint cycle estimator

## Context

`driver_ROADMAP.md:252` lists this as deferred:

> M3..M8 (icount, BBV, slice, archive, replay) -- currently only
> reachable via the demo scripts.

The plumbing already works (QEMU plugin, vsim, `tools/orchestrator/`),
but to drive M3..M7 today a user must either edit a `tests/demos/demo_*.sh`
env knob, hand-write QEMU+plugin argv, or author a YAML plan and call
`python -m orchestrator.main run`. There is no typed-flag `./hsim`
entry point.

Goal: expose each mode as a first-class `./hsim` subcommand with proper
argparse flags, reusing the orchestrator. Then on top of those primitives,
add a separate `./hsim estimate` command that does the classical SimPoint
cycle aggregation:

    estimated_cycles = N_total_insns * sum_k ( w_k * delta_mcycle_k / slice )

M8 (natural csrwi-exit / PC-exit) is already covered by `./hsim run`.

## Surface

| Mode  | New `./hsim` entry                                                            |
|-------|-------------------------------------------------------------------------------|
| M3    | `./hsim run <elf> --mode icount --qemu-icount N --vsim-icount M`              |
| M4    | `./hsim profile <elf> --slice N --icount M -o BBV`                            |
| M4*   | `./hsim cluster BBV --max-k K --simpts P --weights P`                         |
| M5    | `./hsim run <elf> --mode slice --slice N --slice-at K`                        |
| M6    | `./hsim archive --state S --mmap M --elf E -o snap/K`                         |
| M7    | `./hsim replay snap/K --resume-with {vsim,qemu}`                              |
| -     | `./hsim estimate <elf> --slice N --icount M --max-k K`                        |

M3 and M5 fold into F3's `cmd_run` as new `--mode` choices. M4 / M6 / M7 /
estimate are new top-level subcommands. No new QEMU / vsim argv code:
all five reuse `tools/orchestrator/`.

## Features (one session each, F9..F12)

### F9 - `./hsim profile` + `./hsim cluster` (M4 pair)

- Type: behavioral.
- Description: `profile` runs one QEMU+plugin pass with
  `bbv_out=,slice=N,icount=M`. `cluster` calls
  `tools/simpoint/bin/simpoint` directly on a BBV file and writes
  the `simpts` + `weights` outputs. Two subcommands because the
  output of the first is the input of the second.
- Pivot from plan v1: today's orchestrator `qemu_drain_argv`
  (`tools/orchestrator/spawn.py:17`) does not thread plugin params
  from `trigger.params` -- it bakes only `outfile=`. Rather than
  expand F9 to a cross-component orchestrator extension, F9 imports
  `qemu_drain_argv` and APPENDS the BBV plugin extras to the last
  `-plugin` argv slot. 90% of the QEMU flags stay DRY; the orchestrator
  extension is deferred to a future session that gets to refactor
  all three demo scripts at once.
- Key files:
  - **Modify** `hsim` -- add `cmd_profile`, `cmd_cluster`, two
    subparsers. `cmd_profile` reuses `qemu_drain_argv` then mutates
    the last argv element to append `bbv_out=...,slice=...,icount=...`,
    spawns QEMU directly via `subprocess.Popen`, manages the shared
    `/dev/shm` mmap with `tempfile.NamedTemporaryFile` + `os.truncate`.
    `cmd_cluster` shells out to the SimPoint binary.
  - **Create** `tests/hsim/test_hsim_profile_cluster.sh` -- RED test.
- Dependencies: F3 (`_resolve_artifacts`).
- Done criteria:
  - `./hsim profile tests/fixtures/icount_spin.elf --slice 1000 --icount 10000 -o /tmp/foo.bb` exits 0 and writes 10 BBV rows.
  - `./hsim cluster /tmp/foo.bb --max-k 2 --simpts /tmp/s --weights /tmp/w` exits 0 with non-empty outputs.
  - `--dry-run` on both prints resolved cmds without execution.
  - Missing artifact -> rc=2 with the existing `not built` hint.
  - `JOBS=8 MODE=both bash scripts/run_e2e.sh` still 45 PASS / 0 FAIL.

### F10 - `./hsim archive` + `./hsim replay` (M6 + M7 pair)

- Type: behavioral.
- Description: `archive` wraps
  `orchestrator.checkpoint.write_archive(...)` via a tiny
  `python3 -c` (matches the pattern in `demo_simpoint_loop.sh:148`).
  `replay` wraps `python3 -m orchestrator.main replay-checkpoint`
  (already implemented; just expose it as a sibling of `./hsim run`).
- Key files:
  - **Modify** `hsim` -- add `cmd_archive`, `cmd_replay`, two subparsers.
  - **Create** `tests/hsim/test_hsim_archive_replay.sh` -- RED test.
- Dependencies: F3 (`_resolve_artifacts`).
- Done criteria:
  - `./hsim archive --state /tmp/q.bin --mmap /tmp/shm --elf rt_c_v_regs.elf -o /tmp/snap/0` writes `state.bin` + `mem` + `meta.json`.
  - `./hsim replay /tmp/snap/0 --resume-with vsim` exits 0 in <60s.
  - `--dry-run` prints resolved cmd without execution.
  - 45 PASS / 0 FAIL holds.

### F11 - extend `./hsim run --mode {icount, slice}` (M3 + M5)

- Type: behavioral.
- Description: Add two new `--mode` choices to F3's `cmd_run`.
  New flags only bind when the matching mode is selected:
  - `--mode icount`: `--qemu-icount N` (default 10000), `--vsim-icount M` (default 5000).
  - `--mode slice`:  `--slice N` (default 1000), `--slice-at K` (default 1), `--vsim-icount M` (default 5000).
  csr / pc keep the current `tests/e2e.sh` path (no regression risk).
  icount / slice build a two-step orchestrator YAML inline and call
  `orchestrator.main run`.
- Key files:
  - **Modify** `hsim` -- extend `p_run` choices, add new optional
    flags, branch in `cmd_run` on `args.mode`.
  - **Create** `tests/hsim/test_hsim_run_icount_slice.sh` -- RED test.
- Dependencies: F3 (`cmd_run`).
- Done criteria:
  - `./hsim run tests/fixtures/icount_spin.elf --mode icount --qemu-icount 10000 --vsim-icount 5000` exits 0.
  - `./hsim run tests/fixtures/icount_spin.elf --mode slice  --slice 1000 --slice-at 1` exits 0.
  - csr / pc paths still pass the existing F3 RED test
    `tests/hsim/test_hsim_run_smoke.sh` byte-identically.
  - 45 PASS / 0 FAIL holds.

### F12 - `./hsim estimate` (SimPoint cycle estimator, the separate item)

- Type: behavioral. Depends on F9 + F10 + F11.
- Description: One end-to-end command:
  1. Run profile (M4): emit BBV with `slice=N`, `icount=M`.
  2. Run cluster: get `simpts` + `weights` files, K rows.
  3. For each cluster representative slice K_i:
     a. Run `--mode slice --slice-at K_i` to drain QEMU + run vsim.
     b. Read `mcycle` from the post-vsim state file via
        `orchestrator.abi.hybrid_state_v1` (ctypes struct already
        defined at `tools/orchestrator/abi.py:50`).
     c. delta_mcycle_i = mcycle_after - mcycle_before.
  4. Aggregate:
     ```
     CPI_i  = delta_mcycle_i / slice_insns
     CPI    = sum_i ( w_i * CPI_i )
     cycles = N_total_insns * CPI
     ```
  5. Print one-line summary plus per-phase table.
- Key files:
  - **Modify** `hsim` -- add `cmd_estimate`. Calls the F9/F11
    functions in-process (no re-shelling) so the aggregator stays
    in one Python process.
  - **Create** `tests/hsim/test_hsim_estimate.sh` -- RED test.
- Dependencies: F9, F10, F11.
- Done criteria:
  - `./hsim estimate tests/fixtures/icount_spin.elf --slice 1000 --icount 10000 --max-k 2` exits 0.
  - Output contains `estimated_cycles=` and an integer > 0.
  - Per-phase rows show non-zero `delta_mcycle` values.
  - Missing simpoint binary -> rc=2 with `not built` hint.
  - 45 PASS / 0 FAIL holds.

## Existing helpers to reuse (no re-implementation)

- `_resolve_artifacts()` (`hsim:188`) -- VSIM_BIN / QEMU / PLUGIN env override.
- `_DEFAULT_ARTIFACTS` (`hsim:180`) -- default artifact paths.
- argv split on `--` in `main()` (`hsim:647`) -- already in place.
- `orchestrator.checkpoint.write_archive(...)` (`tools/orchestrator/checkpoint.py:105`) -- M6.
- `orchestrator.main replay-checkpoint` (`tools/orchestrator/main.py:68`) -- M7.
- `orchestrator.main run <plan.yaml>` (`tools/orchestrator/main.py:48`) -- generic N-step runner; F9 + F11 build a YAML in a temp file and call this.
- `orchestrator.abi.hybrid_state_v1` (`tools/orchestrator/abi.py:50`) -- ctypes struct for reading `mcycle` from `state.bin`.
- `tools/simpoint/bin/simpoint` -- clustering binary (already built by `./hsim build`).
- `tests/fixtures/icount_spin.elf` -- CSR-less fixture all five demos use.

## TDD ordering (per feature, matches F7 / F8 cadence)

For each F9..F12:

1. **RED + GREEN (one behavioral commit)**:
   - Write `tests/hsim/test_hsim_<feature>.sh`. Make it executable.
   - Run it -> assertions fail (new subcmd does not exist yet).
   - Add the new subparser + `cmd_*` to `hsim`.
   - Re-run the test until all assertions pass.
   - Run `JOBS=8 MODE=both bash scripts/run_e2e.sh`. Confirm 45 PASS / 0 FAIL.
   - Commit with `behavioral:` prefix.

2. **STRUCTURAL (one doc commit)**:
   - Update `driver_ROADMAP.md`: add the F-section, extend the DAG.
     After F12 lands, remove M3..M8 from the "Out of scope" list.
   - Commit with `structural:` prefix.

## driver_ROADMAP.md updates (the structural commits)

DAG gains four nodes downstream of F8:

```
F8 (demo) --> F9 (profile/cluster) -+
              F10 (archive/replay) -+--> F12 (estimate)
              F11 (run --mode icount/slice) -+
```

After F12 lands, the "Out of scope" list (`driver_ROADMAP.md:250-254`) shrinks to:

```
## Out of scope (deferred to a future driver_ROADMAP_v2)

- Bash-completion file.
```

## Verification (after each feature)

```sh
bash tests/hsim/test_hsim_<feature>.sh        # feature's own RED test
JOBS=8 MODE=both bash scripts/run_e2e.sh      # global invariant: 45 / 0
./hsim --help                                 # new subcommand listed
./hsim <new-subcmd> --help                    # flags documented
```

Final F12 eyeball:

```
$ ./hsim estimate tests/fixtures/icount_spin.elf --slice 1000 --icount 10000 --max-k 2
M4 profile     ... 10 BBV rows  -> /tmp/.../profile.bb
cluster        ... 2 phases  weights=[0.7, 0.3]
M5+M7 phase 0  ... slice_at=0  delta_mcycle=12345  CPI=12.35
M5+M7 phase 1  ... slice_at=5  delta_mcycle=67890  CPI=67.89
estimated_cycles=287077  (N=10000, CPI=28.71)
```

## Out of scope for this plan

- Bash completion (still deferred).
- `./hsim profile --cluster` short-circuit (force two-step so user can inspect BBV between).
- Multi-fixture batch mode for `./hsim estimate`.
- Caching of profile output across estimate runs.
