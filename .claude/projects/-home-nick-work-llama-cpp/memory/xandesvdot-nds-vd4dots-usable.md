---
name: xandesvdot-nds-vd4dots-usable
description: "XAndesVDot (nds.vd4dots.vv) is already in all 3 vsim engines and the assembler - no COPILOT/ACE needed; how to build/run it, and the vlse32 stride-0 trap that makes it look 18x slower"
metadata: 
  node_type: memory
  type: project
  originSessionId: ebfb04e0-19ef-4a1a-9e2c-58953c138710
  modified: 2026-07-29T01:22:32.004Z
---

`nds.vd4dots.vv` (XAndesVDot) is a STOCK Andes vendor instruction, not custom ACE.
Verified 2026-07-29 while answering "what can ace-rvv still optimize" (roadmap F6,
see [[q1_0-wide-vlen-repack-rowparallel]]).

Semantics (verified by running, QEMU + vsim): with vtype `e32`,
`vd[lane] += sum_{k=0..3} vs1[4*lane+k] * vs2[4*lane+k]`, int8 x int8 into the
i32 lane. Source and dest use the SAME LMUL (i8 group reinterpreted as 4 bytes
per 32-bit element).

Availability:
- RTL: `NDS_VECTOR_VDOT_SUPPORT = yes` in ax46mpv_fpga_l3, ax45mpv_premium and
  premium_full cfgs (`/local/nick/vsim/data/configs/*.cfg`). fpga_l3's ISA string
  also carries `xandesvqmac1p0 xandessintload1p0 xandesvpackfph1p0 xandesbfhcvt1p0`
  (nds.vqmacc.*, nds.vln8.v / nds.vle4.v sub-int loads, packed-fp16 MAC,
  nds.vfwcvt.f.b.v byte->float) - all unexplored.
- Assembler: needs `-march=..._xandesvdot1p0` (the VERSION suffix is required on
  older gas; unversioned works only on the ast542 linux toolchain). Baremetal
  toolchains: ast540/541/550 under `/local/ycc738/andes_toolchains/` know the
  mnemonic; **ast533 does NOT** (the q1_0 lab's default - override
  `TOOLCHAIN_PREFIX` on the make command line).
- GCC 14.2 has NO intrinsic (`__riscv_nds_vd4dots_*` = implicit declaration).
  Use inline asm. Safe: GCC treats an asm block as a vtype killer and re-emits
  its own `vsetvli` afterwards, so the asm may set vtype freely.
- QEMU: only `-cpu andes-ax45mpv` executes it. `-cpu andes-ax46mpv` SIGILLs
  (exit 132) even though the helpers are in the binary.

TWO TRAPS on ax46mpv_fpga_l3, both found the hard way:
1. `vlse32.v vd, (rs1), zero` (stride-0 broadcast, which GCC picks for
   `vmv_v_x` from a memory word) is CATASTROPHICALLY slow - element-serial.
   Replacing it with `lw` + `vmv.v.x` took the same kernel from 920 to 50
   cyc/dot (18x). Never let a broadcast become a strided load on this core.
2. The core traps (mcause exception 4, load address misaligned) on a
   misaligned 32-bit VECTOR element load. `block_q8_0` puts `qs` at offset 2,
   so any 4-byte activation group load off `qs` faults - the d4 path needs the
   activation quants in a separate 4-byte-aligned array.

Lab: `/local/nick/vsim-workspace/vsim-demo/q1_0_d4/` (copy of the q1_0 shootout
plus `q1_0_d4.c`; original q1_0/ untouched).
