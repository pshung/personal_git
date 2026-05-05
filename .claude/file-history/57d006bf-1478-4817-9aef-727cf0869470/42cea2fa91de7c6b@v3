# Hybrid Simulator: QEMU + Verilator (vsim)

A plan to extend `vsim` from a pure Verilator cycle-accurate simulator into a hybrid functional/RTL simulator that runs the boring code in QEMU at MHz speed and switches into Verilator only for the cycle-accurate region of interest (ROI), then optionally hands back.

---

## 1. Context

`vsim` runs at 5-9 KHz on Andes RISC-V cores. A typical workload spends >99% of cycles in boot, libc init, and warm-up before reaching the kernel under study. Today the only escape hatch is `--save`/`--continue`, which still requires an initial RTL run to reach the snapshot point. There is also already a `--kanata-loop-{start,end,skip,record}` mechanism (`src/main.cpp:183-214`) that identifies the interesting loop iterations.

We want: run everything before the ROI in QEMU (functional, MHz), hand the architectural state to Verilator at the ROI boundary, run the ROI cycle-accurately to record kanata/clarity pipeline data, and optionally hand back to QEMU to finish.

The intended outcome: 100x-1000x reduction in wall-clock time for benchmarking workflows that only care about steady-state pipeline behavior of a small kernel, with byte-identical kanata output for the recorded window vs. a fully-RTL baseline.

---

## 2. Tutorial: Why This Is Technically Feasible

### 2.1 The state-exchange problem, reframed

A naive hybrid sim has to "transfer" CPU state between two simulators. In practice the state splits into three categories with very different costs:

| Category | Items | Size | Strategy |
|---|---|---|---|
| Architectural regs | x0..x31, f0..f31, V regs, key CSRs | 4-8 KB | **Copy** via well-defined ABI struct |
| Memory | guest RAM, ILM/DLM | MB-GB | **Share** via `mmap` - zero copy |
| Microarchitectural state | TLB, caches, BPU, store buffer | KB-MB | **Discard** - let cold starts repopulate |

The key trick: **memory does not move**. QEMU runs with `-object memory-backend-file,share=on,mem-path=/dev/shm/vsim-ram`. vsim's `SimpleMemory::data` (`src/platform/simple_memory.hpp:20`) is changed to an `mmap` of the same fd. Both simulators read and write the same physical bytes. The same trick is used by QEMU's CPR (`docs/devel/migration/CPR.rst`) and gem5's `SimpleSwitchableProcessor`. RAM size becomes irrelevant.

Microarch state is intentionally discarded. We accept cold caches/BPU on entry into Verilator and rely on the existing `kanata_loop_skip N` mechanism to warm them up before recording. This matches the gem5 "switch + warmup" pattern.

### 2.2 The trigger: a magic CSR convention

We need both sides to agree on "the ROI starts here." Reuse the user-defined CSR space at `0x7C0`:

```asm
csrwi 0x7C0, 0   # enter detail (QEMU -> vsim)
csrwi 0x7C0, 1   # exit detail  (vsim -> QEMU)
```

- **QEMU** sees this via a TCG plugin: `qemu_plugin_register_vcpu_insn_exec_cb()` with a per-instruction filter that pattern-matches the encoding of `csrrw rd, 0x7C0, rs1` (mask `0xfff03073` against the 32-bit insn). On hit, the plugin drains state and exits.
- **vsim** sees this via the existing retire signal taps in `src/signals/common_signals_45.hpp`. We pre-scan the ELF for PCs containing `csrw 0x7C0, *` (LIEF is already linked - `src/utils/elf_loader.hpp`), then watch for retire-of-PC against that set.

Phase 4 lifts this further: `--kanata-loop-start <pc>` and `--kanata-loop-end <pc>` already specify the ROI by PC. The orchestrator wraps these as PC-trigger events and **the binary needs no magic CSR at all**.

We deliberately avoid `tohost`/`fromhost` (HTIF reserved) and `ecall` (already used by the runtime).

### 2.3 The write-back path: existing JTAG/DTM, in-process

This is the highest-leverage finding. vsim already has:

- `src/platform/jtag_dtm.hpp` - a full JTAG DTM implementation with the RISC-V Debug Module
- `--jtag-port` CLI flag and OpenOCD support (`src/main.cpp:148-154`)

The RISC-V Debug Spec gives Abstract Commands that read/write GPRs (`regno` 0x1000-0x101F), FPRs (0x1020-0x103F), and CSRs (0x0000-0x0FFF) directly via the Debug Module. **Writing all 32 GPRs + 32 FPRs + ~20 critical CSRs is ~85 DMI transactions**, which is ~hundreds of cycles - negligible compared to the millions of cycles we save.

We drive the DTM **in-process**, calling its `handle_dmi_*` methods directly without an OpenOCD socket. No DPI shim, no Verilog modifications, no per-CPU-variant code (works for all ten CPU wrappers in `src/cpu_wrappers/`).

The sequence to "resume from QEMU state":

1. Reset CPU; halt request via DM
2. For each register in the ABI struct, issue Abstract Command (`regno` + data)
3. Set DPC = saved PC
4. Issue `dret` via Program Buffer

Vector registers and any CPU-specific custom CSR that DM doesn't expose are deferred to Phase 5. If DM coverage is incomplete we add a per-CPU Program Buffer fallback or, last resort, an mmap-shared V regfile via DPI.

### 2.4 The QEMU side: a TCG plugin against the existing build

`/local/nick/qemu_v5/build/qemu-system-riscv64` is QEMU **9.2.0** (verified). This is recent enough for the full plugin API:

- `qemu_plugin_register_vcpu_insn_exec_cb()` - per-insn callback
- `qemu_plugin_get_registers()` / `qemu_plugin_read_register()` - drain GPR/FP/CSR
- `qemu_plugin_request_exit()` - stop QEMU cleanly

Templates already on disk: `/local/nick/qemu_v5/contrib/plugins/{execlog.c, hotblocks.c, bbv.c}`. We add one new plugin `hybrid_handoff.c` next to them. No QEMU patches, no fork.

### 2.5 What does NOT work and is out of scope

- **MMIO inside the ROI**: device state lives in QEMU C and has no mirror in RTL. Document; fail loudly via an interconnect watch in Phase 5.
- **lr/sc reservations across handoff**: invalidate at handoff; do not transfer.
- **Self-modifying code in the ROI**: the magic CSR is a synchronization boundary by convention.
- **mcycle/minstret continuity**: monotonic across handoffs but not equal to a fully-RTL run; documented discontinuity.
- **Andes-internal QEMU fork** (`andescycle-dev-v0.16-17-g03dfe23.tar.gz`): treated as opaque. Plan against mainline QEMU 9.2.

---

## 3. Architecture at a Glance

```
                              shared mmap RAM (/dev/shm/vsim-ram)
                                           |
              +----------------------------+----------------------------+
              |                                                         |
              v                                                         v
       QEMU 9.2.0 + plugin                                    vsim (SystemC + Verilator)
       +---------------------+                                +-----------------------+
       | TCG insn loop       |     state.bin (ABI struct)     | SystemC main loop     |
       | hybrid_handoff.so   |  <-->  [ABI v1 packed]   <-->  | jtag_dtm in-process   |
       | csrw 0x7C0 -> drain |                                | csr_trigger -> drain  |
       +---------------------+                                +-----------------------+
              ^                                                         ^
              |                                                         |
              +--orchestrator script (vsim-hybrid)----------------------+
                  enter-pc / exit-pc mode also supported
```

State exchange contract: a single packed `struct hybrid_state_v1` (header + GPR + FPR + CSR + V) defined in `hybrid/include/state_abi.h`, written atomically (`O_TMPFILE` + `linkat`) at handoff.

---

## 4. Design Decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| a | **JTAG/DTM in-process** for register write-back (vs. DPI shim or synthetic insn stream) | Existing infrastructure (`src/platform/jtag_dtm.hpp`); zero RTL changes; works across all 10 CPU wrappers |
| b | Same for CSRs; Program Buffer fallback for unreachable ones | Same |
| c | **Modify `SimpleMemory` in-place**: backing becomes `std::span<uint8_t>` with optional mmap; existing `std::vector` path retained when mmap unset | All call sites use `.data()`/`.size()` only - both span and vector satisfy. Templated class used as concrete member; forking is worse |
| d | **TCG plugin** (in-process, fastest) against existing QEMU 9.2.0 build at `/local/nick/qemu_v5` | Plugin API is feature-complete in 9.x; templates available; no fork |
| e | **Packed C struct** in shared file (vs. protobuf/JSON) | C-and-C++-compatible single header; zero parse cost; static_assert offsets to catch drift |

---

## 5. Phased Implementation Plan

Each phase lands a working subset and is independently testable.

### Phase 0 - Plumbing, validation, ABI freeze

**Goal**: skeleton in place, riskiest assumptions de-risked, no runtime behavior change.

Deliverables:
- `hybrid/include/state_abi.h` - versioned packed struct: magic `'AHYB'`, version, flags, pc, priv, gpr[32], fpr[32], M-mode CSRs (mstatus, mepc, mtvec, mcause, mtval, mscratch, medeleg, mideleg, mip, mie, mcycle, minstret, satp, pmpcfg[16], pmpaddr[64]), V state (vstart, vtype, vl, vlenb, vreg[32 * MAX_VLEN_BYTES]), 256B trailing reserved.
- `hybrid/include/state_abi_check.h` - `static_assert` on offsets and size.
- `cmake/HybridConfig.cmake` - adds `VSIM_QEMU_ROOT` cache var (default `/local/nick/qemu_v5`), build option `VSIM_ENABLE_HYBRID=ON`.
- `hybrid/scripts/test_dm_coverage.tcl` - 50-line OpenOCD script connecting to vsim's DM, probing which `regno` ranges return success. **De-risks the JTAG decision.** Document output in `hybrid/docs/dm_coverage.md`.

Test: vsim builds with `-DVSIM_ENABLE_HYBRID=ON`, plugin builds against `/local/nick/qemu_v5`, struct `static_assert`s pass.

Risk to escalate: if DM Abstract Commands cannot reach vector regs / Andes-custom CSRs, Phase 5 must add Program Buffer or DPI - decide before starting Phase 2.

### Phase 1 - Shared mmap RAM

**Goal**: vsim runs identically to today, but main memory is mmap-backed when `--shared-mem-path` is set.

Files modified:
- `src/platform/simple_memory.hpp:20` - `std::vector<uint8_t> data` becomes a `std::span<uint8_t> data` plus an optional owning `std::vector<uint8_t> owned_storage_` plus a `bool owns_mapping_` flag. Add a constructor taking `(int fd, size_t offset, size_t size)` that mmaps in.
- `src/platform/platform.hpp` - thread mmap fd from `Simulator` into `main_memory` construction via a `std::optional<MmapBacking>` member.
- `src/main.cpp` - new flags `--shared-mem-path <file>`, `--shared-mem-size <bytes>`. When unset, behave as today.

Files NOT modified (already span-compatible): `src/utils/elf_loader.hpp`, `src/simulator_context.hpp` (uses `.data()`/`.size()` only), `src/simulator.hpp:190,228-230`.

Test: `tests/hybrid/shared_mem_smoke.cpp` - subprocess launches `vsim --shared-mem-path /dev/shm/test_ram --shared-mem-size 256M small_loop.elf`, parent process mmaps the same file, verifies `.text` bytes match objdump and that an in-program store is visible to the parent.

### Phase 2 - One-way handoff: QEMU -> vsim

**Goal**: program runs under QEMU, hits `csrwi 0x7C0, 0`, QEMU drains state and exits. vsim is invoked with `--resume-from-qemu <state.bin>` and runs from the resumed PC to program end.

New files:
- `hybrid/qemu_plugin/hybrid_handoff.c` - modeled on `/local/nick/qemu_v5/contrib/plugins/execlog.c`. TB callback walks insns; per-insn callback registered only on `csrrw rd, 0x7C0, rs1` matches. On fire, dispatch on `rs1` value (0=enter, 1=exit), drain GPR/FP/CSR via `qemu_plugin_read_register()`, write packed struct atomically, call `qemu_plugin_request_exit()`.
- `hybrid/qemu_plugin/meson.build` - builds `libhybrid_handoff.so`.
- `src/hybrid/qemu_resume.hpp` - reads ABI struct, validates magic/version, drives DM via `jtag_dtm` directly (no socket): halt -> for each reg issue Abstract Command -> set DPC -> `dret`.

Files modified:
- `src/main.cpp` - new flag `--resume-from-qemu <file>`, mutually exclusive with `--continue`.
- `src/simulator.hpp:239` - `reset()` extended with "resume from external state" branch that runs after `resetn` is asserted; reuses the existing JTAG infrastructure in-process.

Test: tiny RV64 program:
```asm
_start:
  csrwi 0x7C0, 0
  li a0, 1; li a1, 2; add a2, a0, a1
  li a7, 93; ecall
```
Compile, run under QEMU+plugin, observe state file. Run vsim with `--resume-from-qemu state.bin`, verify `a2 == 3` at retire and exit code 0.

### Phase 3 - Round-trip: vsim -> QEMU

**Goal**: vsim detects exit-detail magic CSR write, drains state, hands back to QEMU on the same shared RAM.

New files:
- `src/hybrid/csr_trigger.hpp` - `CsrTrigger` class. ELF pre-scan computes the set of PCs containing `csrw 0x7C0, *`. Subscribes to retire signals (`wb_i0_pc`/`wb_i0_retire` from `src/signals/common_signals_45.hpp`). On retire-of-PC in the set, decode the saved insn to get `rs1` register, read GPR via existing probe (`gpr_index_hart0`/`gpr_value_hart0` in `src/cpu_wrappers/ax45mpv_premium_cpu_cluster_subsystem.hpp:91-92`). If value=1, signal handoff.
- `src/hybrid/state_drain.hpp` - dual of `qemu_resume.hpp`: halt CPU, read all archregs via DM Abstract Commands, populate ABI struct, msync to file.

Files modified:
- `src/simulator.hpp:289-340` (the `run()` loop) - add `csr_trigger.tick(cpu)` after the per-cycle checks. On drain signal, break loop with new exit code `EXIT_HANDOFF_TO_QEMU = 200`.
- `src/main.cpp` - on `EXIT_HANDOFF_TO_QEMU` plus `--qemu-binary` set, after `sim.cpu.final()` (line 342), `execve` QEMU with `-object memory-backend-file,share=on,mem-path=<shared-mem-path>` and `-plugin libhybrid_handoff.so,resume_from=<state.bin>`. The plugin's `resume_from` mode pokes state back via `qemu_plugin_write_register()` at the first TB callback.

Test: extend Phase 2 program with `csrwi 0x7C0, 1; ecall` after the body. Run vsim with `--resume-from-qemu state_in.bin --qemu-binary /local/nick/qemu_v5/build/qemu-system-riscv64`. Verify the QEMU side processes the ecall and returns 0.

### Phase 4 - Kanata-loop integration

**Goal**: existing `--kanata-loop-start <pc> --kanata-loop-end <pc>` flags drive hybrid mode automatically. **No magic CSR required in the binary.**

New files:
- `hybrid/scripts/vsim-hybrid` (Python orchestrator):
  1. Inspect ELF + user's loop PCs.
  2. Launch QEMU with hybrid plugin in **PC-trigger mode** (`enter_pc=<start>`, `exit_pc=<end>` plugin args).
  3. On QEMU exit, launch vsim in resume mode with state file + the kanata flags unchanged.
  4. On vsim's exit-detail, optionally re-launch QEMU to finish.

Files modified:
- `hybrid/qemu_plugin/hybrid_handoff.c` - PC-trigger mode added; cheap with `qemu_plugin_register_vcpu_insn_exec_cb()`.
- `src/hybrid/csr_trigger.hpp` - sibling `PcTrigger` class for `--hybrid-enter-pc` / `--hybrid-exit-pc` CLI flags.
- `src/main.cpp` - `--hybrid-mode=auto` aliases `--kanata-loop-start/end` to the hybrid PC triggers.

Test: boot a benchmark from `external/ax45mpv_premium/testbench/`, hand off at the steady-state inner loop, record kanata for N iterations in vsim, hand back to QEMU. The recorded kanata file for the captured iterations must be **byte-identical** to a fully-vsim baseline run for the same window (after `kanata_loop_skip` warmup).

### Phase 5 - Hardening

Each item independently scoped:
- **Vector regfile transfer**: measure DM cost; if >100ms per handoff, add mmap-shared V regfile via DPI (mirror the `set_ilm()` pattern in `src/cpu_wrappers/ax45mpv_premium_cpu_cluster_subsystem.hpp:393-441`).
- **FP regs and `mstatus.FS`**: standard handling.
- **PMP**: all 64 pmpaddr/pmpcfg via Abstract Commands.
- **Priv-mode transitions**: set DCSR.prv so `dret` resumes in the right mode.
- **Traps inside ROI**: trap stays in vsim until exit-CSR retires.
- **MMIO touch in ROI**: add an interconnect watch (`src/platform/interconnect.hpp`), fail loudly on non-RAM addresses during the ROI window.
- **mcycle/minstret discontinuity**: sum across handoffs to keep monotonic; document the gap vs. fully-RTL.
- **lr/sc reservations**: explicitly invalidate via DCSR after resume.
- **Multi-hart**: ABI struct already carries per-hart arrays; `_NDS_NHART <= 2` already enforced (`src/cpu_wrappers/ax45mpv_premium_cpu_cluster_subsystem.hpp:37-39`).

Test: torture workload running interrupt-driven code, V+FP active, traps inside ROI, verifying mcycle/minstret monotonic across multiple handoffs.

---

## 6. Critical Files

To modify:
- `src/platform/simple_memory.hpp` - mmap-backed storage (Phase 1)
- `src/platform/platform.hpp` - thread the mmap fd (Phase 1)
- `src/main.cpp` - new CLI flags (Phases 1-4)
- `src/simulator.hpp` - resume-from-qemu hook in `reset()`, csr_trigger tick in `run()` (Phases 2-3)
- `cmake/HybridConfig.cmake` - new build option (Phase 0)

To reuse without modification:
- `src/platform/jtag_dtm.hpp` - in-process DM driver
- `src/signals/common_signals_45.hpp` - retire signal taps
- `src/cpu_wrappers/ax45mpv_premium_cpu_cluster_subsystem.hpp:91-100` - GPR/PC probes
- `src/utils/elf_loader.hpp` - LIEF-based ELF pre-scan for trigger PCs
- `src/main.cpp:183-214` - existing `--kanata-loop-*` flag parsing

To create:
- `hybrid/include/state_abi.h`
- `hybrid/include/state_abi_check.h`
- `hybrid/qemu_plugin/hybrid_handoff.c` + `meson.build`
- `hybrid/scripts/{test_dm_coverage.tcl, vsim-hybrid}`
- `src/hybrid/{qemu_resume.hpp, state_drain.hpp, csr_trigger.hpp}`

External, reused as-is:
- `/local/nick/qemu_v5/build/qemu-system-riscv64` (QEMU 9.2.0)
- `/local/nick/qemu_v5/contrib/plugins/execlog.c` (template)

---

## 7. Verification

End-to-end ladder, each level requires the previous:

1. **Phase 0 build smoke**: `cmake -DVSIM_ENABLE_HYBRID=ON .. && make` succeeds; plugin builds; static_asserts pass.
2. **Phase 1 mmap parity**: `tests/hybrid/shared_mem_smoke.cpp` passes - external mmap reader sees identical bytes to vsim's view.
3. **Phase 2 one-way correctness**: tiny program ends with `a2==3` and exit 0 after handoff.
4. **Phase 3 round-trip**: tiny program with `csrwi 0x7C0, 1; ecall` exits 0; intermediate state file is consumed and discarded.
5. **Phase 4 kanata equivalence**: for a benchmark in `external/ax45mpv_premium/testbench/`, the kanata file produced by hybrid mode (with appropriate `kanata_loop_skip` warmup) is byte-identical to the fully-RTL baseline for the same loop window.
6. **Phase 5 torture**: traps + V + FP + multi-handoff, mcycle monotonic, no MMIO violations.

Speed measurement at each phase: capture wall-clock for a representative workload (e.g., dhrystone, an existing testbench in `external/`). Target after Phase 4: **>=100x** speedup on workloads where the ROI is <1% of dynamic instructions.

Each phase commit follows the project's TDD discipline (see `~/personal_git/.claude/TDD.md`): a failing test first, then the smallest code to pass, then refactor. Commits prefixed `structural:` or `behavioral:`.

---

## 8. Phase 3 E2E Test Expansion

### 8.1 Context

Phase 3 landed the round-trip mechanism. The existing e2e harness `tests/hybrid/roundtrip_e2e.sh` exercises the full QEMU1 -> vsim -> QEMU2 path but with a single fixture (`handoff_roundtrip.S`) that only validates ONE GPR (`a2 == 3`) via the semihosting exit code. The plumbing works, but two large coverage gaps remain before we move on to Phase 4:

- **Register coverage**: 1 of 31 GPRs is observed; ABI-special regs (`sp`/`gp`/`tp`/`ra`/`fp`) are never touched; sign-bit and full-64-bit values are not exercised; the `HYBRID_HANDOFF_RUNTIME` trigger form (`csrrw rd,0x7C0,rs1`) is never fired in e2e.
- **Memory coverage**: zero tests today. Vsim never executes a load/store between the entry and exit triggers, so the integration of the cache/memory subsystem with the resumed state is unverified. Cross-simulator memory survival via shared mmap is also untested at e2e level (Phase 1 isolated unit test only).

### 8.2 What's actually transferable today (constraints on fixture design)

From `state_drain.hpp:28-45`, `resume_driver.hpp:46-68`, `qemu_handback.hpp:122-144`, `gdbstub_client.hpp:66-82`, and `hybrid_handoff.c:101-124`:

| State class | Fully round-tripped? |
|---|---|
| `x1..x31`, `pc` | yes |
| `priv` | hardcoded to 3 in both directions |
| `f0..f31`, all CSRs (mstatus/mepc/mtvec/...), V regs, PMP | NOT transferred (Phase 5) |
| Memory written in vsim, read in QEMU 2 | NOT transferred unless `--shared-mem-path` is wired into `qemu_handback.hpp` (currently it isn't) |

Implication: every Tier-1 fixture must encode pass/fail into a **GPR before the exit csrwi**, then in the QEMU 2 phase (after the csrwi, where DPC lands) verify and ship the result through `SYS_EXIT_EXTENDED`. We cannot use FP/CSR/V state as test channels yet.

### 8.3 Fixture three-phase template

Every new fixture follows this layout (text base `0x80000000`, semihosting param block at `0x80001000` per the existing convention):

```
_start:                          // PHASE A: runs in QEMU 1 (functional)
    <set up initial state>
    csrwi   0x7C0, 0             // QEMU drains x1..x31+pc, exits

phase_b:                         // PHASE B: runs in vsim (RTL, cycle-accurate)
    <transform state under test>
    csrwi   0x7C0, 1             // vsim drains, exits 200
                                 //   on the way out, main spawns QEMU 2
                                 //   gdbstub restores x1..x31+pc, sends c
phase_c:                         // PHASE C: runs in QEMU 2 (functional)
    <fold result into checksum/bitmask in t2>
    li      t0, 0x80001000       // semihosting param block
    li      t1, 0x20026          // ADP_Stopped_ApplicationExit
    sd      t1, 0(t0)
    sd      t2, 8(t0)            // exit_code = checksum (0 == pass)
    li      a0, 0x20             // SYS_EXIT_EXTENDED
    mv      a1, t0
    .option push; .option norvc
    slli x0,x0,0x1f; ebreak; srai x0,x0,0x7
    .option pop
1:  j 1b
```

The single observable signal remains the QEMU 2 process exit code. Per fixture, the bash driver asserts that code matches an expected value (usually 0).

### 8.4 Tier-1 test inventory (no infrastructure changes beyond fixtures)

| Fixture | What it verifies | Pass criterion |
|---|---|---|
| `rt_all_gprs.S` | All 31 GPRs survive QEMU1->vsim->QEMU2. Phase A loads `x_i = 0xA000_0000_0000_0000 + i` for `i=1..31`. Phase B XORs every `x_i` with mask `K=0xDEADBEEFCAFEBABE`. Phase C checks each `x_i == (0xA000_0000_0000_0000+i) ^ K` and sets bit `i` in `t2` on mismatch. | exit 0 (no failed register) |
| `rt_abi_aliases.S` | Pass-through fidelity for `ra(x1)`, `sp(x2)`, `gp(x3)`, `tp(x4)`, `fp(x8)`. Phase A sets each to a distinct page-aligned constant in [0x8010_0000..0x8050_0000]. Phase B does NOT touch them (only csrwi entry+exit). Phase C verifies every alias unchanged; exit-code = first-mismatch index or 0. | exit 0 |
| `rt_sign_bits.S` | 64-bit width fidelity through DM Abstract Commands. Phase A loads `x10..x14` with `0`, `-1`, `0x8000_0000_0000_0000`, `0x7FFF_FFFF_FFFF_FFFF`, `0x0000_0000_FFFF_FFFF`. Phase B is a single nop. Phase C compares element-wise. | exit 0 (no truncation/sign-ext bug) |
| `rt_pc_jump.S` | PC fidelity at the exit boundary. Phase B does `j .+0x40` so the exit csrwi sits 64 bytes ahead of where Phase B started; verifies DPC captured by `state_drain` reflects the post-jump PC, and QEMU 2 lands on Phase C at the right offset. Phase C just exits 0. Wrong PC -> illegal insn / hang -> bash timeout fails the test. | exit 0 |
| `rt_runtime_kind.S` | The `HYBRID_HANDOFF_RUNTIME` trigger path (`csrrw zero,0x7C0,x10` where `x10=1`). Phase A: `li x10, 1`, then `csrrw zero, 0x7C0, x10` (exit-via-runtime form). Wait - this fires at QEMU first, not vsim. Better split: Phase A uses `csrwi 0x7C0, 0` to enter; Phase B has `li x10,1; csrrw x0,0x7C0,x10` to exit through the runtime decode in `handoff_controller.hpp:42-44`. Verifies `decode_csrrw_rs1` + GPR-read-by-rs1 path. | exit 0 |
| `rt_long_roi.S` | Vsim runs a non-trivial ROI: 100-iteration counted loop summing `1..100` into `x10` (expected 5050). Phase B is the loop; Phase C verifies `x10 == 5050`. Catches resume-state corruption only visible after many cycles, and exercises branch/decode through the cycle-accurate pipeline. | exit 0 |
| `rt_mem_loadstore.S` | Vsim memory subsystem under load while resumed from foreign state. Phase A initializes a 64-byte buffer at `0x8000_2000` to a known pattern via `sd` from x10. Phase B reads the buffer back word-by-word, XORs with a constant, writes back, then re-reads and folds into x10 (final checksum). Phase C compares x10 to the pre-computed expected. Exercises load-after-store, RAW within vsim. | exit 0 |
| `rt_unaligned_lh.S` | Halfword/byte loads at unaligned addresses inside vsim ROI. Phase A stores 0xCAFEBABEDEADBEEF at 0x8000_3000 and 0xCAFEBABEDEADBEEF at 0x8000_3008. Phase B does `lh x10, 1(t0)`, `lb x11, 3(t0)`, `lhu x12, 5(t0)`, accumulates into x10. Phase C compares against expected. | exit 0 |

### 8.5 Tier-2 test (requires Phase 1 wiring into handback)

**`rt_shared_mem.sh`**: cross-simulator memory survival via mmap. This is the only test that detects regressions in "memory written in vsim is visible to QEMU 2" - the key promise of the hybrid architecture beyond Phase 3.

Required code change (small, but a real change beyond test scaffolding):
- `src/hybrid/qemu_handback.hpp:84-116` (`detail::spawn_qemu`) accepts an optional `shared_mem_path`. When set, `argv` is rebuilt to add `-object memory-backend-file,id=mem,share=on,mem-path=<path>,size=<size>` and `-machine virt,memory-backend=mem` (replacing `-M virt`).
- `src/main.cpp` plumbs the existing `--shared-mem-path` / `--shared-mem-size` flags into `run_qemu_handback`.
- Bash driver creates `/dev/shm/vsim-rt-shared` of the right size, launches QEMU 1 with `-object memory-backend-file,...,share=on`, vsim with `--shared-mem-path`, and asserts.

Fixture (`rt_shared_mem.S`):
- Phase A: write magic byte pattern (e.g., `0xA5` x 4096) to `0x8001_0000` from x10, csrwi entry.
- Phase B: vsim verifies pattern is intact (loop reading 4 KB into checksum), XORs page in place with `0x5A`, stores result of mask check to x10, csrwi exit.
- Phase C: QEMU 2 reads the same 4 KB through the shared mmap, recomputes checksum (should match `0xA5 ^ 0x5A` = `0xFF` everywhere), folds mismatch count into exit code.

Pass criterion: exit 0 AND wall-clock confirms two-sided visibility (page must be modified by both simulators).

### 8.6 Negative / robustness tests (one-shot, sanity)

| Fixture / driver | What it verifies | Pass criterion |
|---|---|---|
| `rt_corrupt_state.sh` | Reuses a Tier-1 ELF but feeds vsim a truncated `state.bin`. Vsim must fail-fast with a non-200, non-zero exit and a recognizable log line, not segfault or hang. | vsim exit != 200, != 0; stderr matches `state file too small\|invalid magic` |
| `rt_no_qemu_binary.sh` | Same ELF; pass `--qemu-binary /nonexistent`. Vsim's drain still fires; the spawn fails. Verify exit code is propagated as `127` (exec failure), not a hang. | exit 127, no zombie left |
| `rt_gdbstub_timeout.sh` | Provide a stub binary that opens the gdb port but never responds. Vsim's `connect_loopback`+session reads must time out within 5 seconds and exit non-zero, not hang the CTest run. | exit != 0, runtime < 30 s |

These guard against quietly-degrading paths that the happy-path tests can't see.

### 8.7 Infrastructure changes

**`hybrid/test/Makefile`** - add per-fixture build rules. The pattern is mechanical:

```make
RT_FIXTURES := rt_all_gprs rt_abi_aliases rt_sign_bits rt_pc_jump \
               rt_runtime_kind rt_long_roi rt_mem_loadstore \
               rt_unaligned_lh rt_shared_mem

all: spin.elf handoff.elf handoff_exit.elf handoff_roundtrip.elf \
     $(RT_FIXTURES:%=%.elf)

%.elf: %.S handoff_roundtrip.ld     # all fixtures share the existing linker
	$(CC) $(CFLAGS) -c $< -o $*.o
	$(LD) -T handoff_roundtrip.ld -nostdlib -static $*.o -o $@
```

The shared linker script `handoff_roundtrip.ld` is fine for every fixture (one .text at 0x80000000); no per-fixture .ld needed.

**`tests/hybrid/roundtrip_e2e.sh`** - generalize to take a fixture name and an expected exit code. The script keeps its current layout but reads `FIXTURE` and `EXPECT_RC` from env. The single-fixture invocation today becomes `FIXTURE=handoff_roundtrip EXPECT_RC=3 roundtrip_e2e.sh`.

**`cmake/HybridConfig.cmake`** - replace the single `add_test(test_roundtrip_e2e ...)` with a `foreach` over a list of `(name, expect_rc)` pairs:

```cmake
set(VSIM_RT_FIXTURES
  "handoff_roundtrip:3"      # existing
  "rt_all_gprs:0"
  "rt_abi_aliases:0"
  "rt_sign_bits:0"
  "rt_pc_jump:0"
  "rt_runtime_kind:0"
  "rt_long_roi:0"
  "rt_mem_loadstore:0"
  "rt_unaligned_lh:0"
)
foreach(entry ${VSIM_RT_FIXTURES})
  string(REPLACE ":" ";" parts ${entry})
  list(GET parts 0 fname)
  list(GET parts 1 erc)
  add_test(
    NAME test_e2e_${fname}
    COMMAND bash -c "FIXTURE=${fname} EXPECT_RC=${erc} bash ../tests/hybrid/roundtrip_e2e.sh"
  )
  set_tests_properties(test_e2e_${fname} PROPERTIES
    SKIP_RETURN_CODE 77
    LABELS "hybrid-e2e"
  )
endforeach()

# Tier-2 (separate driver because it sets up /dev/shm and adds CLI flags)
add_test(NAME test_e2e_rt_shared_mem
  COMMAND bash ../tests/hybrid/rt_shared_mem.sh)
set_tests_properties(test_e2e_rt_shared_mem PROPERTIES
  SKIP_RETURN_CODE 77 LABELS "hybrid-e2e")

# Negative/robustness
foreach(neg corrupt_state no_qemu_binary gdbstub_timeout)
  add_test(NAME test_e2e_rt_${neg}
    COMMAND bash ../tests/hybrid/rt_${neg}.sh)
  set_tests_properties(test_e2e_rt_${neg} PROPERTIES
    SKIP_RETURN_CODE 77 LABELS "hybrid-e2e")
endforeach()
```

This gives one CTest entry per fixture, individually pass/fail/skip, all under the `hybrid-e2e` label so `ctest -L hybrid-e2e` runs the suite as one unit.

### 8.8 Critical files for this section

To create:
- `hybrid/test/rt_all_gprs.S`, `rt_abi_aliases.S`, `rt_sign_bits.S`, `rt_pc_jump.S`, `rt_runtime_kind.S`, `rt_long_roi.S`, `rt_mem_loadstore.S`, `rt_unaligned_lh.S`, `rt_shared_mem.S`
- `tests/hybrid/rt_shared_mem.sh`, `rt_corrupt_state.sh`, `rt_no_qemu_binary.sh`, `rt_gdbstub_timeout.sh`

To modify:
- `hybrid/test/Makefile` - generalize fixture rule
- `tests/hybrid/roundtrip_e2e.sh` - read `FIXTURE` and `EXPECT_RC` from env
- `cmake/HybridConfig.cmake` - foreach over fixtures
- `src/hybrid/qemu_handback.hpp` - optional `-object memory-backend-file,share=on` in `detail::spawn_qemu` (Tier-2 only)
- `src/main.cpp` - plumb `--shared-mem-path` into `run_qemu_handback` (Tier-2 only)

To reuse without modification:
- `hybrid/test/handoff_roundtrip.ld` - linker script is fixture-agnostic
- `src/hybrid/csr_trigger.hpp`, `handoff_controller.hpp`, `state_drain.hpp`, `qemu_handback.hpp` (except handback's spawn args for Tier-2)

### 8.9 Verification ladder

1. Tier-1 fixtures build under `make -C hybrid/test all`, no toolchain errors.
2. `ctest -L hybrid-e2e --output-on-failure` from the host build dir: existing `test_e2e_handoff_roundtrip` still PASS; each new Tier-1 fixture PASS with exit 0.
3. With QEMU/plugin/ELFs absent (clean container), all e2e tests SKIP (return 77), none FAIL.
4. Tier-2 `rt_shared_mem` PASS after Phase 1 wiring lands; before wiring, it must fail with a clear error rather than silently passing on stale state.
5. Negative tests: `rt_corrupt_state` exits non-zero with the expected log; `rt_no_qemu_binary` and `rt_gdbstub_timeout` complete in under 30 s and propagate non-zero exit codes.
6. Regression detection: deliberately break `state_drain.hpp` (e.g., skip x5 in the loop) and verify `rt_all_gprs` fails with `t2` bit 5 set, identifying the exact register at fault.

Each new fixture follows TDD as before: write the fixture (RED — checksum nonzero), then if needed adjust the simulator code (GREEN), then refactor. Most Tier-1 fixtures should be GREEN immediately if Phase 3 is correct; failures here are bugs the existing single-fixture test couldn't catch.
