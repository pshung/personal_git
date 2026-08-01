---
name: xandesvdot-nds-vd4dots-usable
description: "XAndesVDot (nds.vd4dots.vv) is stock, not ACE - shipped in llama.cpp as the Q1_D4 Q1_0 gemv AND gemm, 3.11x decode / 1.8-2.0x prefill over repack+prefetch; the codegen traps that hide the win and the vsetvli churn that is left"
metadata: 
  node_type: memory
  type: project
  originSessionId: ebfb04e0-19ef-4a1a-9e2c-58953c138710
  modified: 2026-08-01T13:49:30.082Z
---

`nds.vd4dots.vv` (XAndesVDot) is a STOCK Andes vendor instruction, not custom ACE.
Now IN llama.cpp on branch q1_0-rvv-opt as opt_roadmap F8; see
[[q1_0-wide-vlen-repack-rowparallel]] for the repack/prefetch layers under it.

Semantics: with vtype `e32`, `vd[lane] += sum_{k=0..3} vs1[4*lane+k] * vs2[4*lane+k]`,
int8 x int8 into the i32 lane, src and dst at the SAME LMUL. At VLEN=1024 e32/m2
is exactly 64 i32 lanes = 64 rows, and that register group as i8 is 256 bytes =
64 rows x 4 columns - the operand shape the instruction wants.

Availability - all three legs of the loop already have it, nothing to build:
- RTL: `NDS_VECTOR_VDOT_SUPPORT {yes}` in ax46mpv_fpga_l3, ax45mpv_premium,
  premium_full (`/local/nick/vsim/data/configs/*.cfg`).
- Assembler: `-march=..._xandesvdot` (unversioned works on the ast542 Linux
  toolchain that build.sh uses; older gas needs `xandesvdot1p0`; baremetal
  ast540/541/550 know it, **ast533 does NOT**).
- GCC 14.2 has NO intrinsic -> inline asm. Safe: GCC treats an asm block as a
  vtype killer and re-emits its own vsetvli after it.
- andesim fast leg: works on `--engine vsim:ax46mpv_fpga_l3` because the
  engine's `-readconfig` qemu cfg sets MMSC_CFG.VDOT. Do NOT trust qemu's own
  cpu.c default: `andes-ax46mpv` omits V5_MMSC_CFG_VDOT (SIGILL under plain
  `qemu-riscv64 -cpu andes-ax46mpv`), only `andes-ax45mpv` sets it.

TWO CODEGEN TRAPS. Both silently cost the whole win, both bit you twice (lab
then ggml), both now have comments in the source:
1. `vlse32.v vd,(rs1),zero` (stride-0 broadcast) is element-serial on this core
   - 18x slower. GCC contracts "load a word, splat it" into exactly that. The
   old fix was an `asm("" : "+r"(w))` barrier; since F9 the broadcast is written
   by hand inside the dot's asm block, so the contraction is impossible and
   q1_bcast_act4 is gone. GATE IT anyway: ./check-vd4dots.sh counts vlse*, want 0.
2. The core faults on a MISALIGNED 32-bit VECTOR element load, and `block_q8_0`
   puts qs at offset 2, so every other q8 group is 2 mod 4. Fix: restage the
   activation quants once per gemv call into an alloca'd buffer via vector BYTE
   ld/st (EEW=8 has no alignment rule). Amortized over the nc/64 row tiles, <1%.

MEASURED in-model (andesim hybrid marker ROI, vsim:ax46mpv_fpga_l3, Bonsai-4B,
nrows=2 gemv), ALL 7 layer-7 nodes x ALL 3 kernels:
  LAYER 7 TOTAL  pristine 178,647,490 -> prefetch 52,752,463 -> d4 16,957,871
                 d4 vs prefetch 3.11x | d4 vs pristine 10.54x
  per node, d4 vs prefetch 3.03-3.16x; d4 vs pristine 9.79-11.45x.
  Shape-invariant across a 9.5x range of node sizes, like the prefetch win.
  ffn_down (K=9728, longest reduction dim) is the outlier both ways: prefetch
  helps it most (3.77x) and d4 least (3.03x) -> best combined 11.45x.
  CROSS-CHECK: this sweep's prefetch/pristine per-layer = 3.386x reproduces the
  3.39x from the independent F7 sweep, so the two sessions agree.
  GOTCHA: measure.sh's default 4h per-leg timeout is too short for pristine
  ffn_down (49.0M cycles ~3.9h) - it exits 1 with an empty grep. TIMEOUT=28800000.

COMPUTE / MEMORY SPLIT after F8 - **the "floor" here was WRONG, see F9 below**
(K=51 attn_v; `bash build.sh d4-nopf` and `d4-hvm`):
  d4 prefetch OFF 588,771 | d4+prefetch 457,092 | d4+prefetch+HVM 328,865
  I called 328,865 the INSTRUCTION-ISSUE FLOOR and split it 72% issue / 28%
  stall. It was not a floor - it was an instruction count. F9 removed
  instructions and reached 362,799 with NO HVM, and F9+HVM was never measured.
  The split below is still the right SHAPE (memory is not done) but the
  absolute numbers are F8-era. Re-measure before quoting.
  The un-prefetched kernel's total stall splits almost exactly in half:
  prefetch hides 131,679 (51%), HVM the other 128,227 (49%).
  So HVM is still worth 1.39x AFTER all software work (13.61x vs pristine) -
  do NOT claim memory is "done". But the big pot is compute: F6-A (1-bit weight
  operand, drops the vmerge and cuts weight reg traffic 8x) attacks the 72% and
  stacks with HVM (~2.8x combined if compute doubles).
  CAVEAT: attn_v's 360 KB working set FITS fpga_l3's 2 MB L3. A 27B ffn_down is
  12 MB where L3 is useless, so the memory fraction there is likely well above
  28% and HVM worth more than 1.39x. The missing datum for any big-local-memory
  decision is d4-hvm on K=56.

27B (Bonsai-27B-Q1_0, qwen35) sizing for HVM discussions: 3.52 GiB of Q1_0.
  ffn_down/gate/up 765 MB each = 63.6% | attn_qkv 337 | attn_gate + ssm_out 202
  each | output + token_embd 170 each | 64 layers, only 16 with real attention,
  48 linear/SSM. ALL tensors pass the repack gate (rows%64==0), unlike the 4B
  whose LM head is the tied token_embd [2560, 151669], rows%64=53 -> FAILS the
  gate and still runs pristine vec_dot (~26% of an optimized decode pass).
  KV cache is cheap because 48/64 layers are linear: 64 KB/token ->
  512 MB @ 8K ctx, 2 GB @ 32K, 16 GB @ the model's 262K max.
  27B is untestable today: F0 (qwen35 garbage on rv64) + andesim's 2 GiB cap.

The in-model 3.04x BEATS the standalone lab's 2.52x, and the reason is MEMORY,
not math: the old kernel issues one 8-byte vlm per column (128 per block), the
d4 kernel one 32-byte vlm per 4 columns (32 per block) - same bytes, a quarter
of the load ops. A cache-resident lab strip cannot show this; only the in-model
ROI can. Generalize: measure kernel restructures in-model, not just in the lab.

GEMM/PREFILL DONE 2026-07-31 (`q1_gemm_64d4_vl1024`), nrows=4 pure-gemm nodes:
  K=51 attn_v   pristine 8,875,248 -> prefetch 1,651,949 -> d4   931,754  1.77x
  K=56 ffn_down          -         -> prefetch 13,474,132 -> d4 6,636,852 2.03x
AT F8 prefill and decode converged on the same cost per MAC (F9 then split
them apart again - see below). cyc/MAC, decode gemv vs prefill gemm:
  repack+prefetch  0.2650 vs 0.1576 (gemm 1.68x better - weight reuse across
                                     the M-tile of 4 was hiding memory stall)
  + nds.vd4dots    0.0872 vs 0.0889 (SAME - no stall left for reuse to hide)
So prefill's smaller ratio is a better starting point, not a weaker kernel.
ffn_down is the exception that proves it: 3.5 MB misses fpga_l3's 2 MB L3, so
reuse still buys traffic and its d4 gemm IS 1.29x better per MAC than the d4
gemv -> 2.03x. Corollary: the gemm ratio is NOT shape-invariant (unlike the
gemv's 3.03-3.16x); it tracks whether the tensor fits L3.
Activation side is the only new problem: x4 stores qs[c*4+m] but the dot wants
row m's 4 consecutive columns as one u32. De-interleave the row tile once with
vnsrl (u32 -> 2x u16 -> 4x u8), <1% - do NOT use vlse8/segment loads (see trap
1). Legal because block_q8_0x4 keeps qs 4-byte aligned, the opposite of trap 2.
e32/m2 has no register left for a per-row facc, so fold the activation scale
into dx: sum_l dx*(sum_k da*acc) == sum_l sum_k (dx*da)*acc.

F9 DONE 2026-08-01 - killed the vtype churn. The kernels ping-pong between the
byte view (vlm, vmerge) and the 32-bit view (vmv.v.x, dot); each flip costs a
vsetvli, 4 per dot in the gemv = 40% of the inner loop.
  FIX: put everything at e32 inside ONE asm block, broadcasts included, so GCC
  only sees e8 work. Grouping the widths in SOURCE is NOT enough - the
  scheduler re-interleaves (only got 4.00 -> 2.00). Also kills the vlse32 trap
  by construction (activations come in as uint32 GPRs, vmv.v.x written by hand).
  DID NOT WORK: 4 scratch activation regs instead of 2 (no spills, 4.5% WORSE)
  -> producer-consumer distance is not the gemm's limiter.
  static: vsetvli/dot gemv 4.00->0.94 gemm 2.00->0.52
          instrs/dot   gemv 10.0->7.90 gemm 9.00->4.13
  MEASURED  K=51 decode  457,092 -> 362,799 (1.26x, 12.34x vs pristine)
            K=51 prefill 931,754 -> 818,314 (1.14x, 10.85x vs pristine)
            K=56 prefill 6,636,852 -> 5,683,029 (1.17x)
DECODE AND PREFILL ARE NOW BOUND BY DIFFERENT THINGS - cycles per issued instr:
  gemv 2.23 -> 2.24 unchanged = purely issue bound, F9 converted instruction
       savings 1:1 into cycles. So F8's "instruction-issue floor" 328,865
       (measured WITH HVM) was never a floor, it was an instruction count -
       F9 beat it at 362,799 with no HVM. Do not quote that floor again.
  gemm 2.53 -> 4.84 nearly doubled = NOT issue bound. Its 4.13 instrs/dot
       should cost ~9.2 cyc at the gemv's rate; it costs 20.0, so ~11 cyc/dot
       is stall. Cutting instructions further will NOT help prefill.
  Both now sit at 17.7 (gemv) / 20.0 (gemm) cycles per nds.vd4dots.vv, close
  enough to suspect the instruction's own m2 throughput - NOT established.
  UNRUN EXPERIMENT that settles it: d4-nopf and d4-hvm on the PREFILL node
  (targets exist, ~25 min). HVM moves it -> memory, fix in software. Neither
  moves it -> the dot rate, prefill is done until the ISA changes.
Also still open: VLEN=512/premium needs the e32/m4 shape, blocked on the ax45
hybrid halt bug. 5 of 7 layer-7 nodes unmeasured for prefill. Unexplored vendor
ops in fpga_l3's ISA string: nds.vqmacc.*, nds.vln8.v / nds.vle4.v sub-int
loads, nds.vfpmadb/t.vf, nds.vfwcvt.f.b.v.

Lab: `/local/nick/vsim-workspace/vsim-demo/q1_0_d4/` (rdcycle shootout).
ggml: repack.h `q1_0x64_sign_bit` (the one layout authority),
arch/riscv/repack.cpp `q1_gemv_64d4_vl1024` + `q1_gemm_64d4_vl1024`,
`bash build.sh d4`. GATE: `./check-vd4dots.sh` - counts nds.vd4dots (0 = that
path silently fell back to generic and is 3x slow), prefetch.r, and vlse*, per
KERNEL not per entry point (the d4 kernels stay out of line, which is why
check-prefetch.sh reads 0 on a d4 build and cannot guard them).
Prefill measurement recipe: `PROMPT="The capital of France" WARMUP=--no-warmup
bash measure.sh <target>` gives nrows=4, a pure gemm node.
