---
name: SW-pipeline amortization threshold for vd4dots tile kernels
description: When porting the s8 4x4 vd4dots SW-pipeline pattern to a sibling kernel (u8/etc.), check inner-iteration count first; <=3 iters per inner reduction call won't amortize the prologue+drain+tail-handler overhead.
type: feedback
originSessionId: 3b8ffb78-c49b-483b-a18a-17d1527ab107
---
For the proven 4x4 vd4dots SW-pipeline pattern (alternating buffers V16-V23/V24-V31, accs in V0-V15), the prologue+drain+tail-handler adds ~30-40 instrs per (rowCnt) iteration. To net positive on FPGA cycles, the inner reduction loop needs roughly **>=4-5 vl-sized iterations per call**.

**Why:** Steady-state savings are ~(VLSU+VMAC)/2 = ~16 cyc/iter. Scaffolding overhead is ~50-80 cyc/call. Break-even at ~4-5 iters; below that the rewrite regresses.

**How to apply:**
- Before porting the s8 round-5 SW-pipeline pattern (commit be791370 on `nn_mat_mult_kernel_s8_offset.c`) to any sibling kernel, compute `K / VLMAX_e8_m1` for the perf-test shape: `K = in_tensor_ch * ker_dim^2`, VLMAX = 128 at VLEN=1024.
- Example: u8 `conv_HWC_u8_u8_s8_sym_bias_fast` perf shape K=288 -> 288/128 = 2-3 inner iters per call. Round-1 attempt (2026-04-28) regressed -2.83% (576115 -> 592388 cyc, +5900 instrs) confirming the threshold.
- Example: s8 `conv_HWC_s8_s8_s8_asym_bias_any` perf shape gave +7.16% over rounds 1-6 because its perf test had more iterations.
- For low-K kernels, prefer cheaper peepholes (vsetvli barrier merging, batched vmax/vmin chains in requantize tail) instead of wholesale SW-pipeline rewrite.

**Detection signal:** If a SW-pipeline rewrite that QEMU-passes also INCREASES instruction count by more than ~1% on FPGA, the prologue/drain overhead is dominating -- revert and try a smaller-scope peephole.
