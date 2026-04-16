# Inline CLZ across RISC-V libm assembly for latency

## Context

`sf_modf.s` was found to be 23% slower than newlib's C reference on the Andes
FPGA (125k vs 154k cycles) despite having fewer total instructions. Root cause:
a `call __clzsi2` wrapped in a push/pop block that saved 6 caller-save
registers to the stack around the call. Replacing that with an inline
binary-search CLZ (19 instructions, no memory traffic) flipped the result to
1.23x faster (101k cycles).

The same anti-pattern exists in 26 other callsites across the top-level
`libm/machine/riscv/*.s` files. This plan inlines CLZ everywhere it appears in
the hot path, prioritising latency over code size.

## Scope

**In scope:** every `call __clzsi2` in `libm/machine/riscv/*.s` (top-level
only; `rv32e/` is a separate concern and generally build-optimised for size).

**Out of scope:**
- Soft-float helper calls (`__divdf3`, `__adddf3`, `__muldf3`, `__fixdfsi`,
  etc.) in `k_rem_pio2.s`, `e_jn.s`, `s_cbrt.s`, `s_nextafter.s`, `e_acos.s`.
  Inlining these is a much larger rewrite and belongs in a separate pass.
- `rv32e/` subdirectory.
- `sf_modf.s` (already done).

## Target files (26 callsites)

High-impact (called from common hot paths, some multiple times per function):

1. `andes_dpexlog.s` - 2 calls via private `.Ldo_clzsi2` helper (feeds log,
   pow, atanh, expm1, etc. for double precision)
2. `andes_fpexlog.s` - 2 calls via private `.Ldo_clzsi2_f` helper (float
   counterpart)
3. `s_fmod.s` - 3 callsites (LL4 @94, LL10 @179, LL13 @223)
4. `sf_fmod.s` - 3 callsites (Li3 @53, LAspecA @100, LAspecB @124)
5. `s_atan2.s` - 2 callsites (LL10 @184, LL13 @248), each using two-stage push
6. `s_log.s` - 1 callsite (LL11 @87)
7. `s_log10.s` - 1 callsite (LL17 @99)
8. `sf_log.s` - 1 callsite (LBspec @46), two-stage push
9. `sf_log10.s` - 1 callsite (LCspec2 @55)
10. `s_pow.s` - 1 callsite (LL25 @242)
11. `sf_pow.s` - 1 callsite (LAspecA @214)
12. `s_sqrt.s` - 1 callsite @242
13. `s_acos.s` - 1 callsite @55
14. `s_asin.s` - 1 callsite @45
15. `s_modf.s` - 1 callsite (LL19 @54) - double-frame case
16. `sf_sinh.s` - 1 callsite @113
17. `sf_frexp.s` - 1 callsite @33, two-stage push
18. `sf_ldexp.s` - 1 callsite @52, two-stage push
19. `andes_exsub.s` - 1 callsite @45 (shared helper, called from `__gf_exadd`,
    `__gf_exmul` via exsub path)
20. `andes_dpexatan.s` - 1 callsite @220

Already-acceptable, do not touch:
- `sf_acos.s` lines 38-52 and 99-102, `sf_asin.s` lines 46-59 - wrapper is
  shared with an adjacent `__gf_fpexsqrt` call, so the spill is amortised.

## The inline CLZ template (reusable)

This is the sequence already deployed in `sf_modf.s`. It assumes the input is
non-zero (all current callsites have a `beqz ..., <skip>` immediately before).
Adjust register names per callsite - input register, output register, and two
scratch registers must be chosen based on what is live at that point.

```asm
	# CLZ of <IN> -> <OUT>; input must be non-zero
	# scratch: <SCR1> (copy of IN), <SCR2> (mask/flag)
	li	<OUT>, 0
	mv	<SCR1>, <IN>
	srli	<SCR2>, <SCR1>, 16
	bnez	<SCR2>, .Lclz8_<tag>
	slli	<SCR1>, <SCR1>, 16
	addi	<OUT>, <OUT>, 16
.Lclz8_<tag>:
	srli	<SCR2>, <SCR1>, 24
	bnez	<SCR2>, .Lclz4_<tag>
	slli	<SCR1>, <SCR1>, 8
	addi	<OUT>, <OUT>, 8
.Lclz4_<tag>:
	srli	<SCR2>, <SCR1>, 28
	bnez	<SCR2>, .Lclz2_<tag>
	slli	<SCR1>, <SCR1>, 4
	addi	<OUT>, <OUT>, 4
.Lclz2_<tag>:
	srli	<SCR2>, <SCR1>, 30
	bnez	<SCR2>, .Lclz1_<tag>
	slli	<SCR1>, <SCR1>, 2
	addi	<OUT>, <OUT>, 2
.Lclz1_<tag>:
	srli	<SCR2>, <SCR1>, 31
	xori	<SCR2>, <SCR2>, 1
	add	<OUT>, <OUT>, <SCR2>
```

`<tag>` is a unique per-callsite suffix (e.g. `_fmod1`, `_log`, `_atan2_10`)
to avoid label collisions when a file has multiple callsites.

`<SCR1>` must be preserved across the sequence; `<IN>` is untouched if it's
not the same register as `<SCR1>`. Callsites that need `<IN>` preserved after
CLZ must use a distinct `<SCR1>`. Callsites that immediately do
`sll <IN>, <IN>, <OUT>` right after can use `<IN>` itself as `<SCR1>`.

## Per-file actions

For each target file:

1. Read the file.
2. Locate the `addi sp, sp, -N` / spill / `call __clzsi2` / reload /
   `addi sp, sp, +N` block.
3. Identify which registers are live at that point and pick 2 dead registers
   for `<SCR1>`/`<SCR2>`. Common free registers: `t0` (x5), `t1` (x6), `t2`
   (x7), `t6` (x31), `x17` (a7). Verify by grep that the chosen scratch is not
   referenced between the end of the CLZ and the next assignment.
4. Replace the push/call/pop block with the inline CLZ template, substituting
   `<IN>` = the register that was `mv x10, <reg>`'d before the call, `<OUT>` =
   the register that received the `mv ..., x10` after the call.
5. If the CLZ was the only `call` in the function, also remove `sw ra, ...` /
   `lw ra, ...` from the outer prologue/epilogue and shrink that frame by 4
   bytes (or 0 if the remaining saved regs already fit).
6. If the file has a two-stage push (two `addi sp, sp, -16` pairs), both
   disappear along with the call they wrapped.

### Special case: `andes_dpexlog.s` / `andes_fpexlog.s`

These define a private helper `.Ldo_clzsi2` (`.Ldo_clzsi2_f`) with its own
`-24`/`-28` frame that spills x10-x14(+x15), calls `__clzsi2`, and returns.
Each helper is called from exactly 2 sites via `call .Ldo_clzsi2`.

Two options:
- **A (chosen):** inline the CLZ body at each of the 2 callsites (4 inlinings
  total across both files) and delete the helper function. Maximum latency
  reduction: no call+ret, no memory traffic, no __clzsi2 body.
- B: leave the helper, but replace its body with inline CLZ. Simpler change,
  keeps one call+ret of overhead.

Going with **A** because the user asked to optimise for latency.

### Special case: `andes_exsub.s`

`__gf_exsub` is itself a shared helper called from `__gf_exadd`, `__gf_exmul`,
`__gf_dpexatan`, etc. The `call __clzsi2` inside `__gf_exsub` has its own
register pressure - need to verify which registers it saves in its own
prologue and pick scratch from there.

## Verification

After each file is edited (or in batches):

```sh
cd libm/machine/riscv
make test-<func>        # correctness vs newlib reference
make bench-<func>       # cycle count opt vs ref on FPGA
```

Final full-suite verification:

```sh
make test-all           # every function passes diff
make bench-all          # full cycle/instruction table
```

Record before/after numbers for each touched function. A non-regressing file
must: (a) still pass `test-<func>`, (b) show opt_cyc <= previous opt_cyc, and
(c) show speedup >= 1.00x (opt no slower than ref). The 1.23x result for
`modff` is the baseline expectation for best-case improvement.

## Critical files to modify

- `libm/machine/riscv/andes_dpexlog.s`
- `libm/machine/riscv/andes_fpexlog.s`
- `libm/machine/riscv/andes_exsub.s`
- `libm/machine/riscv/andes_dpexatan.s`
- `libm/machine/riscv/s_fmod.s`
- `libm/machine/riscv/sf_fmod.s`
- `libm/machine/riscv/s_atan2.s`
- `libm/machine/riscv/s_log.s`
- `libm/machine/riscv/s_log10.s`
- `libm/machine/riscv/sf_log.s`
- `libm/machine/riscv/sf_log10.s`
- `libm/machine/riscv/s_pow.s`
- `libm/machine/riscv/sf_pow.s`
- `libm/machine/riscv/s_sqrt.s`
- `libm/machine/riscv/s_acos.s`
- `libm/machine/riscv/s_asin.s`
- `libm/machine/riscv/s_modf.s`
- `libm/machine/riscv/sf_sinh.s`
- `libm/machine/riscv/sf_frexp.s`
- `libm/machine/riscv/sf_ldexp.s`

## Reference

Working example of the pattern: `libm/machine/riscv/sf_modf.s` lines 48-76
(inline CLZ using `t6`/`x17` as scratch, frame shrunk from 32 to 16 bytes,
`ra` save removed).

## Execution order (suggested)

1. Start with leaf/shared helpers that feed many math routines. Fixing these
   improves everything downstream:
   - `andes_dpexlog.s`, `andes_fpexlog.s` (feeds log/pow/expm1 family)
   - `andes_exsub.s` (feeds extended-precision arithmetic)
   - `andes_dpexatan.s` (feeds atan family)
2. Then the direct math routines that still have their own CLZ calls:
   `s_fmod.s`, `sf_fmod.s`, `s_atan2.s`, etc.
3. Finally the simpler one-offs: frexp, ldexp, sinh, sqrt, etc.
4. After each file, run `make test-<f>` and `make bench-<f>`; after the full
   batch, run `make test-all` and `make bench-all`.
