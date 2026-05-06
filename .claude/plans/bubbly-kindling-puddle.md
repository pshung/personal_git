# Dual-Mode Phase Switching: CSR + PC Triggers

## Context

The hybrid co-sim today switches QEMU<->vsim phases via a `csrwi 0x7C0, {0,1}`
marker compiled into the test binary. The plugin pattern-matches the insn,
vsim's `CsrTrigger` pre-scans the ELF and intercepts on retire. This is what
`hybrid_plan.md` Phase 3 shipped.

Phase 4 of `hybrid_plan.md` (lines 192-208) anticipated a second mode driven
by *external* PC arguments — the binary is unmodified, the orchestrator passes
addresses. Use case: real benchmarks (Kanata loops, vendor workloads) where we
cannot insert a magic CSR write into the source.

This plan adds the PC-trigger mode while preserving the CSR mode 1:1, then
rewrites the e2e suite so every fixture is exercised under BOTH modes from a
single source binary. No fixture .c/.S file is duplicated; mode selection
happens at the orchestrator (shell driver + cmake) level.

## Approach overview

1. **Plugin** accepts a new `enter_pc=0xHEX` arg. When set, plugin runs in
   strict PC mode: CSR matcher disabled, drain fires when an insn at the given
   vaddr is about to execute. The existing `outfile=PATH` path is unchanged.
2. **Vsim** accepts new `--hybrid-enter-pc` (informational, ignored with a
   warning) and `--hybrid-exit-pc` flags. When `--hybrid-exit-pc` is set,
   `simulator.hpp::enable_hybrid_handoff` skips `scan_buffer` and instead
   inserts a single synthetic hit via a new `CsrTrigger::add_pc_hit(pc, kind)`
   method. `HandoffController` is unchanged — its dispatch on `kind` already
   handles `EXIT`.
3. **Fixtures** gain two global labels: `_hybrid_enter_pc` co-located with
   the entry csrwi, `_hybrid_exit_pc` co-located with the exit csrwi. Same
   binary serves both modes:
   - CSR mode: plugin matches the csrwi insn, vsim's scanner finds it. Labels
     ignored.
   - PC mode: plugin matches the address, drains before the entry csrwi
     retires; vsim's `add_pc_hit` map fires after the exit csrwi retires
     (CSR 0x7C0 is a benign vendor CSR on andes-ax45mp and in the RTL — the
     existing CSR-mode tests already prove a csrwi to it retires harmlessly).
4. **E2E driver**: extend the two existing shell drivers
   (`roundtrip_e2e.sh`, `rt_shared_mem.sh`) with a `TRIGGER_MODE={csr,pc}`
   env var (default `csr`). PC mode resolves enter/exit addresses from the
   ELF via `riscv64-unknown-elf-nm --defined-only` and forwards them to
   plugin and vsim. No new driver script.
5. **CMake** registers a parallel foreach for PC variants of every Tier-1
   and Tier-2 fixture, tagged with CTest LABEL `hybrid-e2e-pc`. Existing
   tests get the LABEL `hybrid-e2e-csr`. `hybrid-e2e` continues to run both.
6. **`run_e2e.sh`** gains a `MODE={csr,pc,both}` env var (default `both`)
   that runs the cross-product. Negative tests (corrupt_state, no_qemu_binary,
   gdbstub_timeout, pty_handback) stay mode-agnostic — they assert orchestrator
   failure modes orthogonal to trigger choice.

Retire ordering is confirmed: vsim's run loop calls `on_retire` with the
*committed* PC (`src/simulator.hpp:428-431`), so drain happens after the
csrwi has retired and DPC points at the next insn. QEMU's plugin callback
runs *before* the insn executes, so QEMU drain captures PC == csrwi PC and
vsim resumes there. Both modes therefore have bit-identical handoff
semantics.

## Detailed design

### Plugin (`/home/nick/work/hybrid_sim/qemu_plugin/hybrid_handoff.c`)

- Add file-scope `static uint64_t enter_pc_arg = 0;` and `static bool pc_mode = false;`.
- In `qemu_plugin_install`: parse `enter_pc=0xHEX` via the existing
  `g_strsplit` loop. On match, `pc_mode = true; enter_pc_arg = strtoull(tok[1], NULL, 0)`.
  Also accept (and reject if both csrwi-style and PC are missing) — `outfile=`
  remains required in either mode. Log
  `fprintf(stderr, "hybrid_handoff: PC-mode enter=0x%lx\n", enter_pc_arg)` on install.
- `vcpu_tb_trans`: if `pc_mode`, drop the `sz != 4` guard and the
  `hybrid_match_handoff_insn` call; instead compare
  `qemu_plugin_insn_vaddr(insn) == enter_pc_arg` and register `on_handoff`
  with `kind = HYBRID_HANDOFF_ENTER` as udata. CSR-mode branch unchanged.
- `on_handoff` is reused verbatim (drains and `exit(0)`).

### Vsim trigger (`/home/nick/work/hybrid_sim/hybrid_vsim/src/hybrid/csr_trigger.hpp`)

- Add a public method:

  ```cpp
  void add_pc_hit(uint64_t pc, hybrid_handoff_kind kind) {
    hits_.insert_or_assign(pc, CsrTriggerHit{kind, /*insn=*/0u});
  }
  ```

  `insn=0` is harmless because `HandoffController` decodes `insn` only on
  the `HYBRID_HANDOFF_RUNTIME` arm; PC mode only inserts `EXIT`.
- `scan_buffer` and `lookup` unchanged.
- No new `PcTrigger` type. The class is already a `pc -> {kind, insn}` map;
  PC mode is just a different way to populate it.

### Vsim CLI + simulator (`src/main.cpp`, `src/simulator.hpp`)

- `main.cpp`: two new flags following the existing `longopt` pattern:
  - `--hybrid-enter-pc <hex>` -> `args.hybrid_enter_pc = stoull(s, nullptr, 0)`.
    Logged with a warning the first time it's read: "entry trigger is
    QEMU's job; --hybrid-enter-pc ignored by vsim".
  - `--hybrid-exit-pc <hex>` -> `args.hybrid_exit_pc = stoull(s, nullptr, 0)`.
- New `Args` fields: `std::optional<uint64_t> hybrid_enter_pc, hybrid_exit_pc;`.
- `simulator.hpp::enable_hybrid_handoff` gains a sibling overload (or a
  default param) that takes `std::optional<uint64_t> exit_pc`. When set:
  skip the `for (auto& seg : elf->segments())` scan loop entirely and call
  `trigger.add_pc_hit(*exit_pc, HYBRID_HANDOFF_EXIT)`. Everything downstream
  (`HandoffController`, `StateDrain`, run loop, exit code) is unchanged.
- `main.cpp`'s call site picks the path based on whether
  `args.hybrid_exit_pc` is set:

  ```cpp
  if (args.hybrid_exit_pc)
    sim.enable_hybrid_handoff(args.elf_file, args.handoff_out, *args.hybrid_exit_pc);
  else
    sim.enable_hybrid_handoff(args.elf_file, args.handoff_out);
  ```

### Fixtures: shared labels (one binary, two modes)

- Asm fixtures (`hybrid/test/rt_*.S`, `handoff_roundtrip.S`): add two globals
  positioned immediately before each csrwi:

  ```asm
  .globl _hybrid_enter_pc
  _hybrid_enter_pc:
      csrwi 0x7C0, 0
      ...
  .globl _hybrid_exit_pc
  _hybrid_exit_pc:
      csrwi 0x7C0, 1
  ```

  For `rt_pc_jump.S`, place `_hybrid_exit_pc` on the live `phase_b_landing`
  csrwi, NOT on the poison `.rept 15 csrwi 0x7C0,1` block (those PCs are
  never reached — the jump skips them).
- C fixtures (`hybrid/test/runtime/rt_c_helpers.h`): rewrite the inline-asm
  helpers so the global labels sit before the csrwi:

  ```c
  static inline void rt_phase_qemu1_drain(void) {
    __asm__ __volatile__(
      ".globl _hybrid_enter_pc\n"
      "_hybrid_enter_pc:\n"
      "csrwi 0x7C0, 0\n");
  }
  static inline void rt_phase_vsim_drain(void) {
    __asm__ __volatile__(
      ".globl _hybrid_exit_pc\n"
      "_hybrid_exit_pc:\n"
      "csrwi 0x7C0, 1\n");
  }
  ```

  Each fixture calls each helper exactly once, so the labels stay unique.
- No Makefile change in `hybrid/test/Makefile` — same compile, same link,
  same single .elf per fixture.

### E2E driver: `TRIGGER_MODE` plumbing

Both `roundtrip_e2e.sh` and `rt_shared_mem.sh` learn this preamble:

```bash
TRIGGER_MODE="${TRIGGER_MODE:-csr}"
PLUGIN_ARGS="outfile=$STATE_QEMU"
VSIM_TRIG_ARGS=()
if [ "$TRIGGER_MODE" = "pc" ]; then
  NM="${NM:-riscv64-unknown-elf-nm}"
  ENTER=$("$NM" --defined-only "$VSIM_ELF" | awk '$3=="_hybrid_enter_pc"{print $1}')
  EXIT=$( "$NM" --defined-only "$VSIM_ELF" | awk '$3=="_hybrid_exit_pc" {print $1}')
  if [ -z "$ENTER" ] || [ -z "$EXIT" ]; then
    echo "FAIL[$FIXTURE]: PC mode requires _hybrid_enter_pc/_hybrid_exit_pc symbols"
    exit 1
  fi
  PLUGIN_ARGS="$PLUGIN_ARGS,enter_pc=0x$ENTER"
  VSIM_TRIG_ARGS=(--hybrid-exit-pc "0x$EXIT")
fi
```

QEMU 1 invocation uses `-plugin "$VSIM_PLUGIN,$PLUGIN_ARGS"`. Vsim invocation
appends `"${VSIM_TRIG_ARGS[@]}"` to its existing argv. Everything else is
identical.

### CMake (`cmake/HybridConfig.cmake`)

- Existing CSR foreach gains `LABELS "hybrid-e2e;hybrid-e2e-csr"`.
- New foreach over the same `VSIM_RT_FIXTURES` list, registering
  `test_e2e_${fname}_pc` with `TRIGGER_MODE=pc bash ../tests/hybrid/roundtrip_e2e.sh`,
  `LABELS "hybrid-e2e;hybrid-e2e-pc"`.
- Same pattern for `VSIM_RT_T2_FIXTURES` (Tier-2). The `rt_c_matmul:0:120`
  timeout extension carries over to the PC variant unchanged.
- Negative drivers (corrupt_state, no_qemu_binary, gdbstub_timeout,
  pty_handback): NO PC variant. Tag them `LABELS "hybrid-e2e"` only.
  Document this with a one-line comment.

### Workspace driver (`/home/nick/work/hybrid_sim/run_e2e.sh`)

- Add `MODE="${MODE:-both}"` (values: csr, pc, both).
- Reshape `TESTS=()` so each entry's command picks up `TRIGGER_MODE` from
  the outer loop. Cleanest: keep TESTS as a list of `name|fixture|expect_rc`
  triples that drive *one* mode, then loop the body over the requested
  modes:

  ```bash
  for tm in csr pc; do
    [[ "$MODE" != "both" && "$MODE" != "$tm" ]] && continue
    for entry in "${TESTS[@]}"; do
      ...
      TRIGGER_MODE=$tm bash -c "$cmd"
      ...
    done
  done
  ```

  Negative tests run only once (mode loop skipped for them). Summary line
  reports per-mode tallies plus a grand total.

## Critical files

| File | Change |
|------|--------|
| `qemu_plugin/hybrid_handoff.c` | parse `enter_pc=`, dual-mode `vcpu_tb_trans` |
| `hybrid_vsim/src/hybrid/csr_trigger.hpp` | add `add_pc_hit(pc, kind)` |
| `hybrid_vsim/src/simulator.hpp` | overload `enable_hybrid_handoff` with optional exit_pc |
| `hybrid_vsim/src/main.cpp` | add `--hybrid-enter-pc`, `--hybrid-exit-pc` flags + warning |
| `hybrid_vsim/hybrid/test/runtime/rt_c_helpers.h` | inline `_hybrid_{enter,exit}_pc` labels in drain helpers |
| `hybrid_vsim/hybrid/test/rt_*.S`, `handoff_roundtrip.S` | add the two global labels |
| `hybrid_vsim/tests/hybrid/roundtrip_e2e.sh` | `TRIGGER_MODE` env, nm-based PC resolution |
| `hybrid_vsim/tests/hybrid/rt_shared_mem.sh` | same `TRIGGER_MODE` plumbing |
| `hybrid_vsim/cmake/HybridConfig.cmake` | parallel foreach + CTest labels |
| `hybrid_sim/run_e2e.sh` | `MODE` env, mode loop |

Reused without modification:

- `hybrid_vsim/src/hybrid/handoff_controller.hpp` (kind dispatch already
  handles EXIT for synthetic hits)
- `hybrid_vsim/src/hybrid/state_drain.hpp`, `qemu_handback.hpp`,
  `gdbstub_client.hpp`, `resume_driver.hpp`
- `hybrid_vsim/hybrid/test/Makefile` (same compile)
- `include/hybrid/insn_match.h`, `state_abi.h`

## TDD sequence (per `~/personal_git/.claude/TDD.md`)

Each step ends with one commit prefixed `structural:` or `behavioral:`.

1. **structural** — add `_hybrid_enter_pc` / `_hybrid_exit_pc` global labels
   to every asm/C fixture and to `rt_c_helpers.h`. Build all fixtures; verify
   `nm` reports both symbols. Re-run the full existing CSR-mode CTest suite
   — must remain green (labels are inert under CSR mode).
2. **structural** — refactor `CsrTrigger`: add `add_pc_hit(pc, kind)`. Unit
   test (new file `tests/hybrid/csr_trigger_pc.test.cpp`): `add_pc_hit(0x80000010, EXIT)`
   then `lookup(0x80000010)` returns `{EXIT, 0}`.
3. **RED** (new test) — `tests/hybrid/handoff_controller_pc.test.cpp`:
   construct `HandoffController` with a CsrTrigger holding only an
   `add_pc_hit` entry; assert `on_retire(exit_pc, fake_gpr)` returns a
   populated `hybrid_state_v1`. Should pass immediately because controller
   logic doesn't care how the map was populated.
4. **behavioral** — vsim CLI and simulator: add `--hybrid-enter-pc` /
   `--hybrid-exit-pc`, plumb to `enable_hybrid_handoff`. Smoke test:
   `sim_<cpu> --hybrid-exit-pc 0x80000010 ...` boots and arms PC mode.
5. **behavioral** — plugin: parse `enter_pc=`, register PC callback, drop
   `sz != 4` guard inside the PC branch. Plugin unit smoke (re-link, run
   QEMU 1 manually with a tiny ELF whose enter_pc is `_start`, verify the
   state file is produced and `pc=` matches `_start`).
6. **structural** — extend `roundtrip_e2e.sh` and `rt_shared_mem.sh` with
   `TRIGGER_MODE`, nm-based label resolution. CSR-mode runs (default) must
   still be byte-identical in behavior.
7. **behavioral** — `TRIGGER_MODE=pc bash roundtrip_e2e.sh` for one Tier-1
   fixture (pick `rt_pc_jump` — its label placement is the trickiest, so it
   pins the contract). Should PASS with exit 0.
8. **structural** — CMake: add the parallel foreach for `_pc` variants and
   the CTest LABELs. `ctest -L hybrid-e2e-csr` runs current tests; `-L
   hybrid-e2e-pc` runs new ones; bare `-L hybrid-e2e` runs both.
9. **behavioral** — `run_e2e.sh` MODE env. Default `both` runs the cross
   product. Verify summary tallies.

## Verification ladder

End to end, each step requires the previous:

1. **Unit**: `csr_trigger_pc.test.cpp` and `handoff_controller_pc.test.cpp`
   pass.
2. **CLI smoke**: `sim_<cpu> --help` lists the new flags; `sim_<cpu>
   --hybrid-exit-pc 0xDEADBEEF /dev/null` exits with a clean parser error
   (not crash).
3. **Plugin smoke**: manual QEMU 1 run with `enter_pc=` produces a state
   file whose `pc` matches the requested address.
4. **Per-fixture e2e**:
   - `TRIGGER_MODE=csr FIXTURE=rt_pc_jump EXPECT_RC=0 bash roundtrip_e2e.sh` PASS
   - `TRIGGER_MODE=pc  FIXTURE=rt_pc_jump EXPECT_RC=0 bash roundtrip_e2e.sh` PASS
5. **CTest sweep**:
   - `ctest -L hybrid-e2e-csr --output-on-failure` -> all 13 existing tests PASS
   - `ctest -L hybrid-e2e-pc  --output-on-failure` -> all 13 PC variants PASS
   - `ctest -L hybrid-e2e -j` -> 26 hybrid + 4 negatives = 30 PASS
6. **Workspace driver**: `MODE=both bash run_e2e.sh` -> "summary: csr 14
   passed / pc 14 passed / 0 failed". `MODE=pc bash run_e2e.sh -- FILTER=rt_c_matmul`
   runs just the PC matmul test.
7. **Regression bait**: deliberately swap the two label names in one
   fixture — PC variant of that fixture must FAIL with a clear "QEMU 1 did
   not produce state" or vsim timeout. CSR variant unaffected.
8. **Mode separation**: with `enter_pc=` set, plugin must NOT drain on a
   csrwi anywhere else in the binary — verify by adding a stray `csrwi
   0x7C0, 0` mid-fixture and confirming PC mode only drains at
   `_hybrid_enter_pc`. Remove the bait afterward.
