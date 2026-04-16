# RVV 1.0 Instruction Reference

Source: https://github.com/riscvarchive/riscv-v-spec/blob/v1.0/v-spec.adoc

## Notation
- `vd` = destination vector register
- `vs1`, `vs2`, `vs3` = source vector registers
- `rs1`, `rs2` = scalar integer registers (x[rs1])
- `rs1`(in .vf) = scalar FP register (f[rs1])
- `vm` = mask (v0.t for masked, omit for unmasked)
- `imm` = immediate value
- SEW = selected element width, LMUL = length multiplier

## 1. Configuration

| Mnemonic | Operands | Description |
|---|---|---|
| vsetvli | rd, rs1, vtypei | Set vl/vtype from AVL in x[rs1], vtype as immediate |
| vsetivli | rd, uimm, vtypei | Set vl/vtype from 5-bit immediate AVL |
| vsetvl | rd, rs1, rs2 | Set vl/vtype from x[rs1] (AVL) and x[rs2] (vtype) |

vtypei encoding: e{8,16,32,64}, m{1,2,4,8,f2,f4,f8}, t{a,u} (tail agnostic/undisturbed), m{a,u} (mask agnostic/undisturbed)

## 2. Loads

### Unit-Stride
| Mnemonic | Description |
|---|---|
| vle8.v vd, (rs1), vm | Load 8-bit elements |
| vle16.v vd, (rs1), vm | Load 16-bit elements |
| vle32.v vd, (rs1), vm | Load 32-bit elements |
| vle64.v vd, (rs1), vm | Load 64-bit elements |
| vlm.v vd, (rs1) | Load mask (ceil(vl/8) bytes) |

### Fault-Only-First
| Mnemonic | Description |
|---|---|
| vle8ff.v vd, (rs1), vm | Load 8-bit, trim vl on fault past element 0 |
| vle16ff.v vd, (rs1), vm | Load 16-bit fault-only-first |
| vle32ff.v vd, (rs1), vm | Load 32-bit fault-only-first |
| vle64ff.v vd, (rs1), vm | Load 64-bit fault-only-first |

### Strided
| Mnemonic | Description |
|---|---|
| vlse8.v vd, (rs1), rs2, vm | Load 8-bit with byte stride x[rs2] |
| vlse16.v vd, (rs1), rs2, vm | Load 16-bit strided |
| vlse32.v vd, (rs1), rs2, vm | Load 32-bit strided |
| vlse64.v vd, (rs1), rs2, vm | Load 64-bit strided |

### Indexed (Unordered)
| Mnemonic | Description |
|---|---|
| vluxei8.v vd, (rs1), vs2, vm | Load using 8-bit byte offsets in vs2 |
| vluxei16.v vd, (rs1), vs2, vm | Load using 16-bit byte offsets |
| vluxei32.v vd, (rs1), vs2, vm | Load using 32-bit byte offsets |
| vluxei64.v vd, (rs1), vs2, vm | Load using 64-bit byte offsets |

### Indexed (Ordered)
| Mnemonic | Description |
|---|---|
| vloxei8.v vd, (rs1), vs2, vm | Ordered load using 8-bit offsets |
| vloxei16.v vd, (rs1), vs2, vm | Ordered load using 16-bit offsets |
| vloxei32.v vd, (rs1), vs2, vm | Ordered load using 32-bit offsets |
| vloxei64.v vd, (rs1), vs2, vm | Ordered load using 64-bit offsets |

### Segment Loads (unit-stride)
vlseg{nf}e{eew}.v vd, (rs1), vm — nf=2..8, eew=8,16,32,64
Loads nf fields into vd, vd+1, ..., vd+nf-1

### Segment Loads (strided)
vlsseg{nf}e{eew}.v vd, (rs1), rs2, vm

### Segment Loads (indexed)
vluxseg{nf}ei{eew}.v / vloxseg{nf}ei{eew}.v vd, (rs1), vs2, vm

### Whole Register Loads
| Mnemonic | Description |
|---|---|
| vl1re8.v (vl1r.v) vd, (rs1) | Load 1 register |
| vl2re8.v (vl2r.v) vd, (rs1) | Load 2 consecutive registers |
| vl4re8.v (vl4r.v) vd, (rs1) | Load 4 consecutive registers |
| vl8re8.v (vl8r.v) vd, (rs1) | Load 8 consecutive registers |

Also available as vl{1,2,4,8}re{16,32,64}.v

## 3. Stores

### Unit-Stride
| Mnemonic | Description |
|---|---|
| vse8.v vs3, (rs1), vm | Store 8-bit elements |
| vse16.v vs3, (rs1), vm | Store 16-bit elements |
| vse32.v vs3, (rs1), vm | Store 32-bit elements |
| vse64.v vs3, (rs1), vm | Store 64-bit elements |
| vsm.v vs3, (rs1) | Store mask |

### Strided
vsse{8,16,32,64}.v vs3, (rs1), rs2, vm

### Indexed (Unordered/Ordered)
vsuxei{8,16,32,64}.v / vsoxei{8,16,32,64}.v vs3, (rs1), vs2, vm

### Segment Stores
vsseg{nf}e{eew}.v / vssseg{nf}e{eew}.v / vsuxseg{nf}ei{eew}.v / vsoxseg{nf}ei{eew}.v

### Whole Register Stores
vs{1,2,4,8}r.v vs3, (rs1)

## 4. Integer Arithmetic

### Add/Sub
| Mnemonic | Variants | Description |
|---|---|---|
| vadd | .vv .vx .vi | vd[i] = vs2[i] + vs1[i]/x[rs1]/imm |
| vsub | .vv .vx | vd[i] = vs2[i] - vs1[i]/x[rs1] |
| vrsub | .vx .vi | vd[i] = x[rs1]/imm - vs2[i] |
| vneg.v (pseudo) | | vrsub.vx vd, vs, x0 |

### Widening Add/Sub
| Mnemonic | Variants | Description |
|---|---|---|
| vwaddu | .vv .vx | Unsigned widening add (SEW -> 2*SEW) |
| vwadd | .vv .vx | Signed widening add |
| vwsubu | .vv .vx | Unsigned widening sub |
| vwsub | .vv .vx | Signed widening sub |
| vwaddu | .wv .wx | Add 2*SEW + SEW (unsigned) |
| vwadd | .wv .wx | Add 2*SEW + SEW (signed) |
| vwsubu | .wv .wx | Sub 2*SEW - SEW (unsigned) |
| vwsub | .wv .wx | Sub 2*SEW - SEW (signed) |

### Multiply
| Mnemonic | Variants | Description |
|---|---|---|
| vmul | .vv .vx | Multiply, keep low SEW bits |
| vmulh | .vv .vx | Signed multiply high |
| vmulhu | .vv .vx | Unsigned multiply high |
| vmulhsu | .vv .vx | Signed*unsigned multiply high |

### Widening Multiply
| Mnemonic | Variants | Description |
|---|---|---|
| vwmul | .vv .vx | Signed widening multiply |
| vwmulu | .vv .vx | Unsigned widening multiply |
| vwmulsu | .vv .vx | Signed*unsigned widening multiply |

### Multiply-Accumulate
| Mnemonic | Variants | Description |
|---|---|---|
| vmacc | .vv .vx | vd[i] += vs1[i] * vs2[i] |
| vnmsac | .vv .vx | vd[i] -= vs1[i] * vs2[i] |
| vmadd | .vv .vx | vd[i] = vs1[i] * vd[i] + vs2[i] |
| vnmsub | .vv .vx | vd[i] = -(vs1[i] * vd[i]) + vs2[i] |

### Widening Multiply-Accumulate
| Mnemonic | Variants | Description |
|---|---|---|
| vwmaccu | .vv .vx | 2*SEW vd += unsigned vs1 * unsigned vs2 |
| vwmacc | .vv .vx | 2*SEW vd += signed vs1 * signed vs2 |
| vwmaccsu | .vv .vx | 2*SEW vd += signed vs1 * unsigned vs2 |
| vwmaccus | .vx | 2*SEW vd += unsigned x[rs1] * signed vs2 |

### Divide/Remainder
| Mnemonic | Variants | Description |
|---|---|---|
| vdiv | .vv .vx | Signed divide |
| vdivu | .vv .vx | Unsigned divide |
| vrem | .vv .vx | Signed remainder |
| vremu | .vv .vx | Unsigned remainder |

### Bitwise Logical
| Mnemonic | Variants | Description |
|---|---|---|
| vand | .vv .vx .vi | Bitwise AND |
| vor | .vv .vx .vi | Bitwise OR |
| vxor | .vv .vx .vi | Bitwise XOR |
| vnot.v (pseudo) | | vxor.vi vd, vs, -1 |

### Shift
| Mnemonic | Variants | Description |
|---|---|---|
| vsll | .vv .vx .vi | Shift left logical |
| vsrl | .vv .vx .vi | Shift right logical |
| vsra | .vv .vx .vi | Shift right arithmetic |

### Narrowing Shift
| Mnemonic | Variants | Description |
|---|---|---|
| vnsrl | .wv .wx .wi | Narrow shift right logical (2*SEW -> SEW) |
| vnsra | .wv .wx .wi | Narrow shift right arithmetic |

### Min/Max
| Mnemonic | Variants | Description |
|---|---|---|
| vmin | .vv .vx | Signed minimum |
| vminu | .vv .vx | Unsigned minimum |
| vmax | .vv .vx | Signed maximum |
| vmaxu | .vv .vx | Unsigned maximum |

### Comparison (result in mask register)
| Mnemonic | Variants | Description |
|---|---|---|
| vmseq | .vv .vx .vi | Set mask if equal |
| vmsne | .vv .vx .vi | Set mask if not equal |
| vmslt | .vv .vx | Set mask if less than (signed) |
| vmsltu | .vv .vx | Set mask if less than (unsigned) |
| vmsle | .vv .vx .vi | Set mask if <= (signed) |
| vmsleu | .vv .vx .vi | Set mask if <= (unsigned) |
| vmsgt | .vx .vi | Set mask if > (signed) |
| vmsgtu | .vx .vi | Set mask if > (unsigned) |

### Saturating Add/Sub
| Mnemonic | Variants | Description |
|---|---|---|
| vsaddu | .vv .vx .vi | Saturating unsigned add |
| vsadd | .vv .vx .vi | Saturating signed add |
| vssubu | .vv .vx | Saturating unsigned sub |
| vssub | .vv .vx | Saturating signed sub |

### Averaging Add/Sub
| Mnemonic | Variants | Description |
|---|---|---|
| vaaddu | .vv .vx | Averaging unsigned add (rounding) |
| vaadd | .vv .vx | Averaging signed add |
| vasubu | .vv .vx | Averaging unsigned sub |
| vasub | .vv .vx | Averaging signed sub |

### Merge/Move
| Mnemonic | Variants | Description |
|---|---|---|
| vmerge | .vvm .vxm .vim | vd[i] = v0[i] ? vs1/x/imm : vs2[i] |
| vmv.v.v | vd, vs1 | Copy vector |
| vmv.v.x | vd, rs1 | Broadcast scalar to vector |
| vmv.v.i | vd, imm | Broadcast immediate |

### Scalar Move
| Mnemonic | Description |
|---|---|
| vmv.x.s rd, vs2 | Move element 0 to scalar register |
| vmv.s.x vd, rs1 | Move scalar to element 0 |

### Extend
| Mnemonic | Description |
|---|---|
| vzext.vf2 vd, vs2, vm | Zero-extend SEW/2 to SEW |
| vzext.vf4 vd, vs2, vm | Zero-extend SEW/4 to SEW |
| vzext.vf8 vd, vs2, vm | Zero-extend SEW/8 to SEW |
| vsext.vf2 vd, vs2, vm | Sign-extend SEW/2 to SEW |
| vsext.vf4 vd, vs2, vm | Sign-extend SEW/4 to SEW |
| vsext.vf8 vd, vs2, vm | Sign-extend SEW/8 to SEW |

## 5. Fixed-Point

| Mnemonic | Variants | Description |
|---|---|---|
| vsmul | .vv .vx | Fractional multiply with rounding & saturation |
| vssrl | .vv .vx .vi | Scaling shift right logical (with rounding) |
| vssra | .vv .vx .vi | Scaling shift right arithmetic (with rounding) |
| vnclipu | .wv .wx .wi | Narrowing unsigned clip (2*SEW -> SEW, saturate) |
| vnclip | .wv .wx .wi | Narrowing signed clip |

## 6. Floating-Point

### Basic FP Arithmetic
| Mnemonic | Variants | Description |
|---|---|---|
| vfadd | .vv .vf | FP add |
| vfsub | .vv .vf | FP subtract |
| vfrsub | .vf | FP reverse subtract: f[rs1] - vs2[i] |
| vfmul | .vv .vf | FP multiply |
| vfdiv | .vv .vf | FP divide |
| vfrdiv | .vf | FP reciprocal divide: f[rs1] / vs2[i] |
| vfsqrt.v | vd, vs2, vm | FP square root |
| vfrec7.v | vd, vs2, vm | FP reciprocal estimate (7-bit accuracy) |
| vfrsqrt7.v | vd, vs2, vm | FP reciprocal square root estimate |

### Widening FP
| Mnemonic | Variants | Description |
|---|---|---|
| vfwadd | .vv .vf | Widening FP add |
| vfwadd | .wv .wf | Widening FP add (2*SEW + SEW) |
| vfwsub | .vv .vf | Widening FP sub |
| vfwsub | .wv .wf | Widening FP sub (2*SEW - SEW) |
| vfwmul | .vv .vf | Widening FP multiply |

### FP Fused Multiply-Add (overwrite addend: vd = +/- vs1*vs2 +/- vd)
| Mnemonic | Variants | Description |
|---|---|---|
| vfmacc | .vv .vf | vd[i] = +(vs1[i]*vs2[i]) + vd[i] |
| vfnmacc | .vv .vf | vd[i] = -(vs1[i]*vs2[i]) - vd[i] |
| vfmsac | .vv .vf | vd[i] = +(vs1[i]*vs2[i]) - vd[i] |
| vfnmsac | .vv .vf | vd[i] = -(vs1[i]*vs2[i]) + vd[i] |

### FP Fused Multiply-Add (overwrite multiplicand: vd = +/- vs1*vd +/- vs2)
| Mnemonic | Variants | Description |
|---|---|---|
| vfmadd | .vv .vf | vd[i] = +(vs1[i]*vd[i]) + vs2[i] |
| vfnmadd | .vv .vf | vd[i] = -(vs1[i]*vd[i]) - vs2[i] |
| vfmsub | .vv .vf | vd[i] = +(vs1[i]*vd[i]) - vs2[i] |
| vfnmsub | .vv .vf | vd[i] = -(vs1[i]*vd[i]) + vs2[i] |

### Widening FP FMA
| Mnemonic | Variants | Description |
|---|---|---|
| vfwmacc | .vv .vf | 2*SEW vd += vs1 * vs2 |
| vfwnmacc | .vv .vf | 2*SEW vd = -(vs1*vs2) - vd |
| vfwmsac | .vv .vf | 2*SEW vd = vs1*vs2 - vd |
| vfwnmsac | .vv .vf | 2*SEW vd = -(vs1*vs2) + vd |

### FP Min/Max
| Mnemonic | Variants | Description |
|---|---|---|
| vfmin | .vv .vf | FP minimum (IEEE 754) |
| vfmax | .vv .vf | FP maximum (IEEE 754) |

### FP Sign Injection
| Mnemonic | Variants | Description |
|---|---|---|
| vfsgnj | .vv .vf | Copy magnitude of vs2, sign of vs1 |
| vfsgnjn | .vv .vf | Copy magnitude of vs2, negated sign of vs1 |
| vfsgnjx | .vv .vf | Copy magnitude of vs2, XOR signs |
| vfneg.v (pseudo) | | vfsgnjn.vv vd, vs, vs |
| vfabs.v (pseudo) | | vfsgnjx.vv vd, vs, vs |

### FP Comparison (result in mask)
| Mnemonic | Variants | Description |
|---|---|---|
| vmfeq | .vv .vf | Mask if equal |
| vmfne | .vv .vf | Mask if not equal |
| vmflt | .vv .vf | Mask if less than |
| vmfle | .vv .vf | Mask if less or equal |
| vmfgt | .vf | Mask if greater than |
| vmfge | .vf | Mask if greater or equal |

### FP Classify
| Mnemonic | Description |
|---|---|
| vfclass.v vd, vs2, vm | Classify FP (neg inf, neg normal, neg subnormal, neg zero, pos zero, pos subnormal, pos normal, pos inf, sNaN, qNaN) |

### FP Type Conversion (same width)
| Mnemonic | Description |
|---|---|
| vfcvt.xu.f.v | FP -> unsigned int |
| vfcvt.x.f.v | FP -> signed int |
| vfcvt.rtz.xu.f.v | FP -> unsigned int (round toward zero) |
| vfcvt.rtz.x.f.v | FP -> signed int (round toward zero) |
| vfcvt.f.xu.v | Unsigned int -> FP |
| vfcvt.f.x.v | Signed int -> FP |

### FP Widening Conversion
| Mnemonic | Description |
|---|---|
| vfwcvt.xu.f.v | FP -> wider unsigned int |
| vfwcvt.x.f.v | FP -> wider signed int |
| vfwcvt.rtz.xu.f.v | FP -> wider unsigned int (rtz) |
| vfwcvt.rtz.x.f.v | FP -> wider signed int (rtz) |
| vfwcvt.f.xu.v | Unsigned int -> wider FP |
| vfwcvt.f.x.v | Signed int -> wider FP |
| vfwcvt.f.f.v | FP -> wider FP (e.g., f16->f32) |

### FP Narrowing Conversion
| Mnemonic | Description |
|---|---|
| vfncvt.xu.f.w | Wider FP -> narrower unsigned int |
| vfncvt.x.f.w | Wider FP -> narrower signed int |
| vfncvt.rtz.xu.f.w | Wider FP -> narrower unsigned int (rtz) |
| vfncvt.rtz.x.f.w | Wider FP -> narrower signed int (rtz) |
| vfncvt.f.xu.w | Wider unsigned int -> narrower FP |
| vfncvt.f.x.w | Wider signed int -> narrower FP |
| vfncvt.f.f.w | Wider FP -> narrower FP |
| vfncvt.rod.f.f.w | Wider FP -> narrower FP (round-to-odd) |

### FP Merge/Move
| Mnemonic | Description |
|---|---|
| vfmerge.vfm vd, vs2, rs1, v0 | FP merge under mask |
| vfmv.v.f vd, rs1 | Broadcast FP scalar to vector |
| vfmv.f.s rd, vs2 | Move element 0 to FP register |
| vfmv.s.f vd, rs1 | Move FP scalar to element 0 |

## 7. Reductions

### Integer Reductions
| Mnemonic | Description |
|---|---|
| vredsum.vs vd, vs2, vs1, vm | vd[0] = sum(vs2[*]) + vs1[0] |
| vredand.vs | AND reduction |
| vredor.vs | OR reduction |
| vredxor.vs | XOR reduction |
| vredminu.vs | Unsigned min reduction |
| vredmin.vs | Signed min reduction |
| vredmaxu.vs | Unsigned max reduction |
| vredmax.vs | Signed max reduction |

### Widening Integer Reductions
| Mnemonic | Description |
|---|---|
| vwredsumu.vs | Unsigned widening sum reduction |
| vwredsum.vs | Signed widening sum reduction |

### FP Reductions
| Mnemonic | Description |
|---|---|
| vfredosum.vs | Ordered FP sum (sequential, deterministic) |
| vfredusum.vs | Unordered FP sum (may reorder for speed) |
| vfredmin.vs | FP min reduction |
| vfredmax.vs | FP max reduction |
| vfwredosum.vs | Widening ordered FP sum |
| vfwredusum.vs | Widening unordered FP sum |

## 8. Mask Operations

### Mask Logical
| Mnemonic | Description |
|---|---|
| vmand.mm vd, vs2, vs1 | Mask AND |
| vmnand.mm | Mask NAND |
| vmandn.mm | Mask AND-NOT (vs2 & ~vs1) |
| vmxor.mm | Mask XOR |
| vmor.mm | Mask OR |
| vmnor.mm | Mask NOR |
| vmorn.mm | Mask OR-NOT (vs2 | ~vs1) |
| vmxnor.mm | Mask XNOR |

### Mask Bit Manipulation
| Mnemonic | Description |
|---|---|
| vmsbf.m vd, vs2, vm | Set-before-first: bits before first set bit |
| vmsif.m vd, vs2, vm | Set-including-first: bits up to and including first |
| vmsof.m vd, vs2, vm | Set-only-first: only the first set bit |
| viota.m vd, vs2, vm | Iota: vd[i] = count of set bits in vs2[0..i-1] |
| vid.v vd, vm | Index: vd[i] = i |

### Mask Scalar
| Mnemonic | Description |
|---|---|
| vcpop.m rd, vs2, vm | Count set bits in mask -> x[rd] |
| vfirst.m rd, vs2, vm | Index of first set bit -> x[rd] (-1 if none) |

## 9. Permutation

### Slide
| Mnemonic | Variants | Description |
|---|---|---|
| vslideup | .vx .vi | Slide elements up by offset |
| vslidedown | .vx .vi | Slide elements down by offset |
| vslide1up.vx | | Slide up by 1, insert scalar at [0] |
| vslide1down.vx | | Slide down by 1, insert scalar at end |
| vfslide1up.vf | | FP slide up by 1 |
| vfslide1down.vf | | FP slide down by 1 |

### Gather
| Mnemonic | Variants | Description |
|---|---|---|
| vrgather | .vv .vx .vi | vd[i] = vs2[vs1[i]/x[rs1]/imm] |
| vrgatherei16.vv | | Gather with 16-bit indices |

### Compress
| Mnemonic | Description |
|---|---|
| vcompress.vm vd, vs2, vs1 | Pack active elements (mask in vs1) to front of vd |

### Whole Register Move
| Mnemonic | Description |
|---|---|
| vmv1r.v vd, vs2 | Copy 1 vector register |
| vmv2r.v vd, vs2 | Copy 2 consecutive registers |
| vmv4r.v vd, vs2 | Copy 4 consecutive registers |
| vmv8r.v vd, vs2 | Copy 8 consecutive registers |

## 10. NDS_ Macro Mapping

libnn wraps all RVV assembly in NDS_VEC_* macros defined in:
- `internal/internal_vec_i_v1_0.h` (839 unmasked macros)
- `internal/internal_vec_im_v1_0.h` (718 masked macros)

### Naming Pattern
```
NDS_VEC_<INSTR>_<VARIANT>(args)  ->  <instr>.<variant> args
NDS_VEC_MSK_<INSTR>_<VARIANT>(args)  ->  <instr>.<variant> args, v0.t
```

### Examples
| NDS Macro | RVV Assembly |
|---|---|
| NDS_VEC_VSETVLI(vl, avl, sew, lmul) | vsetvli vl, avl, sew, lmul |
| NDS_VEC_VLE8_V(vd, addr) | vle8.v vd, (addr) |
| NDS_VEC_VLE32_V(vd, addr) | vle32.v vd, (addr) |
| NDS_VEC_VSE8_V(vs, addr) | vse8.v vs, (addr) |
| NDS_VEC_VADD_VV(vd, vs2, vs1) | vadd.vv vd, vs2, vs1 |
| NDS_VEC_VADD_VX(vd, vs2, rs1) | vadd.vx vd, vs2, rs1 |
| NDS_VEC_VMUL_VV(vd, vs2, vs1) | vmul.vv vd, vs2, vs1 |
| NDS_VEC_VMACC_VV(vd, vs1, vs2) | vmacc.vv vd, vs1, vs2 |
| NDS_VEC_VFMACC_VV(vd, vs1, vs2) | vfmacc.vv vd, vs1, vs2 |
| NDS_VEC_VFMACC_VF(vd, rs1, vs2) | vfmacc.vf vd, rs1, vs2 |
| NDS_VEC_VWMACC_VV(vd, vs1, vs2) | vwmacc.vv vd, vs1, vs2 |
| NDS_VEC_VREDSUM_VS(vd, vs2, vs1) | vredsum.vs vd, vs2, vs1 |
| NDS_VEC_VMERGE_VVM(vd, vs2, vs1, v0) | vmerge.vvm vd, vs2, vs1, v0.t |
| NDS_VEC_VMV_V_V(vd, vs1) | vmv.v.v vd, vs1 |
| NDS_VEC_VMV_X_S(rd, vs2) | vmv.x.s rd, vs2 |

### SEW/LMUL Constants
| NDS Constant | Value |
|---|---|
| NDS_VEC_VTYPE_SEW_E8 | e8 |
| NDS_VEC_VTYPE_SEW_E16 | e16 |
| NDS_VEC_VTYPE_SEW_E32 | e32 |
| NDS_VEC_VTYPE_SEW_E64 | e64 |
| NDS_VEC_VTYPE_LMUL_M1 | m1 |
| NDS_VEC_VTYPE_LMUL_M2 | m2 |
| NDS_VEC_VTYPE_LMUL_M4 | m4 |
| NDS_VEC_VTYPE_LMUL_M8 | m8 |
| NDS_VEC_VTYPE_LMUL_MF2 | mf2 |
| NDS_VEC_VTYPE_LMUL_MF4 | mf4 |
| NDS_VEC_VTYPE_LMUL_MF8 | mf8 |
