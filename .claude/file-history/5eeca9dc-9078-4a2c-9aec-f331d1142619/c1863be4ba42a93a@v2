---
name: fast-leg-permissive-cycle-enforces-hw-contract
description: QEMU's functional/MMIO model silently tolerates real-hardware-contract violations (missing fence.i, stale gp, misaligned device access) that vsim's cycle-accurate RTL correctly faults on -- always verify new low-level code on the cycle leg, not just fast.
metadata:
  type: feedback
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

Recurring bug class in the vlinux/hybrid work (3 occurrences across
[[andesim-linux-runtime-roadmap]] U3, U4, U5, same root shape each time):
code that violates a real RISC-V/hardware contract passes cleanly on the
**fast** leg (QEMU) because QEMU's functional model is permissive, then
fails -- often confusingly, via a trap or a hang, not an obvious "wrong
value" -- on the **cycle** leg (vsim, real RTL) because that engine
actually enforces the contract.

Concrete instances:
1. **Missing `fence.i`** after writing freshly-loaded code via ordinary
   guest stores (U3): QEMU has no I-cache model, so stale/empty fetch
   never happens there; vsim's real cache faulted with an illegal
   instruction. Required by the RISC-V spec whenever a hart writes then
   executes new code.
2. **Stale `gp` in a trap handler** (U4): `trap.S` never reloaded `gp` to
   the handler's own `__global_pointer$` before running C trap-handler
   code, so gp-relative global access used whatever gp was active at trap
   time (the app's gp, once the app is running) instead of the handler's
   own. Silent on both engines UNTIL the trap handler's C code actually
   touched a global variable -- functionally this is engine-independent,
   but it was found in a cycle-leg debugging session precisely because
   fast/cycle divergence is the standing way these bugs get caught.
3. **Misaligned/sub-width HTIF window access** (U5): `htif_win_load` is
   documented (`runtime/htif_client.h`) as u64-load-only with an
   8-aligned `woff` requirement (it dereferences a `uint64_t*` at
   `WIN_DATA_VA+woff`). A 4-byte read at a non-8-aligned offset returned
   the right bytes on QEMU's byte-addressable MMIO model, then faulted
   (mcause=5, load access fault, mtval pointing exactly at the bad
   address) on vsim's real uncached-device bus logic.

**Why**: QEMU is a functional simulator (correct architectural state,
permissive about HOW you got there); vsim is cycle-accurate RTL (models
the real bus/cache/pipeline, so it enforces every real hardware
constraint: natural alignment on device accesses, I-cache coherency
needing explicit fences, whatever register state actually happens to be
live at a given PC). QEMU passing is necessary but never sufficient
evidence that low-level RISC-V/device code is correct.

**How to apply**: for any new code that (a) writes then executes memory,
(b) touches global/static state from a trap/handler context, or (c) does
raw MMIO/window/register-window access at a sub-natural width or a
computed (non-obviously-aligned) offset -- do not trust a fast-leg-only
pass. Run the cycle leg before calling such a feature done. When a
cycle-leg failure looks bizarre (silent hang, fault at an odd address,
wrong value read back) and the SAME code passed on fast, suspect this
class first: check for a missing fence.i, a stale register assumed live
across a context switch, or a violated access-width/alignment contract,
before assuming a logic bug in the new code itself.
