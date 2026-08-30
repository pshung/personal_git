---
name: q1-0-prefill-gemm-stage-breakdown
description: "Q1_0 prefill/gemm 4-stage speedup measured 2026-08-28 (repack 6.11x / prefetch 1.04x / vd4dots 2.46x); prefill's fixed cost is a SCALAR activation quantizer worth ~490K cycles per node"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9a8ed4fe-13e9-424e-bb5f-5a5e4429a388
  modified: 2026-08-28T20:49:29.235Z
---

Full 4-stage sweep on Bonsai-4B layer 7 (K=50..56, all 7 Q1_0 shapes),
`vsim:ax46mpv_fpga_l3`, both paths measured in one session from one binary set
(built 2026-08-19). Tables live in `profiling_gemm.md`; regenerate with
`bash sweep.sh --md`. See [[q1_0-wide-vlen-repack-rowparallel]].

Geo-mean per stage, n=7 nodes each:

| step | gemm (prefill, nrows=4) | gemv (decode, nrows=2) |
|---|---:|---:|
| upstream -> +repack | **6.11x** | 2.13x |
| +repack -> +prefetch | **1.04x** | 1.56x |
| +prefetch -> +vd4dots | **2.46x** | 3.70x |
| total | **15.64x** | 12.35x |

Same destination, opposite routes: prefill takes almost everything from the
repack layout, decode from prefetch+vd4dots. Decode is shape-invariant
(11.74-13.01x); prefill is NOT (10.78-20.83x) and gains LESS than decode on the
smallest node.

**The reason, and the next lever.** Split cost as `cycles = F + T*tiles` over
the five nodes with ne0=2560 (fit is tight, gemv residuals <1.1%):

| | fixed per call F | per tile T | per tile per token |
|---|---:|---:|---:|
| gemv d4 | 39,491 | 21,638 | 10,819 |
| gemm d4 | **489,581** | 23,036 | **5,759** |

The gemm is 1.88x better per token in steady state (M-tile sharing: one weight
vlm+vmerge feeds 4 dots, `arch/riscv/repack.cpp:1967-1972`) but carries 12.4x
the per-call fixed cost. F is ~constant across baseline/prefetch/d4
(398K/441K/490K) while T collapses 3.5x, so F is NOT the kernel -- it is the
activation quantize. `forward_mul_mat` (`repack.cpp:4456-4469`) sends 4-token
calls to `ggml_quantize_mat_q8_0_4x1_generic` (`repack.cpp:51`), a PURE SCALAR
loop, because its vector twin is gated on `__riscv_zvfh` and build.sh sets
`-DGGML_RV_ZVFH=OFF`; 2-token calls are not a multiple of 4 so they fall
through to the RVV-vectorized `quantize_row_q8_0`
(`arch/riscv/quants.c:32`, gated only on `__riscv_v`).

At ~490K cycles that quantizer is 59% of a small prefill node (attn_v) and
12% of a large one -- now bigger than the kernel it feeds. Vectorizing it is
the clearest remaining prefill win.

Upstream has NO prefill kernel (`.nrows = 1`, `ggml-cpu.c:257`): measured
exactly linear in tokens, 1.96-2.02x for 2x tokens on all 7 nodes.
