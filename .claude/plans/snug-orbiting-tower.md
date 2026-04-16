# Plan: Upgrade conv_1xn to use v4 GEMM kernel

## Context

The previous optimization replaced `nn_mat_mult_kernel_s8_offset_v2` (2x2/M4) with `v4` (4x2/M2) in `conv_HWC_s8_s8_s8_asym_bias_any`, achieving a 3.09x speedup from initial baseline. The same v2 kernel is used by `riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any` — upgrading it to v4 should yield a similar improvement with minimal code change.

## Target function

**`riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any`** — 1D convolution (HWC layout, s8 in/wt/out, asymmetric quantization, any channel count).

- **Source**: `Source/ConvolutionFunctions/riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any.c` (595 LOC)
- **Unit test**: `Examples/unit_func/t_conv_1xn_HWC_s8_s8_s8_asym_bias_any.c`
- **Test cases**:
  - test-1: out_ch=5, in_ch=684, ker_dim_x=3, batch=3, with bias (v4 processes 4, remainder 1)
  - test-2: out_ch=31, in_ch=684, ker_dim_x=3, batch=2, no bias (v4 processes 28, remainder 3)
  - test-3 (perf): out_ch=32, in_ch=512, ker_dim_x=3, batch=1, with bias (v4 processes all 32)

## What to change

### 1. `Source/ConvolutionFunctions/riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any.c`

**Line 206**: Change `nn_mat_mult_kernel_s8_offset_v2` → `nn_mat_mult_kernel_s8_offset_v4`

That's it. One function name change. The v4 kernel is a drop-in replacement for v2 (same signature, same semantics). The conv_1xn function passes `contri_buf` as the `bias` parameter — v4 treats this identically to v2.

### 2. No header changes needed

v4 is already declared in `Include/riscv_nn_support.h`.

### 3. No kernel changes needed

v4 already handles remainder channels (falls back to v2 internally for `out_ch % 4`).

## Why this works

The conv_1xn RVV path (line 58) pre-computes `contri_buf[ch] = bias[ch] + in_offset * sum(weights[ch])` once, then passes it as `bias` to the GEMM kernel. The kernel just loads `bias[ch]` and adds it to the dot product result. Both v2 and v4 do this identically — the only difference is v4 tiles 4 channels at a time instead of 2.

Test case coverage:
- **out_ch=5**: exercises v4's 4-channel main loop (1 iteration) + v2 fallback for remainder 1
- **out_ch=31**: exercises v4 main loop (7 iterations) + v2 fallback for remainder 3
- **out_ch=32**: exercises v4 main loop only (8 iterations), no remainder

## Workflow steps

### Step 1: Capture baseline
```bash
cd qemu-validate
bash build_libnn.sh
bash run_fpga_test.sh conv_1xn_HWC_s8_s8_s8_asym_bias_any --perf --tag baseline
```

### Step 2: Make the change
Edit line 206 of `riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any.c`:
`nn_mat_mult_kernel_s8_offset_v2` → `nn_mat_mult_kernel_s8_offset_v4`

### Step 3: Build
```bash
cd qemu-validate && bash build_libnn.sh --verbose
```
- Must compile with zero warnings/errors (`-Wall -Werror`)

### Step 4: QEMU verify (correctness)
```bash
bash run_qemu_test.sh conv_1xn_HWC_s8_s8_s8_asym_bias_any --vlen 1024 --strace
```
- All 3 sub-tests must show "accuracy checking pass"
- Tests against pre-computed golden data in `Examples/unit_func/bin/`

### Step 5: FPGA benchmark (performance)
```bash
bash run_fpga_test.sh conv_1xn_HWC_s8_s8_s8_asym_bias_any --perf --tag v4
```
- Board: `sw-boards.andestech.com:1116`
- Runs test-3 only (`ENA_MEASURE_PERF=1`): out_ch=32, in_ch=512, ker=3, batch=1
- Compare cycle count against baseline

### Step 6: Record result in optdb
```bash
.venv/bin/python3 scripts/optdb.py add \
  --title "conv_1xn: upgrade GEMM kernel v2→v4" \
  --category "kernel-upgrade" \
  --tags "conv_1xn, v4, GEMM, tiling" \
  --text "..." \
  --function "riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any" \
  --speedup "..." --fpga-cycles "..."
```

### Step 7: Commit
```bash
git add Source/ConvolutionFunctions/riscv_nn_conv_1xn_HWC_s8_s8_s8_asym_bias_any.c
git commit -m "[opt/rvv] Upgrade conv_1xn GEMM kernel from v2 to v4 (4x2 tiling)"
```

## Expected result

Test-3 workload: out_ch=32, in_ch=512, ker=3 → `num_col_a = 1536`.
- v2 (2x2/M4): 16 iterations of outer loop, VLMAX(e8,M4)=512 → 3 strip-mining iterations
- v4 (4x2/M2): 8 iterations of outer loop, VLMAX(e8,M2)=256 → 6 strip-mining iterations

v4 saves pixel reloads (2 loads shared across 4 weight rows instead of 2). Expected ~25% cycle reduction, similar to the conv_HWC result.
