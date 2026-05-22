# Roadmap: Consolidate switching modes 8 -> 4 (docs-first)

## Goal

Replace the confusing 8-mode list (M1-M8) with **4 intent-based modes**, split by
what they profile. Lock the model in docs first, then drive code to match.

## Why

The 8 "modes" mix three axes pretending to be one list: drain TRIGGER (M1 csr,
M2 pc, M3 icount, M5 slice), PROFILING sidecar (M4 bbv), PERSISTENCE pair (M6 emit,
M7 replay), TERMINATION (M8 QEMU2 exit). Users cannot tell a mode from a stage.

## Target model

| # | Mode | Profiles | Boundary picked by | Absorbs (old) |
|---|------|----------|--------------------|---------------|
| 1 | CSR | a kernel | `csrwi 0x7C0,0/1` markers in source | M1 |
| 2 | PC | a kernel | PC / symbol address (no source edit) | M2 |
| 3 | icount | a sampled window of the whole program | N QEMU fast-fwd, M vsim warmup, T vsim measure | M3 |
| 4 | SimPoint-driven | the whole program | clustering picks representative slices; each measured like icount | M4+M5+M6+M7 |

- Split by target: CSR/PC profile a **kernel**; icount/SimPoint **sample the whole program**.
- **Mode 4 = mode 3 repeated**: clustering picks slice indices; each is fast-forwarded,
  warmed, measured like icount, then weight-combined. M4 profile / M5 slice / M6 archive /
  M7 replay become labeled STAGES of SimPoint mode, not peer modes.
- **M8 demoted**: QEMU2 semihosting exit is the run's tail, not a selectable mode.
- **Warmup** (per `~/work/gem5/specs/warmup.md`): run unrecorded insts on the detailed
  model, reset counters, then measure. Detailed model here is vsim itself - warmup fills
  ALL microarch vsim models (caches + predictor + pipeline), so gem5's cold-predictor
  caveat does NOT apply, but warmup costs the same per-inst as measurement (M cannot be huge).

## Confirmed findings (probed in tree)

- icount warmup/measure split does NOT exist: `IcountTrigger` is single-boundary
  (`verilator/src/hybrid/icount_trigger.hpp:26-49`); no mid-run counter reset.
- vsim exposes only `mcycle`/`minstret` (`include/hybrid/state_abi.h:65-66`); no deeper
  pipeline counters. "pipeline information" = cycles/IPC for now.
- PC/ROI resolution already extracted + tested (uncommitted `tests/lib/roi.sh`,
  `roi.test.sh`) - PC infra is being tidied, reuse it.
- CTest `switching-mode` label was REMOVED (`verilator/cmake/HybridConfig.cmake:120-125`);
  e2e runs via `scripts/run_e2e.sh`. The tutorial's review checklist still claims it (stale).
- gemm_modes.md is orthogonal (fixtures, not taxonomy): F1-F8 stay; its table + F9 realign.

---

## Features (complete ONE per session; update State)

### D1 - Rewrite docs/switching_modes_tutorial.md to 4 modes
- State: TODO
- Depends on: none (model locked)
- Description: quick map (28-43) -> 4-mode table grouped by target + one-line
  "infrastructure, not modes" note (archive/replay/end-of-program). Per-mode sections:
  CSR (from 77-139), PC (142-211), icount (213-253, EXPAND to N/M/T warmup, mark
  `Status: planned (F2/F3)`), SimPoint (fold 257-377 + 381-457 + 461-501 into ONE
  section with labeled stages, T7 demo headline). Decision flow (557-576) -> kernel
  (CSR if editable else PC) vs whole-program (icount one window / SimPoint many).
  Fix stale CTest line in review checklist (605-606).
- Key files: `docs/switching_modes_tutorial.md`
- Verify: `grep -nE "\bM[1-8]\b" docs/switching_modes_tutorial.md` shows only intentional
  "formerly M..." notes.

### D2 - Rewrite docs/USER_GUIDE.md mode sections
- State: TODO
- Depends on: D1 (cross-references it)
- Description: intro line 8 + cheat-sheet line 59 ("M1..M8") -> 4 modes. Section 3
  (437-463): 8-row table + decision flow -> 4-mode split-by-target; KEEP kernel-anchoring
  callout (465-472). Section 4 (476-844): reorganize 4.1-4.7 into 4 mode walkthroughs;
  SimPoint section folds today's bbv/slice/archive/estimate/T7 as stages; icount gains
  N/M/T warmup walkthrough (planned-marker). Section 5 (863-866): note csr/pc via e2e.sh,
  icount/slice via `_run_drain_pair`, SimPoint via `hsim estimate`.
- Key files: `docs/USER_GUIDE.md`
- Verify: cross-refs to tutorial resolve; no stray M-numbers.

### D3 - Note the 4 modes in CLAUDE.md
- State: TODO
- Depends on: none
- Description: "Trigger Modes" section (~99-102) currently names only CSR + PC. State
  the 4 modes so the project doc matches the user-facing docs.
- Key files: `CLAUDE.md`
- Verify: section lists csr/pc/icount/simpoint.

### D4 - Realign gemm_modes.md to 4-mode naming (orthogonal)
- State: TODO
- Depends on: none
- Description: mapping table (32-46) regroup T4-T7 under "SimPoint-driven mode (stages)";
  keep MARKED/MARKERLESS builds + ELF names. F9 (145-151): note docs use the 4-mode model.
- Key files: `gemm_modes.md`
- Verify: table headers reference the 4 modes; F1-F8 unchanged.

### F1 - hsim 4-mode surface (structural)
- State: TODO
- Depends on: D1, D2
- Description: MODES array (42-51) + `list_modes` (122-128) present 4 user modes
  (csr/pc/icount/simpoint). Reclassify bbv/slice/archive/replay/end-of-program as
  stages/subcommands, not top-level modes. No behavior change.
- Key files: `hsim`
- TDD: RED `tests/hsim/test_hsim_list.sh` asserts `list modes` emits exactly 4; then GREEN.

### F2 - vsim icount warmup: two boundaries + counter reset (behavioral, net-new core)
- State: TODO
- Depends on: none
- Description: extend the icount handoff to TWO boundaries: warm M insts unrecorded,
  snapshot+reset `mcycle`/`minstret` at the M->T boundary, measure T insts, then drain.
  Touches the single-boundary trigger and the per-insn tick.
- Key files: `verilator/src/hybrid/icount_trigger.hpp`, `verilator/src/simulator.hpp:263-277`,
  `qemu_plugin/hybrid_handoff.c:363-368,507-516`
- TDD: RED doctest in `tests/hybrid` asserting the counter delta over T excludes the M
  window (warmup insts not counted); then GREEN.

### F3 - hsim icount mode threads N/M/T (behavioral)
- State: TODO
- Depends on: F1, F2
- Description: add `--warmup M` / `--measure T` (with existing `--qemu-icount N`); wire
  through `_run_drain_pair` (296-369) / `_vsim_drain_argv` (279-293). Report cycles +
  instret delta over the T window.
- Key files: `hsim`
- TDD: RED `tests/hsim/test_hsim_icount.sh` asserts N/M/T forwarded + clean T-window report.

### F4 - SimPoint per-slice warmup (behavioral)
- State: TODO
- Depends on: F2, F3
- Description: warm `warmup_interval` insts before EACH representative slice in the phase
  loop (mirrors gem5 `set_warmup_intervals`), reusing F2's mechanism.
- Key files: `hsim` `cmd_estimate` (1113-1207)
- TDD: RED estimate test asserts each phase warms before measuring; then GREEN.

### F5 - demos/tests realignment (structural + behavioral)
- State: TODO
- Depends on: F1, F3, F4
- Description: 4 headline demos (csr/pc/icount/simpoint); T4-T6 become SimPoint sub-steps
  or internal helpers. Update `scripts/run_e2e.sh` DEMO_TESTS labels (102-113) and
  `hsim` `_demo_order` (575-583). Coordinate with gemm_modes.md fixture choices.
- Key files: `tests/demos/*`, `scripts/run_e2e.sh`, `hsim`
- Verify: `bash scripts/run_e2e.sh FILTER=demo JOBS=8` green.

---

## Out of scope
- Deeper pipeline counters beyond mcycle/minstret (would need RTL/Verilator signal taps) -
  separate large effort. icount/SimPoint report cycles + IPC only.

## Final verification
- `grep -rnE "\bM[1-8]\b" docs/ CLAUDE.md gemm_modes.md` -> only intentional migration notes.
- `./hsim list modes` emits 4 modes (after F1) and matches the docs.
- `bash scripts/run_e2e.sh` (JOBS=8) green after F5.

## Risks
- Docs lead code for icount warmup (F2/F3 net-new): the icount mode section must carry a
  visible `Status: planned` until F2/F3 land, or it describes unbuilt behavior.
- F2 counter reset must not corrupt the QEMU2 handback (mcycle/minstret are restored at
  vsim entry, `resume_driver.hpp:124-130`; the reset is an M->T-local snapshot only).

## Progress log
- (none yet)
