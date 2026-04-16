---
name: rvv-asm-ref
description: "RISC-V Vector Extension (RVV) 1.0 assembly instruction reference and NDS_ macro mapping for libnn. Use when writing, reading, optimizing, or debugging RVV inline assembly code. Triggers on RVV instructions, vector assembly, NDS_VEC_ macros, vsetvli, vle/vse, vadd/vmul/vfmacc, widening/narrowing operations, mask operations, reductions, or any RISC-V vector extension work."
---

# RVV 1.0 Assembly Reference

Comprehensive reference for RISC-V Vector Extension 1.0 assembly instructions and the NDS_VEC_* macro wrappers used in libnn.

## When to Use

- Writing new RVV-optimized functions for libnn
- Reading/understanding existing NDS_VEC_* macro calls in source code
- Choosing the right instruction for an optimization (e.g., widening MAC vs regular MAC)
- Debugging assembly output from objdump
- Converting between NDS_ macro style and raw RVV assembly

## Reference

Read [references/rvv1p0_instructions.md](references/rvv1p0_instructions.md) for the full instruction listing organized by category:

1. **Configuration** — vsetvli, vsetivli, vsetvl
2. **Loads** — unit-stride, strided, indexed, segment, whole-register, fault-only-first
3. **Stores** — unit-stride, strided, indexed, segment, whole-register
4. **Integer Arithmetic** — add/sub, widening, multiply, MAC, divide, logical, shift, min/max, compare, saturating, averaging, merge/move, extend
5. **Fixed-Point** — fractional multiply, scaling shift, narrowing clip
6. **Floating-Point** — basic ops, widening, FMA (8 variants), min/max, sign injection, compare, classify, type conversion (same/widen/narrow), merge/move
7. **Reductions** — integer (sum, and, or, xor, min, max), FP (ordered/unordered sum, min, max)
8. **Mask Operations** — logical (and, or, xor, nand, nor, andn, orn, xnor), bit manipulation (sbf, sif, sof, iota, vid), scalar (cpop, first)
9. **Permutation** — slide, gather, compress, whole register move
10. **NDS_ Macro Mapping** — naming convention, examples, SEW/LMUL constants

## Quick Lookup Guide

To find an instruction by operation:
- **Load data**: vle{8,16,32,64}.v, vlse (strided), vluxei/vloxei (indexed), vlseg (segment)
- **Store data**: vse{8,16,32,64}.v, vsse (strided), vsuxei/vsoxei (indexed)
- **Integer MAC**: vmacc.vv (accumulate), vwmacc.vv (widening accumulate)
- **FP MAC**: vfmacc.vv/.vf (accumulate), vfwmacc (widening)
- **Widen**: vwadd, vwsub, vwmul, vwmacc (integer); vfwadd, vfwsub, vfwmul, vfwmacc (FP)
- **Narrow**: vnsrl, vnsra (shift), vnclipu, vnclip (clip); vfncvt (FP convert)
- **Convert types**: vfcvt (same width), vfwcvt (widen), vfncvt (narrow)
- **Reduce**: vredsum, vredmax (int); vfredosum, vfredusum (FP)
- **Compare to mask**: vmseq, vmslt, vmsle, vmsgt (int); vmfeq, vmflt, vmfle (FP)

## libnn Header Files

- Unmasked macros: `internal/internal_vec_i_v1_0.h` (839 macros)
- Masked macros: `internal/internal_vec_im_v1_0.h` (718 macros)
- Macro naming: `NDS_VEC_<INSTR>_<VARIANT>` maps to `<instr>.<variant>`
