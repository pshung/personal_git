---
name: project_hybrid_cache_csr_not_transported
description: "hybrid handoff omits Andes mcache_ctl(0x7CA)/mmisc_ctl(0x7D0), so vsim resumes with caches OFF -> window cycles ~4x inflated vs cycle model"
metadata: 
  node_type: memory
  type: project
  originSessionId: deb9f9b8-9454-4a56-b6d0-4520be19606f
---

The hybrid handoff ABI (`include/hybrid/state_abi.h` `hybrid_state_v1`) does NOT
carry the Andes custom setup CSRs `mcache_ctl` (0x7CA) or `mmisc_ctl` (0x7D0).
crt0 (`_start`) enables the L1 I/D caches in its first 3 instructions
(`csrsi mcache_ctl,1; csrw mcache_ctl,0x703`). On a `cycle` run or a hybrid
window that starts at `_start`, vsim executes that write -> caches ON. On a
hybrid window whose handoff point is AFTER crt0 (e.g. `--trigger pc --pc-start <main>`
or `--trigger marker`), QEMU runs crt0 (QEMU has no cache model), then vsim
resumes with `mcache_ctl` at reset = caches OFF. The whole measured region then
runs uncached -> ~4x inflated window_cycles.

**Demo evidence** (andes_sim_demo.ipynb, hello.elf, engine vsim:ax45mpv_premium):
- `cycle` whole-program = 3632 cycles (caches on)
- hybrid pc [_start 0x100000, _exit 0x100474] = 3370 (caches on, ~matches cycle)
- hybrid pc [main 0x100074, _exit 0x100474] = 14707 (caches OFF) <- the puzzling 4x
- hybrid pc [main, main+4] 2 insns = 74 (~37 cyc/insn = uncached latency)
A superset window (3370) cheaper than its subset (14707) is impossible unless
cache-enable state differs -> proves the missing CSR.

**Why:** functional engine (QEMU) has no microarch state; the cache-enable bit
lives in a custom CSR that is not part of the transported architectural state.

**How to apply:** when a hybrid window looks inflated vs the cycle model, suspect
caches-off-on-resume first. Proper fix: add mcache_ctl (+mmisc_ctl) to
hybrid_state_v1, drain in `qemu_plugin/hybrid_handoff.c`, restore in
`ResumeDriver::resume()` (verilator/src/hybrid/resume_driver.hpp). Caveat: only
works if QEMU's andes target stores the CSR write; else ResumeDriver must set the
engine's cache-enable value directly. The F16 warmup-interval machinery
(`StateDrain::set_warmup_snapshot`, `mcycle_at_measure_start`) is a partial
mitigation but does not fix caches being disabled outright. Related: [[project_vsim_halt_slack]].
