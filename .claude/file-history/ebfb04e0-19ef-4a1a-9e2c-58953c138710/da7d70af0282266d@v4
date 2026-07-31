---
name: xandesvdot-nds-vd4dots-usable
description: "XAndesVDot (nds.vd4dots.vv) is stock, not ACE - shipped in llama.cpp as the Q1_D4 Q1_0 gemv, 3.11x over repack+prefetch across all 7 layer-7 nodes; the two codegen traps that hide the win"
metadata: 
  node_type: memory
  type: project
  originSessionId: ebfb04e0-19ef-4a1a-9e2c-58953c138710
  modified: 2026-07-29T12:52:23.369Z
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
   - 18x slower. GCC contracts "load a word, splat it" into exactly that. Fix:
   pin the word in a GPR with an empty `asm("" : "+r"(w))` first, so it stays
   lw + vmv.v.x. GATE IT: disassemble the gemv kernel, want 8 vmv.v.x, 0 vlse32.
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

COMPUTE / MEMORY SPLIT after F8 - the number to plan hardware against
(K=51 attn_v; `bash build.sh d4-nopf` and `d4-hvm`):
  d4 prefetch OFF 588,771 | d4+prefetch 457,092 | d4+prefetch+HVM 328,865
  HVM removes essentially all memory wait, so 328,865 is the INSTRUCTION-ISSUE
  FLOOR (~92K instrs -> 3.6 cyc/instr ~= the m2-at-DLEN-1024 issue limit):
    72% instruction issue (no memory fix touches this) / 28% residual stall.
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

Still open: GEMM/prefill is on the generic C fallback under Q1_D4 (the layout is
a whole-binary switch). VLEN=512/premium needs the e32/m4 shape and is blocked
on the ax45 hybrid halt bug. Unexplored vendor ops in fpga_l3's ISA string:
nds.vqmacc.*, nds.vln8.v / nds.vle4.v sub-int loads, nds.vfpmadb/t.vf,
nds.vfwcvt.f.b.v.

Lab: `/local/nick/vsim-workspace/vsim-demo/q1_0_d4/` (rdcycle shootout).
ggml: repack.h `q1_0x64_sign_bit` (the one layout authority),
arch/riscv/repack.cpp `q1_gemv_64d4_vl1024`, `bash build.sh d4`.
