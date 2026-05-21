# Phase 5: Transparent V-register transport via Program Buffer

## Context

Today V registers cross the QEMU1 -> vsim -> QEMU2 handoff through a guest-RAM
scratch region (`kVScratchGpa = 0x00FF0000`). The host->RAM staging is done by
vsim (`stage_v_to_scratch` / `read_v_from_scratch`), but the actual
`vle8.v`/`vse8.v` sweep that moves bytes between scratch RAM and the hart's V
regfile is issued by the **fixture binary** in M-mode
(`tests/fixtures/runtime/v_regfile_xfer.c`, called as `v_regfile_reload_all()` /
`v_regfile_dump_all()` in `rt_c_v_regs.c`).

That leaks transport plumbing into every V-using benchmark and forces a fragile
dual literal: the `li t0, 0x00FF0000` in the fixture asm must match the C++
`kVScratchGpa` by hand.

**Goal:** move the `vle8.v`/`vse8.v` sweep into vsim, executed via the RISC-V
Debug Module **Program Buffer (PB)** while the hart is halted. Benchmark
binaries then need zero V-transport code - they just call
`enter_vsim()`/`exit_vsim()`. This is the PB option named in `hybrid_plan.md:67`
and `:141` (the doc's `>100ms`-gated alternative was DPI; we choose PB because it
reuses existing PB infrastructure and needs no per-CPU RTL backdoor like
`set_ilm()`).

**Scope (confirmed): transport only.** ROI-boundary hardening (making
`enter_vsim`/`exit_vsim` out-of-line so a cycle-measuring kernel cannot drift out
of the measured window) is a separate follow-up, NOT part of this phase. The
correctness fixtures stay green with the existing markers + `"vr"` force-live
guards because all 32 V regs round-trip bit-identically.

## Core architecture

The scratch-RAM staging stays. Only the *issuer* of the load/store moves: from
the fixture (M-mode) to vsim (debug mode, via PB). Data source is unchanged.

```
RESUME (inside ResumeDriver::resume, HYBRID_FLAG_V):
  simulator.hpp: stage_v_to_scratch(state.vreg[] -> RAM[0xFF0000])   <-- moved BEFORE resume()
  1. enable mstatus.VS                                  (exists)
  2. NEW reload sweep:
       x5=vlenb, x6=0xC0(e8m1ta ma); vsetvl x0,x5,x6   (vl=vlenb, vstart=0)
       for i in 0..31: x7 = 0xFF0000 + i*HYBRID_VLEN_BYTES_MAX
                       vle8.v vi,(x7)                    (1-insn PB each)
  3. architectural V-CSR restore (vsetvl from state.vl/vtype, vstart, ...)  (exists; overwrites sweep's vtype/vl/vstart)
  4. GPR loop x1..x31                                    (exists; overwrites x5/x6/x7)
  5. mcycle/minstret restored to exact QEMU1 values      (exists; LAST -> sweep insns cannot pollute counters)

DRAIN (inside StateDrain::drain_with_passthrough, HYBRID_FLAG_V):
  1. read x1..x31+pc, FPR, V-CSRs, mcycle/minstret        (exists; ALL reads first)
  2. NEW dump sweep (LAST):
       x5=vlenb, x6=0xC0; vsetvl x0,x5,x6                 (vstart=0)
       for i in 0..31: x7 = 0xFF0000 + i*HYBRID_VLEN_BYTES_MAX
                       vse8.v vi,(x7)
  simulator.hpp: read_v_from_scratch(RAM[0xFF0000] -> state.vreg[])  (unchanged, still after drain)
```

Why this ordering is correct (validated):
- **Counters clean:** resume restores mcycle/minstret *after* the sweep; drain
  reads them *before* the sweep. Sweep insns never appear in the measured count.
  No `dcsr.stopcount` dependency.
- **vstart safe:** every sweep leads with `vsetvl`, which forces `vstart=0`, so
  the unit-stride `vle8.v`/`vse8.v` always covers the full register even if the
  drained hart had `vstart != 0`. **Keep the `vsetvl` in every sweep** - dropping
  it reintroduces a partial load/store bug.
- **No GPR leak:** sweep uses x5/x6/x7 as scratch; the GPR loop restores them
  from `state.gpr[]` afterward (resume), or they were already captured before the
  sweep (drain), and QEMU2 restores all GPRs regardless.
- **Stride = compile-time `HYBRID_VLEN_BYTES_MAX` (64), NOT runtime `vlenb`.**
  Staging lays each reg at `i*HYBRID_VLEN_BYTES_MAX`; the PB pointer must use the
  same stride. Load count per reg = `vlenb` (vl set via vsetvl e8m1). They
  coincide only at VLEN=512; the constant is the correct one.

## Reuse (do not reinvent)

- `exec_progbuf(bus, span)` - `verilator/src/hybrid/program_buffer.hpp:76`
- `encode_vsetvl(rd,rs1,rs2)` - `program_buffer.hpp:46` (reuse for the e8m1 setup)
- `write_64bit_register(regno,val)` - `resume_driver.hpp:138` (abstract GPR write)
- `regno_gpr(i)` - `abstract_command.hpp:15`
- `kVScratchGpa`, `kVScratchBytes`, `HYBRID_VLEN_BYTES_MAX` - `v_regfile_xfer.hpp:45,49` / `state_abi.h`
- `stage_v_to_scratch` / `read_v_from_scratch` - `v_regfile_xfer.hpp:76,87` (KEEP - host<->RAM copy unchanged)
- RecordingBus + `regfile` map + progbuf-scan assertion idiom - `tests/hybrid/recording_bus.hpp`, `resume_driver.test.cpp` (Tier-B vsetvl test), `program_buffer.test.cpp`

## Feature breakdown (one per session, TDD RED -> GREEN, structural/behavioral split)

### F1 - RVV unit-stride load/store encoders
- **Behavior:** `encode_vle8_v(vd,rs1)` and `encode_vse8_v(vs3,rs1)` constexpr.
  - `encode_vle8_v = (1u<<25)|((rs1&0x1F)<<15)|((vd&0x1F)<<7)|0x07u`
  - `encode_vse8_v = (1u<<25)|((rs1&0x1F)<<15)|((vs3&0x1F)<<7)|0x27u`
- **RED:** add cases to `tests/hybrid/program_buffer.test.cpp` asserting golden
  hex. Confirmed values: `vle8.v v0,(x7)=0x02038007`, `v3=0x02038187`,
  `v31=0x02038F87`; `vse8.v v0,(x7)=0x02038027`, `v3=0x020381A7`,
  `v31=0x02038FA7`. Cross-check one value with the Andes assembler
  (`echo 'vle8.v v3,(t2)' | riscv64-...-as` + objdump) as ground truth before
  trusting the formula.
- **Files:** `verilator/src/hybrid/program_buffer.hpp` (next to encode_vsetvl),
  `tests/hybrid/program_buffer.test.cpp`.
- **Deps:** none.

### F2 - ResumeDriver PB reload sweep
- **Behavior:** private `reload_v_data(const hybrid_state_v1&)` doing step 2 of
  the resume diagram; call it inside `resume()` under `HYBRID_FLAG_V`, AFTER
  mstatus.VS enable and BEFORE the existing architectural V-CSR block
  (`resume_driver.hpp:90-104`). Use x5/x6 for the e8m1 vsetvl, x7 for the base
  pointer (stride `HYBRID_VLEN_BYTES_MAX`). Update the line 88-94 / 117 comments
  to list x7 as scratch.
- **RED:** new case in `resume_driver.test.cpp`: set `HYBRID_FLAG_V`,
  `state.vlenb=64`; scan `bus.ops` and assert (a) a `kProgbuf0` write equal to
  `encode_vle8_v(i,7)` exists for every i in 0..31, (b) each is preceded by an
  abstract x7 write of `kVScratchGpa + i*HYBRID_VLEN_BYTES_MAX`, (c) the whole
  sweep precedes the architectural vsetvl (`encode_vsetvl(0,5,6)` from state.vl)
  and the GPR loop, (d) mcycle/minstret COMMAND writes come after the sweep.
- **Files:** `verilator/src/hybrid/resume_driver.hpp`, `resume_driver.test.cpp`.
- **Deps:** F1.

### F3 - StateDrain PB dump sweep
- **Behavior:** private `dump_v_data(uint64_t vlenb)` doing step 2 of the drain
  diagram; call it at the END of `drain_with_passthrough()` under
  `HYBRID_FLAG_V`, after all reads (`state_drain.hpp:71-81`). Header-only and
  shared, so both the CSR-trigger and icount-trigger controllers get it.
- **RED:** new case in `state_drain.test.cpp`: `input.flags |= HYBRID_FLAG_V`,
  `input.vlenb=64`; assert the `vse8.v` progbuf words appear, and that they come
  AFTER the mcycle/minstret read COMMANDs (so counters/V-CSRs are captured pre-sweep).
- **Files:** `verilator/src/hybrid/state_drain.hpp`, `state_drain.test.cpp`.
- **Deps:** F1.

### F4 - simulator.hpp wiring
- **Behavior:** in `apply_resume_from_qemu` move the `stage_v_to_scratch` call to
  BEFORE `driver.resume()` (`simulator.hpp:204-215`) so the PB reload reads
  populated scratch. Drain side unchanged: `read_v_from_scratch` still runs after
  `on_retire` (`simulator.hpp:500-506`).
- **RED:** no SystemC unit test; this is validated by the F5 e2e gate. Treat the
  reorder as a behavioral change verified end-to-end.
- **Files:** `verilator/src/simulator.hpp`.
- **Deps:** F2, F3.

### F5 - Retire fixture-side transport (the payoff)
- **Behavior:** remove `v_regfile_reload_all()`/`v_regfile_dump_all()` calls and
  the `#include "runtime/v_regfile_xfer.h"` from every fixture that uses them
  (confirmed: `rt_c_v_regs.c`; grep `v_regfile_reload_all|v_regfile_dump_all` for
  `rt_c_v_csrs.c`/`rt_c_v_matmul.c`). Delete
  `tests/fixtures/runtime/v_regfile_xfer.{c,h}` and drop them from
  `tests/fixtures/Makefile` (`RT_C_V_RUNTIME_SRCS`). Keep the `"vr"` force-live
  guards. (Per TDD.md: remove the legacy TU, do not patch it.)
- **RED/gate:** the e2e suite IS the test. Before F2-F4 land, a fixture with the
  calls removed fails the round-trip (V regs do not transport); after F2-F4 it
  passes because vsim does the transport. Run `FILTER=rt_c_v` e2e; it must go
  green with the calls gone.
- **Files:** `tests/fixtures/rt_c_v_regs.c` (+ any other caller),
  `tests/fixtures/runtime/v_regfile_xfer.{c,h}` (delete),
  `tests/fixtures/Makefile`.
- **Deps:** F2, F3, F4.

### F6 - Docs
- **Behavior:** update the "V-State Transport" section of `CLAUDE.md`, the header
  comment in `v_regfile_xfer.hpp` (drop "Phase 5 will replace..."), mark the
  V-transfer item done in `hybrid_plan.md`, and update `docs/USER_GUIDE.md`
  (mandated by `CLAUDE.md`: the fixture-author contract no longer requires
  transport calls). Open a follow-up note for the deferred ROI-boundary hardening.
- **Deps:** F5.

## Verification

Hybrid unit tests are SystemC-free (header-only + ABI), so they build/run via the
existing cmake+ctest flow:

```sh
# unit (per feature)
ctest -R test_program_buffer -V      # F1 encoders
ctest -R test_resume_driver  -V      # F2 reload sweep
ctest -R test_state_drain    -V      # F3 dump sweep

# end-to-end (F4/F5): real 3-phase handoff with PB transport, both trigger modes
JOBS=8 FILTER=rt_c_v bash scripts/run_e2e.sh     # must exit 0
```

End-to-end success criteria:
- `rt_c_v_regs` PASS in both `csr` and `pc` modes with the fixture calling only
  `enter_vsim()`/`exit_vsim()` (no transport asm).
- `rt_c_v_regs.elf` no longer links `v_regfile_xfer.c` (it is deleted).
- The QEMU2 `out[]` verification still matches the closed-form FIR, proving all
  32 V regs round-tripped via the PB sweep.

## Out of scope (follow-up)

ROI-boundary hardening: convert `enter_vsim`/`exit_vsim` into out-of-line,
separate-TU functions so a cycle-measuring kernel cannot be hoisted/sunk out of
the measured window. Needed only for benchmark cycle-attribution fidelity, not
for the correctness fixtures. Track separately.
