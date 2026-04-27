---
name: vle width unification breaks on caller-supplied int8 buffers
description: Switching vle8 -> vle32 to unify vsetvli SEW (so vd4dots+vle dual-issue in one block) breaks correctness when caller-supplied int8_t* base pointers are not 4-byte aligned. vle8 has no alignment constraint; vle32/vle16 do.
type: feedback
originSessionId: c5543f22-1bda-47c4-a76e-d6e3930611f2
---
When trying to unblock VMAC+VLSU dual-issue in mixed e8-load + e32-compute kernels by replacing `vle8` with `vle32` (so the same `vsetvli e32 m1` covers both): the change is semantically equivalent on byte volume (vle32 m1 vl=32 = 128 bytes = vle8 m1 vl=128) and same VLSU throughput (2 cyc/instr at DLEN=512), but the loaded BASE pointer must be 4-byte aligned. Caller-supplied `int8_t*` buffers (im2col col_buffer, weight rows offset by `num_col_a` strides) are not guaranteed aligned.

**Why:** RVV 1.0 misaligned vector loads are implementation-defined: AX45MPV silicon allows them with +2 latency, but **QEMU's andes_ae350 model traps or falls back to a per-element path that effectively hangs on long-K shapes**. Round 6 of `nn_mat_mult_kernel_s8_offset_unroll4` failed exactly this way: test-1 (K=2052, happened to align) PASS; tests 2/3 (K=2058, K=576) timed out at 300s on QEMU.

**How to apply:**
- Do NOT replace `vle8` with `vle32`/`vle16` in kernels whose pointers come from `int8_t*` caller arguments unless you can prove every base pointer is 4-byte aligned (or 2-byte for vle16).
- The vsetvli barrier between e8-loads and e32-compute is therefore a hard constraint for these kernels; VMAC+VLSU dual-issue inside one block is not reachable via this trick.
- If you need dual-issue across the barrier, use inline asm to interleave instructions across two vsetvli regions, OR force buffer alignment at the caller via `__attribute__((aligned(4)))` on the pad-and-pack buffer (out of scope for a per-round optimization).
