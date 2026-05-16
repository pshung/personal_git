# Comprehensive E2E Test Plan: Switching-Mode Demonstration

## Context

The hybrid simulator now ships **all eight switching mechanisms** (F1-F12) that select when QEMU yields to vsim and vice versa, but the test surface treats them as isolated plugin checks. There is no single artifact a new user (or contributor) can run that demonstrates every switching mode end-to-end, and the SimPoint-driven flow - the highest-leverage mode for production benchmarking - has no integrated test that chains BBV emit -> SimPoint clustering -> phase replay.

This plan adds:
1. One **demonstration e2e fixture per switching mode**, each named after the mode it shows off, runnable via a single `make demo` target.
2. The **SimPoint integrated loop** (currently the only F-feature without a chain-of-modes test): BBV profile -> simpoint binary -> archive each chosen phase -> replay each phase under vsim.
3. A **mode-matrix CTest section** in `cmake/HybridConfig.cmake` so every switching mode has a labeled CTest entry and shows up under `ctest -L switching-mode`.

Intended outcome: a user can run `make demo` and watch QEMU<->vsim swap drivers eight different ways in under five minutes; a contributor breaking any switching mode gets a labeled CTest failure that names the mode.

---

## Switching Mode Catalog (eight modes, today)

| # | Mode | Trigger source | Today's test |
|---|---|---|---|
| M1 | **CSR insn match** | `csrwi 0x7C0, {0,1}` in binary | `roundtrip_e2e.sh` (TRIGGER_MODE=csr) |
| M2 | **PC symbol resolve** | `_hybrid_enter_pc` / `_hybrid_exit_pc` ELF symbols | `roundtrip_e2e.sh` (TRIGGER_MODE=pc) |
| M3 | **Icount** (F5/F6) | plugin `icount=N`, vsim `--hybrid-icount N` | `test_plugin_icount_trigger.sh` (QEMU only) |
| M4 | **BBV-emit** (F7) | plugin `bbv_out=PATH,slice=N` | `test_plugin_bbv_emit.sh` |
| M5 | **Slice-consume** (F11) | plugin `slice=N,slice_at=K` | `test_plugin_phase_consume.sh` (QEMU only) |
| M6 | **Archive emit** (F9) | orchestrator YAML `on_exit.archive_as` | unit test only |
| M7 | **Checkpoint replay** (F10) | `orchestrator replay-checkpoint <dir>` | unit test only |
| M8 | **End-of-program** | QEMU2 runs to semihosting exit | implicit in every Tier-2 e2e |

Coverage gaps (the targets of this plan):
- **M3** has no vsim-side e2e (vsim receives plugin-drained state and resumes).
- **M5** has no orchestrator-level e2e (drain at slice K -> resume under vsim -> finish).
- **M6+M7** have no e2e at all - both are unit-tested in isolation; never wired through a real round-trip.
- **No fixture chains M4 -> simpoint binary -> M5 -> M6 -> M7** (the SimPoint integrated loop).

---

## New Tests to Add (one per mode)

All seven new e2e drivers live under `hybrid_vsim/tests/hybrid/` and reuse the existing `icount_spin.elf` workload (CSR-less spin at 0x100000), `rt_c_v_regs.elf` for state-rich modes, plus the orchestrator CLI. Each driver writes its own short log preamble naming the mode it exercises.

### T1. `demo_csr_oneshot.sh` (covers M1, M8)
Re-thin wrapper over `roundtrip_e2e.sh FIXTURE=rt_c_v_regs TRIGGER_MODE=csr`. Justification: a single self-documenting script that prints "Mode: CSR insn match (M1)" before invoking the harness. No new code, just a labeled entrypoint for the demo runner.

### T2. `demo_pc_oneshot.sh` (covers M2)
Mirror of T1 with `TRIGGER_MODE=pc`. Symbol resolution path runs end-to-end.

### T3. `demo_icount_roundtrip.sh` (NEW; covers M3 end-to-end)
- Drives `icount_spin.elf` through QEMU plugin with `icount=10000`.
- Plugin drains at insn 10000 -> exit 200.
- Orchestrator hands state to vsim with `--hybrid-icount 5000` (vsim drains 5k cycles later).
- vsim exits 200; spawns QEMU2 via gdbstub; QEMU2 runs to semihosting exit.
- Pass criterion: QEMU2 exit 0, drained PC in `icount_spin` body both times.
- Why new: today only `test_plugin_icount_trigger.sh` exists, and it terminates after QEMU1 drain. The vsim resume path under icount mode is untested at e2e level.

### T4. `demo_bbv_profile.sh` (covers M4 + tool integration)
- Generalize the existing `test_plugin_bbv_emit.sh` so it leaves the `.bb` file in `$LOG_DIR/bbv/icount_spin.bb` instead of `mktemp`.
- Run `tools/simpoint/bin/simpoint -loadFVFile bbv/icount_spin.bb -maxK 8 -saveSimpoints simpts -saveSimpointWeights weights`.
- Assert the output files exist, parse them, print the chosen slice indices + weights as the demo output.
- Pass criterion: simpoint binary exits 0, weights sum to 1.0 (+/-1e-3).
- No vsim involved; this is the QEMU-only profiling pass.

### T5. `demo_slice_consume_roundtrip.sh` (NEW; covers M5 end-to-end + M8)
- Read the `simpts` file from T4's output (or accept `SLICE_AT=K` env override).
- Drive `icount_spin.elf` with `slice=1000,slice_at=K,icount=<large fallback>`.
- Plugin drains exactly at insn (K+1) * 1000.
- vsim resumes, runs ROI, drains via CSR or icount (configurable), QEMU2 finishes.
- Pass criterion: drained PC in icount_spin ROI body, QEMU2 exit 0.
- Why new: today `test_plugin_phase_consume.sh` is QEMU-only.

### T6. `demo_archive_replay.sh` (NEW; covers M6 + M7 end-to-end)
- Step 1: `orchestrator run examples/csr_oneshot.yaml --archive-root $LOG_DIR/snap --workdir $LOG_DIR/run1`
  - Asserts `snap/0/{state.bin, mem, meta.json}` exist.
  - Validates `meta.json` schema=1, abi_magic matches, mem_size matches mmap.
- Step 2: `orchestrator replay-checkpoint $LOG_DIR/snap/0 --resume-with vsim --workdir $LOG_DIR/run2`
  - Asserts replay session exits 0.
  - Asserts post-replay state.bin differs from `snap/0/state.bin` (PC advanced).
- Pass criterion: both steps exit 0; archive shape + replay validation match.
- Why new: F9/F10 exist only as unit tests today; no test wires both through an actual mmap + state file.

### T7. `demo_simpoint_loop.sh` (NEW; the centerpiece, covers M4 -> simpoint -> M5 -> M6 -> M7)
The full SimPoint-driven workflow, the production use case for hybrid sim:

```
1. Profile pass (M4)
   $ qemu+plugin icount_spin.elf bbv_out=bbv.bb slice=1000 icount=10000
   -> 10-row bbv.bb

2. Cluster (tools/simpoint)
   $ simpoint -loadFVFile bbv.bb -maxK 4 -saveSimpoints simpts -saveSimpointWeights w
   -> simpts: list of (slice_idx, cluster_id); w: cluster weights

3. For each chosen slice_idx in simpts: (M5 + M6)
   $ orchestrator run plan_phase_${idx}.yaml --archive-root snap --workdir run_${idx}
     YAML:
       step 1: qemu with slice=1000,slice_at=${idx} -> drain
       on_exit: archive_as: snap/${idx}
   -> snap/${idx}/{state.bin, mem, meta.json}

4. For each archive: (M7)
   $ orchestrator replay-checkpoint snap/${idx} --resume-with vsim --workdir replay_${idx}
   -> vsim resumes from cluster-representative state, runs ROI, optional QEMU2 finish
```

Driver script generates the per-phase YAMLs from a template, invokes simpoint, walks both loops, and asserts:
- Each phase archive validates.
- Each replay exits 0 (or a documented non-zero with a clear reason for end-of-program phases).
- Final wall-clock printout: `phases_replayed=K, total_vsim_cycles=N, baseline_cycles=M, speedup=M/N`.

Pass criterion: K phase archives created, K replays exit 0. The speedup line is informational, not asserted (deterministic only on `icount_spin`).

### Demo runner: `hybrid_vsim/hybrid/test/demo.sh`
A single user-facing entry point. Sequentially invokes T1..T7, printing a banner per mode and a final pass/fail tally. Honors `FILTER=<mode-name>` env to skip subsets. Runs in under five minutes on the CI host when the build is cached.

```sh
make -C hybrid_vsim/hybrid/test demo      # alias for ./demo.sh
```

---

## Mode-Matrix CTest Section

Add to `hybrid_vsim/cmake/HybridConfig.cmake` after the existing plugin tests:

```cmake
# Switching-mode demo set. Each test asserts one of the eight modes
# (M1..M8) end-to-end. Labeled "switching-mode" so contributors can run
# the subset with `ctest -L switching-mode`.
set(VSIM_SWITCH_MODE_TESTS
  "demo_csr_oneshot:M1+M8:CSR insn match -> end-of-program"
  "demo_pc_oneshot:M2:PC symbol resolve"
  "demo_icount_roundtrip:M3:Icount trigger E2E"
  "demo_bbv_profile:M4:BBV emit + SimPoint clustering"
  "demo_slice_consume_roundtrip:M5:Slice-consume drain E2E"
  "demo_archive_replay:M6+M7:Checkpoint archive + replay"
  "demo_simpoint_loop:M4->M5->M6->M7:Full SimPoint pipeline"
)
foreach(entry ${VSIM_SWITCH_MODE_TESTS})
  string(REPLACE ":" ";" parts ${entry})
  list(GET parts 0 fname)
  list(GET parts 1 mode)
  list(GET parts 2 desc)
  add_test(NAME test_${fname}
    COMMAND bash ../tests/hybrid/${fname}.sh)
  set_tests_properties(test_${fname} PROPERTIES
    SKIP_RETURN_CODE 77
    LABELS "hybrid-e2e;switching-mode"
    COST 60)
endforeach()
```

Each test honors `SKIP_RETURN_CODE 77` so missing simpoint binary / missing plugin / missing ELFs skip cleanly rather than failing the suite on a fresh checkout.

---

## Critical Files

To create (no existing implementation):
- `hybrid_vsim/tests/hybrid/demo_csr_oneshot.sh`
- `hybrid_vsim/tests/hybrid/demo_pc_oneshot.sh`
- `hybrid_vsim/tests/hybrid/demo_icount_roundtrip.sh`
- `hybrid_vsim/tests/hybrid/demo_bbv_profile.sh`
- `hybrid_vsim/tests/hybrid/demo_slice_consume_roundtrip.sh`
- `hybrid_vsim/tests/hybrid/demo_archive_replay.sh`
- `hybrid_vsim/tests/hybrid/demo_simpoint_loop.sh`
- `hybrid_vsim/hybrid/test/demo.sh` - user-facing runner
- `hybrid_vsim/hybrid/test/yaml_templates/phase_step.yaml.in` - parameterized SimPoint phase YAML used by T7

To modify:
- `hybrid_vsim/cmake/HybridConfig.cmake` - add `VSIM_SWITCH_MODE_TESTS` foreach (see above)
- `hybrid_vsim/hybrid/test/Makefile` - new `demo` phony target invoking `demo.sh`
- `run_e2e.sh` - extend `RT_TESTS` with the seven demo entries so the host runner picks them up (single `MODE=demo` knob optional)

To reuse without modification:
- `qemu_plugin/hybrid_handoff.c` - already supports every plugin-side switching arg
- `tools/simpoint/bin/simpoint` - F12 clustering binary
- `tools/orchestrator/main.py` + `tools/orchestrator/examples/csr_oneshot.yaml` - YAML driver and example
- `tools/orchestrator/checkpoint.py` (`write_archive`, `replay_checkpoint`, `validate_replay_meta`) - F9+F10 entry points
- `hybrid_vsim/tests/hybrid/test_plugin_{bbv_emit,phase_consume,icount_trigger}.sh` - reference implementations for plugin invocation patterns
- `hybrid_vsim/hybrid/test/{icount_spin.S,rt_c_v_regs.c}` - workloads
- `hybrid_vsim/src/hybrid/{handoff_controller,resume_driver,state_drain,qemu_handback}.hpp` - the entire vsim-side switching mechanism

---

## Verification

End-to-end ladder, each step requires the previous:

1. **Build**: `make -C hybrid_vsim/hybrid/test demo` builds all referenced ELFs (already exist; rule is just an alias for `make demo.sh`).
2. **Single-mode**: `bash hybrid_vsim/tests/hybrid/demo_csr_oneshot.sh` exits 0 and prints "Mode: CSR insn match (M1) - PASS".
3. **Plugin-only modes**: `bash demo_bbv_profile.sh` produces a `.bb` file, runs simpoint, prints chosen slices + weights.
4. **Vsim-resume modes**: `bash demo_icount_roundtrip.sh` and `bash demo_slice_consume_roundtrip.sh` each exit 0 with a "round-trip complete" banner.
5. **Orchestrator modes**: `bash demo_archive_replay.sh` creates `snap/0/{state.bin, mem, meta.json}` and replays exit 0.
6. **Centerpiece**: `bash demo_simpoint_loop.sh` runs the full M4->M5->M6->M7 chain; K phase archives created, K replays exit 0. Speedup line printed.
7. **All modes**: `make -C hybrid_vsim/hybrid/test demo` runs T1..T7 sequentially, prints a final tally `7/7 PASS` in under 5 minutes.
8. **CTest integration**: `ctest -L switching-mode --output-on-failure` from the host build dir runs the same set under CTest's harness; each mode shows up as a labeled test.
9. **Skip behavior**: on a fresh container without `tools/simpoint/bin/simpoint`, T4 and T7 skip (return 77); CTest reports `Skipped` not `Failed`.
10. **Regression detection**: deliberately break the BBV emitter (e.g., off-by-one in slice boundary) and verify T4 fails with `weights do not sum to 1.0` and T7 fails with `simpts file empty`. Deliberately break F10 (e.g., skip `validate_replay_meta`) and verify T6 fails with `archive validation rejected`.

---

## Out of Scope

- **Phase 4 Kanata-loop integration** (M9-equivalent): no test added; depends on `--kanata-loop-start/end` orchestrator plumbing that doesn't exist yet. Documented as the next mode to add when Phase 4 lands.
- **Multi-hart switching**: `_NDS_NHART <= 2` is supported by the wire struct but the resume/drain path is only exercised on hart 0; per `HYBRID_OVERVIEW.md` L6.
- **Performance assertion in T7**: the speedup line is informational. A fully-RTL baseline run for the same icount window is a separate work item (Phase 4 verification).
- **State-coverage expansion** (FP/M-CSR/PMP round-trip): orthogonal to switching modes; tracked elsewhere as Phase 5 hardening.
- **CTest parallel scheduling for the demo set**: each demo runs sequentially under the runner; `ctest -j` can still schedule them concurrently but the `make demo` path stays linear so the banner output is readable.
