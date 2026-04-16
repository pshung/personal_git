# Plan: VLEN-portable runtime dispatch for conv_1x1_HWC_s8_s8_s8_asym_bias_fast_any

## Context

The VD4DOTS optimization (commit dc9f3d62) gave a 2.6x speedup on the single perf test shape (M=448, N=32, K=512). However, profiling all 9 test shapes revealed two regressions:

- **Test 4** (K=7, N=7): VD4DOTS is 1.6x slower — K too small to fill vector registers
- **Test 9** (M=323, N=2050, K=1031): VD4DOTS is 1.6x slower — VREDSUM overhead scales as O(M*N)

**Goal:** Add VLEN-portable runtime dispatch that selects the best kernel for any shape and any VLEN (128–1024).

## Why VLEN matters for the threshold

The two kernel paths vectorize different dimensions:

| Path | Vectorized dim | LMUL | VLMAX formula | VLEN=128 | VLEN=256 | VLEN=512 | VLEN=1024 |
|------|---------------|------|---------------|----------|----------|----------|-----------|
| VQMACC tiling | N (out_ch) | M4, SEW=e8 | VLEN/2 | 64 | 128 | 256 | 512 |
| VD4DOTS direct | K (in_ch) | M8, SEW=e8 | VLEN | 128 | 256 | 512 | 1024 |

- **VQMACC tiling**: fully utilized when N >= VLMAX_e8_m4 = VLEN/2. No VREDSUM needed.
- **VD4DOTS direct**: needs one VREDSUM per output element. Cost is O(M*N) VREDSUM instructions.

A fixed threshold of 128 only works for VLEN=1024. At VLEN=256, VLMAX_e8_m4=128, so the tiling path is fully utilized at N=128 — but at VLEN=128, VLMAX_e8_m4=64, so tiling is already efficient at N=64.

**Solution:** Query VLMAX at runtime via `vsetvli` and set threshold = VLMAX/4 (25% utilization cutoff, matching the VLEN=1024 heuristic of 128 = 512/4).

## Files to Modify

1. **`Source/ConvolutionFunctions/riscv_nn_conv_1x1_HWC_s8_s8_s8_asym_bias_fast_any.c`**
   - Main function: add runtime dispatch in the `ENA_VEC_ELEN64` path (line 282)
   - `get_buffer_size` (line 757): remove `!ENA_VEC_ELEN64` guard so tiling buffer is allocated

2. **No other files need changes** — helper functions already compiled into libnn.a.

## Implementation

### Step 1: Modify `get_buffer_size` (line 757)

Change guard from:
```c
#if defined(ENA_VEC_ISA) && ... && defined(ENA_TILING) && !defined(ENA_VEC_ELEN64)
```
To:
```c
#if defined(ENA_VEC_ISA) && ... && defined(ENA_TILING)
```

This ensures the tiling buffer is allocated even when `ENA_VEC_ELEN64` is defined, since the runtime dispatch may choose the tiling path. The existing `DCACHE_SIZE` logic for computing `tiling_size` is already correct and portable — it uses `sqrt((DCACHE_SIZE << 10) / 6)` to find the largest tile that fits in cache, with 256 as default when `DCACHE_SIZE` is not defined.

### Step 2: Add runtime dispatch in `ENA_VEC_ELEN64` path (line 282)

After the contri_buf precomputation (shared by both paths), add:

```c
// Query VLMAX for the tiling path's vectorized dimension (N, at e8 LMUL=M4)
long vlmax_tiling;
NDS_VEC_VSETVLI(vlmax_tiling, reg_x0, NDS_VEC_VTYPE_SEW_E8, NDS_VEC_VTYPE_LMUL_M4);

// When N >= VLMAX/4, VQMACC tiling is faster (vectorizes N, no VREDSUM).
// When N < VLMAX/4, VD4DOTS is faster (VREDSUM overhead is small at small N).
const long n_threshold = vlmax_tiling >> 2;

if (out_tensor_ch >= n_threshold)
{
    // Large N: VQMACC tiling path (transpose + tiled GEMM)
    <tiling path code from the ENA_TILING block, lines 173-281>
}
else
{
    // Small N: direct VD4DOTS path (no transpose, VREDSUM)
    <existing VD4DOTS code, lines 403-460>
}
```

The tiling path code to copy (from the `ENA_TILING && !ENA_VEC_ELEN64` block):
- Lines 173-194: tiling_size (256 default, or DCACHE_SIZE-based), buffer setup, alignment
- Line 197: `nn_mat_mul_kernel_tiling_transpose_q7(ker_weight, src2, out_tensor_ch, in_tensor_ch)`
- Lines 199-281: stride==1 and stride!=1 branches calling `nn_mat_mul_kernel_tiling_asym_s8_s8_s8`

The tiling_size in this copied code should also use the `DCACHE_SIZE` macro if defined, matching the `get_buffer_size` computation.

Remove `(void)tmp_buf;` on line 289 since tmp_buf is now used by the tiling path.

### Step 3: No special handling for tiny K

For very small K (e.g., K=7), the absolute cycle count is tiny (~16K cycles). Both paths handle it correctly — `nn_mat_mult_nt_t_s8_v2` has internal scalar fallbacks. Not worth special-casing.

## Dispatch behavior at each VLEN

| VLEN | VLMAX_e8_m4 | Threshold (VLMAX/4) | Test shapes affected |
|------|-------------|---------------------|---------------------|
| 1024 | 512 | 128 | Tests 1-8 (N≤32) → VD4DOTS; Test 9 (N=2050) → tiling |
| 512 | 256 | 64 | Same split for these test shapes |
| 256 | 128 | 32 | N=32 becomes borderline — both paths comparable there |
| 128 | 64 | 16 | Most shapes use VD4DOTS; only N=2050 uses tiling |

## Verification

### Step 1: QEMU correctness at multiple VLENs
```bash
/usr/bin/bash /home/nick/work/libnn/qemu-validate/build_libnn.sh
for vlen in 128 256 512 1024; do
    echo "=== VLEN=$vlen ==="
    /usr/bin/bash /home/nick/work/libnn/qemu-validate/run_qemu_test.sh \
        conv_1x1_HWC_s8_s8_s8_asym_bias_fast_any --strace --vlen $vlen
done
```

### Step 2: FPGA performance (VLEN=1024, primary target)
```bash
/usr/bin/bash build.sh AX45MPV
mkdir -p build_perf_dispatch && cd build_perf_dispatch
/usr/bin/bash ../test_perf.sh ax45mpv riscv64-elf-gcc BOARD conv_1x1_HWC_s8_s8_s8_asym_bias_fast_any
```

### Expected results
- Tests 1-8 (N≤32): same as current VD4DOTS (no regression)
- Test 9 (N=2050): close to baseline VQMACC tiling (~21M cycles instead of ~34M)
- All VLENs pass QEMU correctness
