# Plan: Create RVV Optimization Knowledge Skill for libnn

## Context

libnn is a production RISC-V neural network library with ~300+ functions. The user wants to extract RVV (RISC-V Vector Extension) optimization knowledge from expert-written code into a reusable Claude Code skill, enabling future fine-tuning of functions to match or beat expert performance.

## What the Experts Have Done — RVV Techniques

### Foundation: Vector Length Agnostic (VLA) Programming
1. **Dynamic vector length** — Always use `vsetvl_e{8,16,32}m{1,2,4,8}()` to query hardware VLEN; never hardcode vector widths
2. **Strip-mining loops** — `while(size > 0) { vl = vsetvl(size, ...); /* process vl elements */; size -= vl; }`
3. **LMUL selection strategy** — m8 for 8-bit (maximize throughput, all 32 regs), m4 for 16-bit or when register pressure exists, m2/m1 for 32/64-bit or complex operations
4. **Compiler auto-vectorization disabled** — `-fno-tree-vectorize` to prevent conflicts with hand-optimized vector code

### Compute Techniques
5. **Cache tiling for matrix multiply** — Tile_size=256 (L1-tuned), 4-row × vl-column blocks in `internal_vec_mat_mul_tiling.h`; outer loops iterate tiles, inner loop does `vfmacc` on 4 rows simultaneously
6. **4-way row unrolling** — 4 independent vector accumulators (v0,v4,v8,v12 in m4) hide pipeline latency; 4 output rows share same input vector load
7. **Vector dot product** — `vd4dots` / `vqmacc` packs 4 int8×int8→int32 MACs into one instruction (4× throughput for s8 ops)
8. **Estrin polynomial approximation** — 8-coefficient exp/tanh/sigmoid: compute A+Bx² and C+Dx² in parallel, combine as (A+Bx²)+(C+Dx²)x⁴ for ILP
9. **Hybrid algorithm with mask selection** — `vmflt` creates mask for |x|<threshold; `vmerge` selects between fast-path (Taylor) and full-path (exp-based) with zero branching
10. **Fast reciprocal** — `vfrec7()` replaces `vfdiv` via `ENA_FAST_ALGO` flag (trades ~7-bit precision for ~3× speed)
11. **Three-pass reduction** — Softmax: (1) `vfredmax` for max, (2) exp + `vfredosum` for sum, (3) divide-by-sum; each pass fully vectorized
12. **Input replication** — `nn_dup_s8_x4_reordered()` duplicates input 4× to feed parallel FC row processing
13. **Weight contribution precompute** — For asymmetric quant: `sum(weights) × input_offset` computed once via `vd4dots` with ones-vector, amortized across all samples
14. **ACE custom exp** — `ace_exp()` via Andes Customization Engine for hardware-accelerated exponential (when `ENA_ACE_RVV` defined)

### Data Movement Techniques
15. **64-byte address alignment** — `nn_align(addr, 64)` prevents vector loads from crossing cache lines
16. **Strip-mining with loop unrolling** — Process 4×maxvl elements per outer iteration to amortize `vsetvl` overhead (e.g., relu_s8 processes 4 m8 vectors per loop)
17. **Data type promotion chain** — `vwadd` (s8→s16), `vwmul` (s16→s32), accumulate in s32/s64, then narrow back via `vnsra`/`vnclip` with rounding mode control
18. **Masked accumulator reduction** — `vredsum` with mask (`vmseq`-generated) selects every Nth element for multi-output row reduction from shared accumulator

### Quantization-Specific RVV
19. **Vector saturating narrowing** — `vnclip` with rounding mode `__RISCV_VXRM_RNU` for deterministic output quantization
20. **Double-width intermediate** — `vwmul` s32×s32→s64 for requantization multiply without overflow
21. **Vector min/max clipping** — `vmax_vx` / `vmin_vx` for activation range clamping (replaces branch-based clipping)

### RVV Version-Specific Patterns
22. **RVV 1.0 intrinsics** — `__riscv_vd4dots_vv_i32m1_tu()`, `__riscv_vle8_v_i8m8()` etc. when `NDS_VEC_RVV_VERSION >= 100 && ENA_VEC_INTRINSIC`
23. **RVV 1.0 macros** — `NDS_VEC_VQMACC_VV()`, `NDS_VEC_VLE8_V()` when `NDS_VEC_RVV_VERSION >= 100` (no intrinsic flag)
24. **RVV 0.8 fallback** — Older macro-based API via `internal_vec_isa_v0_8.h`
25. **Tail policy** — Most code uses tail-undisturbed (`_tu` suffix); some use tail-agnostic for compiler freedom

## What Could Be Improved / Searched in Future (RVV-focused)

### Algorithmic
1. **Winograd convolution** — Not implemented; could reduce 3×3 conv multiply count by ~2.25×
2. **Im2col + GEMM fusion** — More aggressive fusion of data rearrangement with tiled computation
3. **Fewer polynomial coefficients** — Some activations may tolerate 4-6 coefficients instead of 8 (measure accuracy vs speed tradeoff)
4. **vfrec7 + Newton-Raphson** — One NR iteration after `vfrec7` gives ~14-bit precision at ~60% vfdiv cost

### Micro-architectural
5. **Software pipelining** — Explicitly overlap load[i+1] / compute[i] / store[i-1] across loop iterations
6. **LMUL tuning** — m8 uses all 32 vector regs; m4 with better scheduling might reduce spills and be faster in practice
7. **Prefetch hints** — No `__builtin_prefetch` or cache hint instructions used; could help memory-bound ops on large tensors
8. **Segmented loads** — `vlseg2/3/4` for interleaved multi-channel data (partially explored in `_seg` variants)
9. **Tail-agnostic policy** — Switching from `_tu` to `_ta` may let hardware skip zeroing and improve throughput
10. **Indexed/strided loads** — `vlse`/`vluxei` for non-contiguous access patterns (e.g., dilated convolution)
11. **Vector register grouping** — Explore non-power-of-2 groupings or mixed LMUL within a function

### Missing Vectorizations
12. **Functions still plain-C only** — Some newer util functions (NMS, top-k, argmax) lack RVV paths
13. **F16 coverage** — Some f16 functions may not have RVV optimizations yet
14. **Grouped convolution** — May not have full RVV optimization for all group sizes

## Deliverable

Create a Claude Code skill at `/home/nick/work/libnn/.claude/skills/optimize-libnn.md` that:

1. **RVV optimization checklist** — Step-by-step process for optimizing any libnn function with RVV
2. **Technique catalog** — All 25 expert RVV techniques with when/how to apply
3. **RVV code patterns** — Template code for: strip-mining loop, tiled matmul, polynomial eval, hybrid activation, quantized conv, reduction
4. **Search space** — 14 improvement opportunities to evaluate for each function
5. **Validation** — How to build (`build.sh AX45MPV`), test (`test.sh` with RVV flags), and measure performance

### Key Reference Files
- `internal/internal_vec_mat_mul_tiling.h` — Tiling framework (exemplar: cache-blocked matmul)
- `internal/internal_vec_isa.h` + `internal_vec_isa_v1_0.h` — Vector intrinsic abstractions
- `Source/ConvolutionFunctions/riscv_nn_conv_1x1_HWC_s8_s8_s8_asym_bias_fast_any.c` — Tiling + dot product + weight contribution
- `Source/FullyConnectedFunctions/riscv_nn_fc_s8_s16_s8_sym_bias_fast.c` — 4-way unrolling + input replication + masked reduction
- `Source/ActivationFunctions/riscv_nn_tanh_f32.c` — Polynomial + hybrid + fast reciprocal
- `Source/ActivationFunctions/riscv_nn_relu_s8.c` — Strip-mining with LMUL tuning
- `Source/SoftmaxFunctions/riscv_nn_softmax_f32.c` — Three-pass reduction + ACE extensions
- `Source/BasicFunctions/riscv_nn_ew_mul_s8_asym.c` — Requantization with type promotion chain

## Verification

1. Skill file loads correctly when invoked via `/optimize-libnn`
2. Contains actionable RVV-specific guidance applicable to any Source/ function
3. All 25 expert techniques documented with code pattern examples
4. Future search space covers algorithmic, micro-architectural, and coverage gaps
