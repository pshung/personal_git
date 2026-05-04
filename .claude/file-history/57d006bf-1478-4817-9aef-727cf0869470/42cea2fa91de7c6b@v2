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
