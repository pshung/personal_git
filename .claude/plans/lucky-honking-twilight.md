# Batch Plan: Code Size Optimization for all 22 Tested libm Functions

## Context

The `/home/nick/work/picolibc_agentic/libm/machine/riscv/` directory contains RISC-V soft-float libm assembly.
The `test/` subfolder has 22 test programs, one per function. The goal is to reduce `.text` size of
the `sf_*.s` assembly files (single-precision float, soft-float RV32) that have tests, using the
standalone `Makefile` to build, measure, and validate.

`sf_fabs.s` was already optimized (leaf function, 3-instruction form) and serves as the reference pattern.
`sf_fpclassify.s` is already a leaf function with no stack frame — already optimal.

---

## Research Summary

### Test coverage (22 functions in `test/`)
acosf, asinf, atanf, ceilf, cosf, coshf, expf, fabsf, floorf, fmodf, fpclassifyf, frexpf, ldexpf,
log10f, logf, modff, powf, sinf, sinhf, sqrtf, tanf, tanhf

### Optimization patterns found

| Pattern | Files | Est. Savings | Risk |
|---|---|---|---|
| Leaf function: remove unnecessary ra push/pop | sf_ceil, sf_floor | ~16B each | LOW |
| Double-frame for `__clzsi2` in subnormal path | sf_frexp, sf_modf, sf_ldexp, sf_fmod, sf_log, sf_log10, sf_sinh, sf_pow | ~8-36B each | MEDIUM |
| 6-mv adapter chains around `__gf_fpexexp`/`fpexlog` calls | sf_exp, sf_log, sf_log10, sf_sinh, sf_cosh, sf_tanh, sf_pow | ~12B each | MEDIUM |
| Save/restore mv around 64-bit multiply | sf_sin, sf_cos, sf_tan | ~8B each | MEDIUM |
| Investigate smaller functions | sf_sqrt, sf_atan, sf_asin, sf_acos | TBD | MEDIUM |

### Scope: rv32 only
Only optimize the main `sf_*.s` files (soft-float RV32). Do NOT touch `rv32e/` files.

---

## E2E Test Recipe

```sh
cd /home/nick/work/picolibc_agentic/libm/machine/riscv

# Build and check size (must succeed):
make clean && make size

# Test a single function (replace <funcname> with actual name, e.g. ceilf):
make test-<funcname>

# Or test everything:
make test-all
```

**IMPORTANT:** Use `make` targets for QEMU testing. Do NOT use the qemu-runner agent.

---

## Work Units

### Unit 1: sf_ceil.s — Leaf function conversion
**Files:** `sf_ceil.s`
**Change:** Remove `addi sp,sp,-16 / sw ra,0(sp)` prologue and `lw ra,0(sp) / addi sp,sp,16` epilogue.
The function body contains zero `call` instructions, so `ra` is never overwritten.
Follow the `sf_fabs.s` precedent (commit cf0c4b6ea).
**Test:** `make test-ceilf`

### Unit 2: sf_floor.s — Leaf function conversion
**Files:** `sf_floor.s`
**Change:** Same as Unit 1. `sf_floor.s` has the identical `ra` push/pop pattern with no calls in body.
**Test:** `make test-floorf`

### Unit 3: sf_frexp.s — Eliminate double-frame sub-frame for `__clzsi2`
**Files:** `sf_frexp.s`
**Change:** The current code allocates a second stack frame inside the subnormal path to save
registers around the `__clzsi2` call. Instead, spill those registers into unused slots of the
main frame (extend main frame if needed). Saves ~2 `addi sp` + 2 `addi sp` = ~16B.
**Test:** `make test-frexpf`

### Unit 4: sf_modf.s — Eliminate double-frame sub-frame for `__clzsi2`
**Files:** `sf_modf.s`
**Change:** Same double-frame pattern as frexp. Consolidate into main frame.
**Test:** `make test-modff`

### Unit 5: sf_ldexp.s — Eliminate double-frame sub-frame for `__clzsi2`
**Files:** `sf_ldexp.s`
**Change:** Same double-frame pattern. Consolidate into main frame.
**Test:** `make test-ldexpf`

### Unit 6: sf_log.s — 6-mv adapter chain + subnormal double-frame
**Files:** `sf_log.s`
**Change:** (a) Analyze the 6-mv shuffle before/after `call __gf_fpexlog` and eliminate if register
layout can be arranged upstream. (b) Subnormal path uses a double-frame for `__clzsi2` — consolidate
into the main frame's unused slots. Current frame is 32 bytes, only slots 4 and 16 used.
**Test:** `make test-logf`

### Unit 7: sf_log10.s — Same pattern as sf_log.s
**Files:** `sf_log10.s`
**Change:** Same as Unit 6 — 6-mv adapter + subnormal double-frame for `__clzsi2`.
**Test:** `make test-log10f`

### Unit 8: sf_exp.s — 6-mv adapter chain analysis + frame reduction
**Files:** `sf_exp.s`
**Change:** (a) Eliminate the 6-mv shuffle before/after `call __gf_fpexexp` by rearranging register
setup upstream. (b) Reduce 32-byte frame to 16-byte (only `ra` + 1 spill slot needed).
**Test:** `make test-expf`

### Unit 9: sf_fmod.s — 3x double-frame for `__clzsi2`
**Files:** `sf_fmod.s`
**Change:** The function calls `__clzsi2` three times, each time dynamically allocating and tearing
down a 32-byte sub-frame. Extend the main frame once to accommodate all needed spill slots,
then use pre-allocated slots at each call site.
**Test:** `make test-fmodf`

### Unit 10: sf_sin.s + sf_cos.s — mv save/restore around 64-bit multiply
**Files:** `sf_sin.s`, `sf_cos.s`
**Change:** The pattern `mv x20,x10; mul x10,x13,x11; mulhu x11,x13,x11; mv x10,x20` appears
multiple times. Rearrange register allocation so the multiply's source/dest registers don't
conflict with the preserved value, eliminating the save/restore `mv` pairs.
**Test:** `make test-sinf`, `make test-cosf`

### Unit 11: sf_sinh.s + sf_cosh.s + sf_tanh.s — 6-mv adapter chains
**Files:** `sf_sinh.s`, `sf_cosh.s`, `sf_tanh.s`
**Change:** All three call `__gf_fpexexp` with a 6-mv shuffle before and after (calling convention
adapter). Analyze whether upstream register arrangement can eliminate these mv chains.
Additionally: `sf_sinh.s` has a `__clzsi2` double-frame that can be consolidated.
**Test:** `make test-sinhf`, `make test-coshf`, `make test-tanhf`

### Unit 12: sf_pow.s — 12-mv adapter chains + clzsi2 double-frame
**Files:** `sf_pow.s`
**Change:** Largest file (96-byte frame, 297 lines). Calls both `__gf_fpexlog` and `__gf_fpexexp`
each with a 6-mv adapter (12 mv total), and has one `__clzsi2` double-frame. Eliminate all
of these. Largest potential savings (~28-40B).
**Test:** `make test-powf`

### Unit 13: sf_sqrt.s + sf_atan.s + sf_asin.s + sf_acos.s + sf_tan.s — investigate and optimize
**Files:** `sf_sqrt.s`, `sf_atan.s`, `sf_asin.s`, `sf_acos.s`, `sf_tan.s`
**Change:** Audit each file. Specific known opportunities:
- `sf_sqrt.s`: 16-byte frame with x9+x18+ra saved; check if all saves are needed
- `sf_atan.s`: Cannot easily tail-call (x9 needed post-call), but check for other savings
- `sf_asin.s`/`sf_acos.s`: Call `__clzsi2` in subnormal path — apply double-frame elimination
- `sf_tan.s`: Complex with `divu`/`remu`; look for any eliminations in prologues
**Test:** `make test-sqrtf`, `make test-atanf`, `make test-asinf`, `make test-acosf`, `make test-tanf`

---

## Shared Worker Instructions

Toolchain: `/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds32le-elf-mculib-v5/bin/riscv32-elf-gcc`
QEMU: `/local/nick/qemu_v5/build/qemu-system-riscv32`
Working dir: `/home/nick/work/picolibc_agentic/libm/machine/riscv`
Main branch: `mculib-3.2.0`

For each change:
1. Run `make size` before and after to confirm reduction
2. Run `make test-<funcname>` to confirm PASS
3. Do NOT modify rv32e/ files (scope is rv32 only)
4. If a change turns out not to save bytes, skip it (don't commit neutral changes)

---

## Key File Paths

- `sf_fabs.s` — reference leaf function (done, use as model)
- `Makefile` — build/test/size infrastructure
