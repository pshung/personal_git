# Plan: Consolidate switching modes 8 -> 4 (docs-first)

## Context

The repo documents 8 switching "modes" (M1-M8). They are confusing because they
mix three different axes pretending to be one list: the drain TRIGGER (M1 csr,
M2 pc, M3 icount, M5 slice), a PROFILING sidecar (M4 bbv), a PERSISTENCE pair
(M6 emit, M7 replay), and a TERMINATION signal (M8 QEMU2 exit).

Decision (this is the new top-level model): present exactly **4 modes**, named by
user intent and split by what they profile.

| # | Mode | Profiles | Boundary picked by | Absorbs (old) |
|---|------|----------|--------------------|---------------|
| 1 | CSR | a kernel | `csrwi 0x7C0,0/1` markers in source | M1 |
| 2 | PC | a kernel | PC / symbol address (no source edit) | M2 |
| 3 | icount | a sampled window of the whole program | N QEMU fast-fwd, M vsim warmup, T vsim measure | M3 |
| 4 | SimPoint-driven | the whole program | clustering picks representative slices; each measured like icount | M4+M5+M6+M7 |

- Split by target: CSR/PC profile a **kernel**; icount/SimPoint **sample the whole program**.
- **Mode 4 = mode 3 repeated**: SimPoint clustering picks the slice indices; each
  representative slice is fast-forwarded, warmed, and measured exactly like icount,
  then weight-combined. M4 profile / M5 slice / M6 archive / M7 replay become labeled
  STAGES of SimPoint mode, not peer modes.
- **M8 is demoted**: QEMU2's semihosting exit is "the run's tail," not a selectable mode.
- **Warmup** follows `~/work/gem5/specs/warmup.md`: run unrecorded insts on the detailed
  model, reset counters, then measure. In hybrid_sim the detailed model is vsim itself
  (no cheap intermediate), so warmup fills ALL microarch state vsim models (caches +
  predictor + pipeline) - gem5's cold-predictor caveat does NOT apply - but warmup costs
  the same per-inst as measurement, so M cannot be huge.

Scope chosen: **docs-first** (lock the model in docs now), then a ROADMAP drives code.
gemm_modes.md (in-flight) is **orthogonal**: its one-GEMM fixture unification (F1-F8)
stays; its demo-mapping table + F9 are realigned to the 4-mode naming.

What does NOT exist yet (confirmed in tree, so docs lead code here):
- icount warmup/measure split: `IcountTrigger` is single-boundary
  (`verilator/src/hybrid/icount_trigger.hpp:26-49`); no mid-run counter reset.
- vsim exposes only `mcycle`/`minstret` (`include/hybrid/state_abi.h:65-66`); no deeper
  pipeline counters. "pipeline information" = cycles/IPC for now.
- PC/ROI resolution is already cleanly extracted (uncommitted `tests/lib/roi.sh` +
  `roi.test.sh`) - PC mode infra is being tidied, not removed.

---

## Phase A - executable now (docs + ROADMAP.md)

### A1. Rewrite `docs/switching_modes_tutorial.md`
- Quick map (lines 28-43): replace the 8 M-rows with the 4-mode table above, grouped
  by target (kernel: CSR, PC; whole-program: icount, SimPoint). Add a one-line
  "infrastructure, not modes" note for archive/replay/end-of-program.
- Per-mode sections: 4 sections.
  - CSR (from M1 sec 77-139), PC (from M2 sec 142-211): relabel, drop M-prefix.
  - icount (from M3 sec 213-253): EXPAND to the N/M/T flow + warmup; mark the
    warmup/measure split `Status: planned (ROADMAP F2/F3)` since code lags.
  - SimPoint-driven: fold M4 (257-318) + M5 (320-377) + M6/M7 (381-457) + T7
    (461-501) into ONE section with labeled stages (profile -> cluster -> per-slice
    {fast-fwd, warmup, measure} -> weight-combine). T7 demo stays the headline.
- Decision flow (557-576): rewrite to "kernel? CSR if editable else PC. whole program?
  icount for one window, SimPoint for representative windows."
- Review checklist (593-607): fix the STALE line claiming a CTest `switching-mode`
  label - it was removed (`verilator/cmake/HybridConfig.cmake:120-125`); e2e runs via
  `scripts/run_e2e.sh`.

### A2. Update `docs/USER_GUIDE.md`
- Intro line 8 ("Pick a switching mode (M1..M8)") and cheat-sheet line 59
  ("trigger modes (M1..M8)") -> 4 modes.
- Section 3 (437-463): rewrite the 8-row table + decision flow to the 4-mode,
  split-by-target form. KEEP the "writing a kernel for cycle measurement" callout
  (465-472).
- Section 4 (476-844): reorganize the 8 walkthroughs (4.1-4.7) into 4 mode sections;
  the SimPoint section folds today's 4.4/4.5/4.6/4.7 (bbv/slice/archive/estimate/T7)
  as stages. icount section gains the N/M/T warmup walkthrough (planned-marker).
- Section 5 (863-866): note csr/pc go through `tests/e2e.sh`, icount/slice via
  `_run_drain_pair`, SimPoint via `hsim estimate`.

### A3. Update `CLAUDE.md` "Trigger Modes" (~99-102)
- Currently names only CSR + PC. State the 4 modes so the project doc matches.

### A4. Realign `gemm_modes.md` (orthogonal)
- Mapping table (32-46): regroup T4-T7 under "SimPoint-driven mode (stages)"; keep the
  MARKED/MARKERLESS builds and ELF names.
- F9 (145-151): note docs now use the 4-mode model.

### A5. Create `ROADMAP.md` (the deferred code work; one feature per session, TDD)
Captured below so nothing is lost. NOT executed in Phase A.

---

## Phase B - code (in ROADMAP.md, one feature per session, RED test first)

| F | Type | Description | Key files | Test (RED first) |
|---|------|-------------|-----------|------------------|
| F1 | structural | `hsim` mode surface: MODES array + `list_modes` present 4 user modes (csr/pc/icount/simpoint); reclassify bbv/slice/archive/replay/end-of-program as stages/subcommands, not top-level modes | `hsim:42-51,122-128` | `tests/hsim/test_hsim_list.sh` asserts 4 modes |
| F2 | behavioral | vsim icount warmup (core, net-new): extend icount handoff to TWO boundaries - warm M unrecorded, snapshot+reset `mcycle`/`minstret` at the M->T boundary, measure T, then drain | `verilator/src/hybrid/icount_trigger.hpp`, `simulator.hpp:263-277`, `qemu_plugin/hybrid_handoff.c:363-368,507-516` | `tests/hybrid` doctest: counter delta over T excludes the M window |
| F3 | behavioral | `hsim` icount mode threads N/M/T: `--qemu-icount N`, `--warmup M`, `--measure T`; report cycles+instret delta over T | `hsim` `_run_drain_pair:296-369`, `_vsim_drain_argv:279-293` | `tests/hsim/test_hsim_icount.sh` |
| F4 | behavioral | SimPoint mode warmup: warm `warmup_interval` before EACH representative slice (mirrors gem5 `set_warmup_intervals`) | `hsim` `cmd_estimate:1113-1207` | `tests/hsim` estimate test asserts per-phase warmup |
| F5 | structural+behavioral | demos/tests realignment: 4 headline demos (csr/pc/icount/simpoint); T4-T6 become SimPoint sub-steps; update `scripts/run_e2e.sh` DEMO_TESTS labels; coordinate with gemm_modes.md | `tests/demos/*`, `scripts/run_e2e.sh:102-113`, `hsim` `_demo_order:575-583` | `bash scripts/run_e2e.sh FILTER=demo` green |

Out of scope (note in ROADMAP): deeper pipeline counters beyond mcycle/minstret would
need RTL/Verilator signal taps - separate large effort.

---

## Critical files
- `docs/switching_modes_tutorial.md` (608 lines) - primary rewrite.
- `docs/USER_GUIDE.md` (913 lines) - Section 3 + Section 4 rewrite.
- `CLAUDE.md` - Trigger Modes note.
- `gemm_modes.md` - mapping table + F9 realign.
- `ROADMAP.md` - new, code features above.
- Reuse: `tests/lib/roi.sh` (PC/ROI resolution, already done); `hsim cmd_estimate`
  (SimPoint phase aggregation, already done); gem5 `warmup.md` (warmup spec).

## Verification
- Docs: `grep -rnE "\bM[1-8]\b" docs/ CLAUDE.md gemm_modes.md` returns only intentional
  "formerly M1-M8" migration notes - no stray mode numbers.
- Cross-references between USER_GUIDE.md and switching_modes_tutorial.md resolve.
- `./hsim list modes` reconciled with docs (docs state the 4-mode model is the target;
  F1 makes the code emit 4).
- Each Phase-B feature: its own RED test first, then GREEN (TDD.md), then
  `bash scripts/run_e2e.sh` (JOBS=8) green once F5 lands.
