# Plan: Libm Accuracy Tests — Optimized ASM vs Toolchain Default

## Context

We need accuracy tests for Andes-optimized RISC-V math assembly functions in picolibc. The previous approach compared x86 glibc vs RISC-V picolibc, which introduces noise from different platforms. The new approach is cleaner:

- **Golden**: compile test.c with just `-lm` → links toolchain's newlib math functions
- **Optimized**: compile test.c with optimized `.s` files linked in → overrides specific functions
- **Both run on RISC-V QEMU** → any diff is purely the optimized asm vs toolchain default

No x86, no Python, no golden files to maintain.

## Files to Modify

### `test/libm-accuracy/Makefile` — Complete rewrite
Replace x86 ref/target approach with golden/optimized RISC-V approach.

```makefile
CROSS_CC ?= /local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin/riscv64-elf-gcc
ASM_DIR  ?= ../../libm/machine/riscv
CFLAGS   ?= -O2 -Wall -Wextra -Wno-unused-parameter

# Per-test assembly file mappings
# Format: TEST_ASM_<testname> = list of .s files from ASM_DIR
```

Two build targets per test:
- `golden/<test>`: `$(CROSS_CC) -mvh $(CFLAGS) -o $@ $< -lm`
- `opt/<test>`: `$(CROSS_CC) -mvh $(CFLAGS) -o $@ $< $(ASM_FILES) -lm`

### `test/libm-accuracy/run-all.sh` — Rewrite
1. `make golden-bins opt-bins`
2. Run each golden binary via QEMU → `golden-out/<test>.out`
3. Run each opt binary via QEMU → `opt-out/<test>.out`
4. Strip blank lines (QEMU semihosting artifact)
5. Normalize NaN sign bits (`fff8...` → `7ff8...`, `ffc0...` → `7fc0...`)
6. Diff and report

### `test/libm-accuracy/test-common.h` — Keep as-is
Already has short output lines (≤30 chars) for QEMU semihosting compatibility.

### Test .c files — Keep as-is
All 14 test files remain unchanged.

## Assembly Dependency Map

Each test needs specific `.s` files. All `__clzsi2`, `__adddf3`, `__fpclassifyd`, etc. are libgcc builtins (no extra files needed).

### Shared helpers (referenced by multiple tests)
```
ANDES_COMMON_DP = andes_exmul.s andes_sigmax.s andes_exdiv.s andes_exadd.s andes_exsub.s
```

### Per-test assembly lists

| Test | Double .s files | Float .s files |
|------|----------------|----------------|
| test-sin | s_sin.s andes_dpreduct.s andes_dpsincon.s andes_dpcoscon.s + COMMON_DP | sf_sin.s andes_fpreduct.s andes_fpsincof.s andes_fpcoscof.s |
| test-cos | s_cos.s andes_dpreduct.s andes_dpsincon.s andes_dpcoscon.s + COMMON_DP | sf_cos.s andes_fpreduct.s andes_fpsincof.s andes_fpcoscof.s |
| test-sincos | (same as sin+cos combined) | (same as sinf+cosf combined) |
| test-atan | s_atan.s andes_dpexatan.s + COMMON_DP | sf_atan.s andes_fpexatan.s + COMMON_DP |
| test-exp | s_exp.s andes_dpexexp.s + COMMON_DP | sf_exp.s andes_fpexexp.s |
| test-log | s_log.s andes_dpexlog.s + COMMON_DP | sf_log.s andes_fpexlog.s |
| test-pow | s_pow.s andes_dpexlog.s andes_dpexexp.s + COMMON_DP | sf_pow.s andes_fpexlog.s andes_fpexexp.s |
| test-fabs | s_fabs.s | sf_fabs.s |
| test-sqrt | s_sqrt.s andes_dpexsqrt.s | sf_sqrt.s andes_fpexsqrt.s |
| test-fma | (no asm override — skip opt build or use C from hardfloat/) | |
| test-fmax-fmin | s_fmax.s s_fmin.s s_fpclassify.s | (float versions use builtins) |
| test-copysign | (no asm override — skip opt build) | |
| test-classify | s_fpclassify.s | sf_fpclassify.s |
| test-round | s_lrint.s s_lround.s s_round.s s_rint.s | sf_lrint.s sf_lround.s sf_round.s sf_rint.s |

## Key Design Decisions

1. **Skip test-fma and test-copysign** — no asm overrides exist for these functions.

2. **test-sincos** includes sin+cos asm files so sincos() calls optimized sin/cos underneath (sincos is a C wrapper in hardfloat/ that calls sin/cos).

3. **NaN sign bit normalization**: IEEE 754 doesn't specify NaN sign bit. Both `fff8...` and `7ff8...` are valid quiet NaN. Normalize before diff.

4. **QEMU blank lines**: Semihosting output adds blank lines. Strip before diff.

5. **Final test list** (12 tests): test-sin, test-cos, test-sincos, test-atan, test-exp, test-log, test-pow, test-fabs, test-sqrt, test-fmax-fmin, test-classify, test-round.

## Implementation Steps

1. Update `Makefile` with golden/opt targets and per-test ASM_FILES variables
2. Update `run-all.sh` with QEMU runner loop, blank-line stripping, NaN normalization, diff
3. Remove x86 `ref-bins` target and `HOST_CC` from Makefile
4. Test: build golden and opt for test-fabs (simplest), run both via QEMU, verify diff is empty

## Verification

```sh
cd test/libm-accuracy
make golden-bins opt-bins
./run-all.sh          # runs QEMU for each, diffs outputs
```

Expected: most tests show identical output. Trig functions (sin, cos, sincos) may show 1-ULP differences for some inputs — these are real accuracy differences between toolchain newlib and picolibc's optimized routines.
