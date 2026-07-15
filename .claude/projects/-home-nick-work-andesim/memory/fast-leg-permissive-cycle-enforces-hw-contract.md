---
name: fast-leg-permissive-cycle-enforces-hw-contract
description: QEMU's functional/MMIO/vector model silently tolerates real-hardware-contract violations (missing fence.i, stale gp, misaligned device access, ELEN/LMUL vector-width limits) that vsim's cycle-accurate RTL correctly faults on -- always verify new low-level code on the cycle leg (or hybrid's engine-synced QEMU leg), not just plain fast.
metadata:
  type: feedback
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

Recurring bug class in the vlinux/hybrid work (6 occurrences across
[[andesim-linux-runtime-roadmap]] U3, U4, U5, U9 x3, same root shape each
time): code that violates a real RISC-V/hardware contract passes cleanly
on the **fast** leg (QEMU) because QEMU's functional model is permissive,
then fails -- often confusingly, via a trap or a hang, not an obvious
"wrong value" -- on the **cycle** leg (vsim, real RTL), or on **hybrid's
own QEMU leg** once it is engine-synced enough to encode the real
constraint, because that engine actually enforces the contract.

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
4. **ELEN=32 vector-width auto-vectorization** (U9): hybrid's QEMU leg is
   engine-synced (`-readconfig` sets `elen=32`, the real limit), unlike
   fast mode's own hardcoded `-cpu andes-ax45mpv,vlen=512` (no `elen`
   constraint at all). GCC auto-vectorized several `ggml_float`(double)-
   accumulated scalar fallback loops (`ggml_vec_dot_f16`/`_bf16` in
   llama.cpp) into illegal e64 (64-bit-element) vector reduces -- ran fine
   under fast's unconstrained cpu string, illegal-instruction (mcause=2)
   trapped under hybrid's accurately-configured QEMU leg. Two OTHER
   functions (`ggml_vec_cvar_f32`/`ggml_vec_soft_max_f32`) used EXPLICIT
   e64 RVV intrinsics for no real reason (every other architecture's
   branch in the same functions reduces in native precision and widens
   only the final scalar) -- same symptom, different root (an upstream
   algorithmic inconsistency, not a compiler auto-vectorization artifact).
5. **LMUL=8 unsupported for floating-point vector ops** (U9): this
   engine's vector FPU datapath does not extend to LMUL=8 even though
   e32 (its actual ELEN) is otherwise fully legal -- confirmed by an
   INTEGER `vle32.v` load at the SAME LMUL=8 executing fine immediately
   before a FLOAT `vfabs.v` at LMUL=8 faulted one instruction later
   (`quantize_row_q8_0`/`_q8_1`'s hardcoded `vfloat32m8_t` ops).
   Correlates with the engine's `isa-vl4` QEMU CPU config bit, though
   QEMU itself does not enforce it -- only vsim's RTL does, so this one
   surfaced on the CYCLE leg specifically, not hybrid's QEMU leg (unlike
   instance 4). A narrower vector-capability axis than ELEN, and a
   reminder that "compiles and passes on the engine-synced QEMU leg" is
   STILL not sufficient when a sub-capability (here: FP-specific LMUL
   ceiling) exists only in the RTL's config, not in QEMU's CPU model at
   all.
6. **Driver-internal timeout defaults sized for the wrong leg** (U9,
   adjacent but same underlying lesson: a value someone picked while only
   fast/small-fixture testing was in mind turns out too small once a
   REAL, large cycle-accurate computation is attempted): `PlanOptions`'
   hardcoded 90s per-leg spawn timeout had no override; a real transformer
   matmul needs minutes on the ~8.6kHz cycle-accurate leg. Not a
   correctness bug, but the same shape of surprise -- something that was
   fine for everything tested so far quietly stops being fine at real
   scale. Fixed with a `--step-timeout-ms` CLI override
   ([[andesim-linux-runtime-roadmap]] U9), not by just raising the
   default blindly.

**Why**: QEMU is a functional simulator (correct architectural state,
permissive about HOW you got there, and its CPU model's declared
capabilities are only as accurate as whoever hand-wrote that `-cpu`
string); vsim is cycle-accurate RTL (models the real bus/cache/pipeline/
vector-unit datapath, so it enforces every real hardware constraint:
natural alignment on device accesses, I-cache coherency needing explicit
fences, real ELEN/LMUL vector-capability limits, whatever register state
actually happens to be live at a given PC). Hybrid's OWN QEMU leg sits in
between: engine-synced fields (like `elen`) DO get enforced there, but
only the fields that sync captures -- a sub-capability like "LMUL=8 not
supported for float ops" that lives purely in the RTL's own config, with
no QEMU CPU property mirroring it, still only surfaces on vsim. Passing
on ANY one leg is never sufficient evidence that low-level RISC-V/vector
code is correct for the real target.

**How to apply**: for any new code that (a) writes then executes memory,
(b) touches global/static state from a trap/handler context, (c) does raw
MMIO/window/register-window access at a sub-natural width or a computed
(non-obviously-aligned) offset, or (d) emits or could auto-vectorize into
RVV instructions (any SIMD-shaped loop, on a target whose exact ELEN/LMUL/
sub-extension set is anything other than the RVV-spec-default full `v`) --
do not trust a fast-leg-only pass, and do not assume hybrid's own QEMU leg
passing covers everything vsim's RTL might reject either. Run the cycle
leg (or a real hybrid run reaching the code in question) before calling
such a feature done. When a cycle-leg (or hybrid QEMU-leg) failure looks
bizarre (silent hang, fault at an odd address, wrong value read back,
illegal-instruction at a `vsetvli`-adjacent PC) and the SAME code passed
elsewhere, suspect this class first: check for a missing fence.i, a stale
register assumed live across a context switch, a violated access-width/
alignment contract, or an ELEN/LMUL assumption the real target doesn't
actually meet -- before assuming a logic bug in the new code itself. For
vector-width mismatches specifically: `mtval` on an illegal-instruction
trap holds the exact faulting instruction's raw encoding -- decode/objdump
it before guessing.
