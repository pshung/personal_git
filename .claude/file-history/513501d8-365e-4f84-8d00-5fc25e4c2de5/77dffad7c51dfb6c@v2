---
name: q7-only kernel inherits u8_q7 sibling wins
description: nn_mat_mul_kernel_q7_bias_2sft (q7-only) shares the same requantize tail (4-acc unroll4 main + fast-path tail) as the u8_q7 sibling -- vmadd fusion + VMV-above-VSRA hoist port directly with confirmed FPGA wins.
type: feedback
originSessionId: 513501d8-365e-4f84-8d00-5fc25e4c2de5
---
In `Source/NNSupportFunctions/nn_mat_mul_kernel_q7_bias_2sft.c`, the unroll4 active branch (`#elif defined(ENA_NDS_V5_VEC_DOT_PROD)` non-intrinsic) has TWO copies of the requantize tail: 4-row main (~lines 491-533 pre-edit) and fast-path 4-acc tail (~lines 1112-1149 pre-edit). Both have identical structure to the u8_q7 sibling (`nn_mat_mul_kernel_u8_q7_bias_2sft`).

**Why:** mainline conv functions `conv_HWC_s8_s8_s8_sym_bias_fast` and `conv_HWC_s8_s8_s8_sym_fast` (and the `_any` variants) link this q7-only kernel; mainline `conv_HWC_u8_s8_s8_sym_bias_fast` family links the u8_q7 kernel. Same skeleton, different load width.

**How to apply:**
1. When porting wins, use `Edit` with `replace_all=true` to hit BOTH tail copies (4-row + fast-path) in one edit -- they're byte-identical pre-edit.
2. Confirmed-good ports (measured on s8/s8/s8 baseline 528241):
   - r1 vmadd fusion: replace `4*VMUL_VX(out_scale) + 4*VADD_VX(NN_ROUND)` with `VMV_V_X(V30,NN_ROUND) + 4*VMADD_VX(Vk,out_scale,V30)`. V30 dead after bias-add. +0.28%.
   - r2 VMV_V_X above 4 VSRA: hoist the splat to overlap VSRA latency. +0.30%.
   - r3 VSRA+VMADD interleave (VMADD V0 between VSRA V8 and V12): only +0.04% on s8/s8/s8 because r2 already absorbed most VSRA latency. Sibling u8_q7 got +0.27% in the same slot but in a different round order. Order matters: when r2 (VMV hoist) lands first, r3's residual shrinks.
3. AVOID (regressed in u8_q7 sibling, will likely regress here):
   - Interleaving VADD bias-add into the slideup chain (RAW stall on V0/V4/V8/V12).
   - VNCLIP_WX as drop-in for VNSRA_WX (different rounding mode -> accuracy fail).
   - Tighter VSRA+VMADD packing than 3-instr spacing (VSRA latency = 2; tighter is no-op).
   - Reordering 4 VADDs sharing V30 read source (VRF read-port serialization is the bottleneck, not order).

**Other functions that link this kernel:** rows 4, 9, 13, 19 in ROADMAP.md (`s8_s8_s8_sym_bias_fast`, `s8_s8_s8_sym_fast`, `s8_s8_s8_sym_bias_fast_any`, `s8_s8_s8_sym_fast_any`). Once the kernel is optimized, those rows inherit the fix automatically -- their roadmap rows just need re-baselining, not new edits.
