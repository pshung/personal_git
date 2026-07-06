# Plan: Transport L2C enable/config across the QEMU -> vsim handoff

## Context (why)

Today the hybrid handoff moves only **hart architectural state** (`hybrid_state_v1`:
GPR/FPR/CSR/V/PMP/Andes/M-ext) and **RAM** (the `/dev/shm` shared mmap). **MMIO device
registers are not transported** - each simulator keeps its own device model, so config
QEMU wrote stays in QEMU and vsim's devices start at RTL reset.

The **L2 cache controller (L2C)** is an MMIO block at `0xE0500000` (DS220 24.2 Table 259).
Its **Control Register (offset 0x0008)** holds the L2 enable bit (`CEN`) plus prefetch/ECC/
RAM-timing config. This is **boot-static config that changes ROI cycle behavior on an
L2-enabled engine** - exactly the problem `mcache_ctl` (L1 enable) already solves for the
cycle figure (`resume_driver.hpp:323`), but through **MMIO instead of a CSR**, so the
existing CSR transport does NOT cover it.

**Forward-looking:** every current vsim engine is built `NDS_L2C_CACHE_SIZE_KB=0` (no L2C
region). So this feature must **no-op cleanly today** and **activate automatically when an
L2-enabled engine is built**. This mirrors how the v4 M-ext block is transported
forward-looking and capability-gated.

## What DS220 11.8.5 / 24.2 establish (extracted from the PDF)

- L2C region: `0xE0500000 - 0xE05FFFFF` (matches QEMU memmap and `config.inc`
  `NDS_L2C_REG_BASE=0x00000000E0500000`).
- **Control Register @ +0x0008 (11.8.7), RW** - the enable/config word:
  `CEN[0]` (L2 enable, **reset = 1**), `PFTHRES[2:1]` prefetch throttle (reset 0),
  `IPFDPT`/`DPFDPT` depth, `ECCEN[7]`, `TRAMOCTL/TRAMICTL/DRAMOCTL/DRAMICTL[13:8]` RAM
  timing, `INITSTATUS[14]` (RO status). **This is the register the feature transports.**
- Configuration Register @ +0x0000 (11.8.6): **RO** (SIZE/ECC/MAP derived by HW) - nothing
  to restore, same as `mpl2cm_cfg` in the manifest ("read-only constant, the engine derives it").
- Way Allocation Mask @ +0x0300.. (11.8.17): RW, only matters if a workload partitions L2.
- CCTL command/status, HPM control/counter, error registers: operational/volatile - not boot config.
- **Access rule (11.8.3): single transfer, size < 8 bytes, device non-bufferable.**
  => transport with **4-byte `sw`/`lw`**, NOT 8-byte `sd`/`ld`. All meaningful control
  bits live in the low 32 bits, so one `sw` to 0x0008 covers the whole enable/config word.

## Design decisions (user was away for the scope question - these are the recommended defaults)

1. **Scope = Control Register (0x0008) only.** This is precisely the "enable/config" asked
   for. Wire struct is one `uint64_t`. Way-mask is left as a documented, append-only
   extension point (append to the struct + one more `sw` per register when a partitioning
   workload needs it). *Revisit if you want way-mask now.*
2. **Fix QEMU's reset default.** QEMU models L2C as a **zero-initialized RAM stub**
   (`hw/riscv/andes_ae350.c:1492`, `memory_region_init_ram`). DS220 says `CEN` resets to 1.
   A guest that relies on the default and never writes 0x0008 would drain `CEN=0` and
   wrongly disable L2 in vsim. Proper fix (not a workaround): **initialize the L2C control
   word to its reset value (CEN=1) at machine init**, so an untouched register drains
   faithfully.

## Architecture / data flow (the core to understand)

```
  QEMU phase                         handoff file                vsim phase
  ----------                         ------------                ----------
  guest sw -> 0xE0500008  ]                                   [ ResumeDriver (hart halted):
  (L2C RAM stub, reset     ] drain   hybrid_state_v1  restore  ]   PB: sw ctrl -> 0xE0500008
   value CEN=1 seeded)     ]-------> .l2c.ctrl  +      ------->]   ONLY if engine has L2C
  plugin reads it via      ]         HYBRID_FLAG_L2C           ]   (else skipped - a store to
  qemu_plugin_read_             ^                              ]    an absent region faults)
  memory_hwaddr(0xE0500008)     |                             [ StateDrain: PB lw readback
                          drain-time MMIO read                    -> .l2c.ctrl (for --verify)
```

Three properties that make this safe:
- **Hard capability gate on restore.** Unlike tolerant CSR writes (an absent CSR no-ops),
  a PB store to an unmapped `0xE0500008` **faults the Program Buffer** (`exec_progbuf`
  throws). So the store is issued **only when the vsim engine has an L2C**
  (`has_shared_cache = NDS_L2C_CACHE_SIZE_KB > 0`, `ax45mpv_premium_cpu_cluster_subsystem.hpp:45`).
  On today's engines the restore is skipped entirely - clean no-op.
- **Flag-gated wire block.** `HYBRID_FLAG_L2C` is set by the plugin only when it can read
  the region; clear means the block is zero and every consumer skips it (same discipline as
  `HYBRID_FLAG_ANDES` / `HYBRID_FLAG_M_EXT`).
- **4-byte accesses** per the DS220 bus rule.

## Feature slices (independent; complete ONE per session, TDD each; update states here)

Each slice is RED (write failing test) -> GREEN (smallest code) -> REFACTOR, per TDD.md.

- **F1 - ABI v5 block.** [ ]
  `include/hybrid/state_abi.h` (submodule `andesim_abi`): add `struct hybrid_l2c { uint64_t
  ctrl; }`, `HYBRID_FLAG_L2C (1u<<5)`, append `struct hybrid_l2c l2c;` after `m_ext`, bump
  `HYBRID_STATE_VERSION` to 5, shrink `reserved[]` to keep total size, update
  `state_abi_check.h` static-asserts (offset + size). RED: the size/offset static-assert or
  `tests/hybrid/state_abi.test.cpp` (external vsim) fails until fields land. Commit as a
  submodule bump pinned by SHA.

- **F2 - PB store/load word encoders.** [ ]
  `verilator/src/hybrid/program_buffer.hpp`: add `encode_sw`/`encode_lw` (funct3=010,
  STORE/LOAD opcodes) beside `encode_sd`/`encode_ld`. RED: unit test asserting the exact
  32-bit encodings against hand-computed values (mirror existing encoder tests).

- **F3 - ResumeDriver L2C restore.** [ ]
  `verilator/src/hybrid/resume_driver.hpp`: after the `mcache_ctl`/`mmisc_ctl` block
  (`:331`), add `restore_l2c(state)` guarded by `HYBRID_FLAG_L2C` AND the engine-L2C-present
  cap. Sequence reuses existing primitives: `write_register_abstract(bus_, regno_gpr(A),
  l2c_base+0x8)`, `write_register_abstract(bus_, regno_gpr(V), state.l2c.ctrl)`,
  `exec_progbuf({encode_sw(V, A, 0)})`. Use post-GPR-loop scratch regs (x5-x7 are free
  there, per the mcycle comment `:339`). RED: recording_bus unit test asserts the DMI
  write sequence (data0/data1 + access-register command + progbuf words + exec) and that a
  cleared flag / absent cap issues **nothing**.

- **F4 - StateDrain L2C readback.** [ ]
  `verilator/src/hybrid/state_drain.hpp`: in `drain_with_passthrough`, after the CSR drains
  and before/with the V dump, add `drain_l2c(state)`: `write_register_abstract(addr)`,
  `exec_progbuf({encode_lw(V, A, 0)})`, `read_register_64(regno_gpr(V))` -> `state.l2c.ctrl`.
  Gated identically. RED: recording_bus unit test.

- **F5 - Engine capability plumbing.** [ ]
  Thread `l2c_present` + `l2c_base` from the engine into `ResumeDriver`/`StateDrain`.
  Cheapest: add two setters (`set_l2c(bool present, uint64_t base)`) called from
  `src/simulator.hpp` where it already builds the driver (`:283`) and drain (`:430`), reading
  `has_shared_cache` and `NDS_L2C_REG_BASE`. RED: unit test that the setter off => restore/drain no-op.

- **F6 - QEMU plugin drain.** [ ]
  `qemu_plugin/hybrid_handoff.c`: in `drain_state_into`, read the L2C control word via
  `qemu_plugin_read_memory_hwaddr(l2c_base+0x8, buf, 4)` (VERSION 5 API, already available;
  plugin already uses `GByteArray`). Set `HYBRID_FLAG_L2C` on success. `l2c_base` from a new
  plugin arg (default `0xE0500000`), mirroring how `enter_pc`/`drain_pc` args are parsed.
  RED: `tests/plugin/test_plugin_*.sh` - run a tiny ELF that `sw`s a known value to
  0xE0500008, assert the drained struct field.

- **F7 - QEMU reset default.** [ ]
  `hw/riscv/andes_ae350.c` (after `memory_region_init_ram` for L2C, `:1492`): seed the
  control word with the DS220 reset value (`CEN=1`). RED: test that a guest which never
  writes 0x0008 still drains `ctrl` with bit0 set.

- **F8 - Driver verify compare.** [ ]
  `driver/state_diff.cpp`: add `if (ref.flags & HYBRID_FLAG_L2C) cmp(r, "l2c.ctrl", ...)`.
  Decide exclusion of the RO `INITSTATUS[14]` bit (mask it out of the compare, like `mip` is
  excluded). RED: `driver/state_diff_test.cpp` case.

- **F9 - Docs + manifest.** [ ]
  `docs/USER_GUIDE.md` (transported-state section) + root `CLAUDE.md` (CSR restore split /
  shared-ABI section: note MMIO-config transport now exists, gated by `HYBRID_FLAG_L2C` and
  engine L2C-presence). `tests/engines/gen_manifest.py` already knows `mmsc_cfg3.PL2C==1`
  (`:319`); add an L2C-MMIO row so the per-engine `csr_restore_table.md` records it.

## Verification (end-to-end)

**Testable now** (no L2-enabled engine required):
- Unit: encoders (F2), restore/drain DMI sequences via `recording_bus.hpp` (F3/F4/F5),
  ABI static-asserts + round-trip (F1).
- Plugin drain (F6/F7): real QEMU run, `sw` a value to 0xE0500008, assert the drained field;
  and assert the reset-default seeds CEN=1 without a guest write.
- `driver/state_diff_test.cpp` (F8).
- **Regression gate:** `bash scripts/test_all.sh` + `bash scripts/run_e2e.sh` must stay
  green on current (L2C-absent) engines - proving the flag stays clear and the restore/drain
  are skipped, i.e. clean no-op.

**Deferred** (requires building a vsim engine with `NDS_L2C_CACHE_SIZE_KB>0`): the actual
cycle-fidelity payoff - that transporting `CEN`/config stops the ROI from running with L2 at
the wrong state. Call this out explicitly; it is validated when an L2 engine exists, not in
this change.

## Key files

| File | Change |
|------|--------|
| `include/hybrid/state_abi.h` (submodule) | v5: `struct hybrid_l2c`, `HYBRID_FLAG_L2C`, version+asserts |
| `verilator/src/hybrid/program_buffer.hpp` | `encode_sw`/`encode_lw` |
| `verilator/src/hybrid/resume_driver.hpp` | gated `restore_l2c` (PB `sw`) |
| `verilator/src/hybrid/state_drain.hpp` | gated `drain_l2c` (PB `lw`) |
| `verilator/src/simulator.hpp` | pass `has_shared_cache` + `NDS_L2C_REG_BASE` to driver/drain |
| `qemu_plugin/hybrid_handoff.c` | drain via `qemu_plugin_read_memory_hwaddr`, set flag, `l2c_base` arg |
| `qemu_andesim/hw/riscv/andes_ae350.c` | seed L2C control reset value (CEN=1) |
| `driver/state_diff.cpp` | `HYBRID_FLAG_L2C` compare (mask INITSTATUS) |
| `docs/USER_GUIDE.md`, `CLAUDE.md`, `tests/engines/gen_manifest.py` | doc + manifest row |

## Open items for you

- Confirm **scope** (Control Register only vs +Way-Mask) - default assumed: Control only.
- Confirm the **QEMU reset-default fix** is in scope - default assumed: yes.
