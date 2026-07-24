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
`opt_roadmap.md` F4 (working tree, untracked).

**Status 2026-07-22:** F4a + F4b DONE in kernel-lab (untracked):
`repack_q1_0_to_q1_0_64x1`, scalar oracle (bit-exact vs per-row vec_dot),
RVV `gemv_q1_0_64x1_q8_0` vl512 (i16m2/f32m4) + vl1024 (i16m1/f32m2), scale
expand via integer bit math (premium has no zfh/zvfh). All-VLEN correctness
PASS; asm clean (3-insn column loop, no spills). QEMU proxy shows 0.73x - a
TCG artifact (masked-op/vlm helper cost), NOT real; same trap that buried
F2 (defer-reductions, removed 2026-07-22 by user decision).

**MEASURED 2026-07-23, RTL rdcycle (vsim-demo/q1_0, nr=64 n=512, warm,
ALL PASS both engines):**
- fpga_l3 VLEN=1024: vl256 829 cyc/row -> gemv 125 = **6.6x**
- premium_full VLEN=512: vl256 1044 -> gemv 174 = **6.0x**
- K=51 extrapolation: ~5-6x on the matmul part of the ROI.

**GEMM (F4c) MEASURED 2026-07-23 (same lab, M=4 activations, cyc/dot warm):**
- fpga_l3 1024 (M-tile 4): vl256 838 | gemv x4 127 | gemm **40** = 3.1x over
  gemv, 20.5x over baseline
- premium_full 512 (M-tile 2): vl256 1046 | gemv x4 206 | gemm **109** = 1.9x
  over gemv, 9.6x over baseline
- Key: one vlm feeds the whole M-tile; per extra activation just 2 int vector
  ops + 1 scalar load. M-tile = 4@1024 / 2@512 (f32m4 register budget), zero
  vector spills both. Gain tracks tile width -> prefill wants VLEN=1024.

Engine gotcha: plain `sim_ax45mpv_premium` = NDS_FELEN=0 config = NO vector
FP (every vf* traps illegal; integer vector + scalar FP fine). The right
VLEN=512 engine is `sim_ax45mpv_premium_full` (added to vsim_andesim
config.yaml: premium RTL + ax45mpv_premium_full.cfg, FELEN=32 = fp32-only
vector FP, enough for zve32f; NOT 64 as first recorded) - there ALL vector
FP passes incl. vfwcvt.f.x.v, so the vsext+vfcvt split in the kernel is
optional (kept for portability, ~free).

Engine specs (cfg facts): fpga_l3 = VLEN/DLEN 1024, FELEN 64, L1 32K/32K,
L2 DISABLED, L3 2MB, MMU sv39. premium_full = VLEN/DLEN 512, FELEN 32, L1
64K I$/8K D$, L2 32KB, no L3, ILM 1MB/DLM 32KB, MMU bare. Premium's 8KB D$
< lab warm set (~15KB) -> its warm numbers include L2 traffic; fpga_l3 runs
L1-resident. Both have HVM (vector local memory) at 0x90000000: fpga_l3
8MB/2banks, premium_full 256KB/2banks+8subports.

**premium_max engine (2026-07-23)**: premium RTL re-elaborated with
ELEN=64 + FELEN=64 + PACKED_FP16=yes + D$ 8K->32K (ax45mpv_premium_max.cfg,
config.yaml entry) - builds clean, probe_max (rv64gcv) 15/15 ok incl.
vle64/vadd e64, vfadd f64, vfwcvt.f.f.v f16->f32 zvfh-encoding. So the
premium package is NOT hard-limited to ELEN32; e64/fp16 are config knobs.
Shootout on it (warm cyc/dot): RAM vl256 1045 / gemv 135 / gemm 75
(32K D$ = 1.5x over 8K D$ on gemv; baseline unchanged -> vl256 is not
D$-capacity-bound); HVM identical to premium_full (753/83/54) - HVM still
beats even 32K D$ for the vlm stream.

**HVM A/B MEASURED 2026-07-23** (hvm.h = ace-tq1 malloc_hvm ported
printf-free, CSR 0xFD1 base / 0xFD0[7:0] log2 size; -DQ1_HVM=1 puts ALL
data in HVM; warm cyc/dot): premium_full vl256 1049->753 / gemv 206->83
(2.5x) / gemm 109->54 (2.0x) - 8KB D$ was the bottleneck, best chain 19.4x.
fpga_l3 vl256 840->785 / gemv 126->92 (1.4x) / gemm 40->37 - already
L1-resident, best chain 22.7x. HVM runs are deterministic (rep0==rep1).
premium 256KB fits a 64-row K=51 strip (18KB); fpga_l3 8MB fits the whole
2560x1024 repacked weight (576KB). Kernel FP footprint is only
scale-application (9 ops/block); hot column loop is pure integer - if an
integer-only engine ever matters, swap those 9 for fixed-point dyq
vmacc.vx + 64 scalar FMAs/block (err ~3e-5 < 1e-4 gate).

**ACE co-design (2026-07-20):** user confirmed int8 dot-product HW exists and
wants custom ACE-RVV instructions (COPILOT), not stock xandesvdot. Template =
their TQ1 ACE lab /local/nick/vsim-workspace/vsim-demo/ace-tq1 (unpack.ace:
`v_w_mul_free_macc` multiply-free widening MAC + trit unpack; tq1.c does
unpack -> macc -> ONE vwredsum/block because TQ1 pairs Q8_K 1-scale/256).
Chosen instruction = **A `v_q1_rowdot`**: `{io vrf:4int result, in vrf:int
activation, in vrf:uint signbits}`, per-lane 4-way sign-dot
`result[lane]+=sum_i(bit_i?+act_i:-act_i)`, activation broadcast, weights
1-bit from the Nx1 repack -> lanes=rows, NO reduction. Sign-bit analog of
VD4DOTS, HW = conditional-negate add-tree (no multiplier). Alternatives: C
`v_q1_sign_macc` (2int, single-row, keeps vwredsum), B `v_q1_unpack`+reuse
mul_free_macc (min HW). Full design + .ace sketch + build order in
opt_roadmap.md F6. Open: confirm COPILOT allows 4int in-lane reduce result
(v_q_tq2_unpack suggests yes). Asked user path A/B/C + activation format
2026-07-20; away, defaulting to A + keep per-32 Q8_0.

**F4d DONE 2026-07-24**: ggml wiring merged on llama.cpp branch q1_0-rvv-opt
(block_q1_0x64 + generic + RVV vlenb-dispatch kernels + dispatch gate
Q1_0/riscv_v/VLEN>=512/rows%64; test tests/test-repack-q1_0.cpp, bit-exact
at QEMU 512+1024; e64+zvfh REPACK blockers fixed; ROI counter moved before
extra-dispatch in ggml-cpu.c or repacked matmuls shift K).
**K=51 in-model fpga_l3: 4,476,168 -> 2,144,755 = 2.09x** (vs lab 6.6x:
gap is memory-bound - K=51 weight is 360KB/row-strip 9KB, NOT 576KB/18KB as
earlier docs say; streams from L3 since fpga_l3 L1 is 32K/L2 off; secondary =
scalar activation quantize, node overhead). Next levers: weights-in-HVM, RVV
e32 activation quantize, prefill M-tiles.

**weights-in-HVM IMPLEMENTED 2026-07-24 (measurement PENDING)** on branch
q1_0-rvv-opt. Agents confirmed: (1) repack buft = ONE big alloc for all Q1_0
repack tensors, tensor->data is absolute ptr, kernel reads src0->data -> can
redirect per-tensor at load; injection = set_tensor BEFORE ->repack(), point
tensor->data at HVM so repack writes sign-planes straight in (zero extra copy).
(2) hybrid QEMU fast-leg (machine andes_ae350) backs 0x90000000 as writable
RAM (memory_region_init_ram, hvm_size_pow_2 from cfg: fpga_l3 8MiB/23,
premium 256KiB/18); load-time HVM writes captured via plugin
drain_lm_sidecar (qemu_plugin_read_memory_hwaddr) -> state-*.bin.hvm ->
vsim --hvm backdoor set_hvm(). CSR 0xFD1/0xFD0 discovery works in guest.
Files: NEW ggml/src/ggml-cpu/hvm.h (pure ggml_hvm_bump + ggml_hvm_selected,
target-only CSR readers); repack.cpp set_tensor redirect (env GGML_Q1_HVM or
-DGGML_Q1_HVM_NAME=attn_v, substring; file-static ggml_hvm_alloc bump 64-align
NULL-on-overflow); ggml-cpu.c ROI print `[roi] MUL_MAT #K src0=name [nxn]`;
NEW tests/test-hvm-place.cpp (host RED->GREEN, pure logic). Run harness:
NEW run-k51-hvm.sh (build w/ define + andesim fpga_l3 K=51). SELF-CHECK in
FAST leg: `[q1-hvm] blk.7.attn_v.weight ... -> HVM` + `[roi] ... src0=
blk.7.attn_v.weight` both must appear before the ~hours RTL leg. Goal < 2.14M.
BLOCKER for me: Andes glibc toolchain on /local/nick/SW_Release is fuse-sshfs
(atcnsqa16) - execve intermittently EPERMs/hangs from Claude's container even
with sandbox off (the .gnu backend runs standalone but gcc-driver spawning
cc1/as flakes); build+run must go through the user's host shell via `!`.
premium_max K=51 BLOCKED: ax45 hybrid resume can't halt hart (PLDM
0xE6800000 fetches unserved in vsim_andesim ax45 wrapper; ax46 fine) -
vsim_andesim work, engine cfg is innocent.

Related: [[ace-tq1-standalone-kernel-lab]], [[andesim-llamacpp-hybrid-gaps]].
