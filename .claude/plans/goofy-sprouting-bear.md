# Plan: Code Size Optimization of RISC-V Assembly Functions

## Context

The RISC-V libm assembly files were transliterated from Andes NDS32 ISA. The translation introduced mechanical idioms that are suboptimal for RV32IMC. The goal is to reduce code size for each function without algorithm changes, verified by `make test-<func>` after each change and measured with `make size-<func>`.

**Target ISA:** RV32IMC (C extension enabled per Makefile `-march=rv32imc`)

## Optimization Patterns to Apply

### Pattern 1: `slti t6, xN, 0` + `beqz/bnez t6` -> `bgez/bltz` (4 bytes saved each)
The NDS32 translation created 2-instruction sign-test-and-branch sequences. RV32 has direct `bgez`/`bltz`/`blez`/`bgtz` instructions. ~100+ instances across codebase.

### Pattern 2: Dead `mul` instructions (4-12 bytes saved each)
`mulhu` + `mul` pairs where only the high word is used. The `mul` result is immediately overwritten by a `mv`. Remove the dead `mul` and associated save/restore `mv` instructions. ~20-30 instances.

### Pattern 3: `sltu`/`sltiu` + `beqz/bnez` -> `bltu/bgeu` (4 bytes saved each)
Same mechanical translation for unsigned comparisons. Register-register comparisons can use `bltu`/`bgeu` directly. ~30-50 instances.

### Pattern 4: Redundant constant reloads
Same constant (e.g., `0x80000000`) loaded multiple times in one function. Load once, keep in register.

### Pattern 5: Stack frame over-allocation / double push-pop
Some functions allocate more stack than needed or use two `addi sp` instructions where one suffices.

## Execution Strategy

Process functions one at a time. For each function:

1. `make size-<func>` -- record baseline size
2. Read the `.s` file, identify applicable patterns
3. Apply optimizations
4. `make test-<func>` -- verify correctness (PASS)
5. `make size-<func>` -- record new size
6. Move to next function

### Order: Start with single-precision, then double-precision

**Single-precision (22 functions):**
sinf, cosf, tanf, atanf, asinf, acosf, fabsf, ceilf, floorf, expf, sinhf, coshf, tanhf, logf, log10f, sqrtf, fmodf, powf, frexpf, ldexpf, modff, fpclassifyf

**Double-precision (31 functions):**
sin, cos, tan, atan, asin, acos, fabs, ceil, floor, exp, sinh, cosh, tanh, log, log10, sqrt, fmod, pow, frexp, ldexp, modf, fpclassify, expm1, log1p, rint, round, trunc, fmax, fmin, ilogb, nextafter, remquo

## Critical Files

- Assembly sources: `sf_*.s` and `s_*.s` in `/home/nick/work/picolibc_agentic/libm/machine/riscv/`
- Makefile: `/home/nick/work/picolibc_agentic/libm/machine/riscv/Makefile`
- Shared helpers (`andes_*.s`) - read but optimize separately since they affect multiple functions

## Verification

For each function: `make test-<func>` must output PASS.
After all functions: `make test-all` for full regression, `make size-all` for final size report.
