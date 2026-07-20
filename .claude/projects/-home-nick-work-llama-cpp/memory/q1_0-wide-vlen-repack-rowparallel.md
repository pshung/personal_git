---
name: q1_0-wide-vlen-repack-rowparallel
description: "Decision to optimize Q1_0 matmul on wide VLEN (512-2048) via row-parallel Nx1 repack, not the q4_0_8x8 mmla-fold; recorded in opt_roadmap.md F4"
metadata: 
  node_type: memory
  type: project
  originSessionId: b6b76240-81f4-4da8-b28a-454652dff28c
---

For wide VLEN (512/1024/2048) the Q1_0 dot kernel's per-32 `vwredsum`
horizontal reduction wastes most lanes and gets relatively worse as VLEN
grows. Fix = repack + ROW-PARALLEL `Nx1` layout (blocklen=1, like
`ggml_gemv_q4_0_16x1_q8_0_generic` at repack.cpp:1370), NOT the `q4_0_8x8`
mmla-fold. N weight rows in N lanes; K-reduction becomes a loop-carried
vertical add per lane -> ZERO horizontal reductions.

**Why:** Q1_0 weights are +-1, so the multiply collapses to a conditional
add (`sumi = vsub_vx(sumi,y); sumi = vadd_vx_m(mask,sumi,2*y)` per column,
int16 accum, 32*127<32767 safe). The 8x8 path's vwmul + vnsrl fold tree is
pointless here (no dequant needed, and the fold IS a reduction).

**How to apply:** fix N=64, adapt LMUL to vlenb so fp32 acc is full
(VLEN=2048->m1, 1024->m2, 512->m4). Per-column vlm (128/block) is the main
tuning cost. Full design + inner loop + sub-features F4a-F4d in
`opt_roadmap.md` F4 (working tree, untracked). F4a = scalar reference +
kernel-lab test (TDD oracle, HW-agnostic) is the first step.

**Open question (gates F4b vs F6):** is an int8 dot-product available on the
target (RVV zvqdotq / Andes xandesvdot)? If yes, Strategy B (expand signs to
+-1 int8, NDS.VD4DOTS) on the same repack layout may beat the base-RVV F4b;
decide via vsim A-vs-B shootout. Asked user 2026-07-20, not yet answered.

Related: [[ace-tq1-standalone-kernel-lab]], [[andesim-llamacpp-hybrid-gaps]].
