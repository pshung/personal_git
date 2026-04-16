# Plan: Revise all test files to match test_sinf.c quality

## Context

test_sinf.c is the reference template with 8 comprehensive test categories and ~400 test points. All other test files created in the previous session are missing key sections and have fewer test points.

Two classes of files need revision:

1. **Flat-style single-precision files** (test_cosf.c, test_expf.c, etc.) - compact style in `main()`, no named test functions, missing sNaN/-NaN, hard cases, exhaustive ULP sweep
2. **Structured double-precision files** (test_sin.c, test_exp.c, etc.) - have named functions but missing: sNaN/-NaN, mid-denorm, test_hard, test_exhaustive_small, sweep only 100 steps

Reference file: `/home/nick/work/picolibc_agentic/libm/machine/riscv/test/test_sinf.c`

## Required Structure (8 sections from test_sinf.c)

```c
test_special()      // zeros, qNaN, sNaN, -NaN, ±Inf
test_tiny()         // min/mid/max denorm ±, FLT/DBL_MIN ±, 1e-10 ±
test_known()        // function-specific mathematical constants
test_large()        // 10, 100, ..., 1e20, ±FLT/DBL_MAX
test_quadrant()     // boundary conditions (k * period ± epsilon)
test_hard()         // worst-case bit patterns for each function
test_sweep()        // 200 steps over main domain (both directions)
test_exhaustive_small() // ULP-level step over critical region
```

## NaN/special bit patterns

**Single precision:**
- qNaN: `0x7fc00000u`
- sNaN: `0x7f800001u`
- -NaN: `0xffc00000u`
- +Inf: `0x7f800000u`
- -Inf: `0xff800000u`
- min denorm: `0x00000001u` / `0x80000001u`
- mid denorm: `0x00400000u` / `0x80400000u`
- max denorm: `0x007fffffu` / `0x807fffffu`

**Double precision:**
- qNaN: `0x7ff8000000000000ULL`
- sNaN: `0x7ff0000000000001ULL`
- -NaN: `0xfff8000000000000ULL`
- +Inf: `0x7ff0000000000000ULL`
- -Inf: `0xfff0000000000000ULL`
- min denorm: `0x0000000000000001ULL` / `0x8000000000000001ULL`
- mid denorm: `0x0008000000000000ULL` / `0x8008000000000000ULL`
- max denorm: `0x000fffffffffffffULL` / `0x800fffffffffffffULL`

## File Groups and Function-Specific Test Content

### Group 1: Single-precision trig (restructure flat → 8-section)
- test_cosf.c, test_tanf.c
- test_asinf.c, test_acosf.c, test_atanf.c, test_atan2f.c

Hard cases for sin/cos/tan: pi/2pi bit patterns `0x40490fdbu`, `0x40c90fdbu`, `0x4096cbe4u`, powers 4/16/64/256
Exhaustive: [0, pi/4] every 4194304 ULP (same as sinf)
Sweep: [-4*pi, 4*pi] 200 steps

For asin/acos: domain [-1,1], hard cases near ±1.0, exhaustive [-1,1] every 65536 ULP
For atan: all reals, hard cases near inflection points, exhaustive [-pi/4, pi/4]
For atan2: quadrant boundaries with test_quadrant showing all 4 quadrants + axes

### Group 2: Single-precision exp/log (restructure flat → 8-section)
- test_expf.c, test_logf.c, test_log10f.c

exp hard cases: near overflow (`0x42d4e000u` ~ 105.375), underflow (`0xc2d40000u`), ln(2) bit pattern
exp exhaustive: [0, 1] every 4194304 ULP
log hard cases: near 1.0 (where log is small), powers of 2
log exhaustive: [1, 2] every 4194304 ULP (critical region)

### Group 3: Single-precision hyperbolic
- test_sinhf.c, test_coshf.c, test_tanhf.c, test_asinhf.c

Hard cases: overflow threshold ~88.7 for sinhf/coshf, tanh saturation near ±4
Exhaustive: [-1, 1] for tanh, [0, 1] for sinh

### Group 4: Single-precision misc
- test_sqrtf.c, test_cbrtf.c, test_powf.c
- test_ceilf.c, test_floorf.c
- test_frexpf.c, test_ldexpf.c, test_modff.c, test_fmodf.c
- test_fabsf.c, test_fpclassifyf.c

sqrt: Pythagorean values (3/4/5, 5/12/13), exhaustive [0, 4]
cbrt: cubes of small integers, exhaustive [0, 1]
ceil/floor: integer boundaries ±0.5, ±1.5, etc., exhaustive [0, 10]
fmod: various divisors, special cases

### Group 5: Double-precision trig
- test_sin.c, test_cos.c, test_tan.c
- test_asin.c, test_acos.c, test_atan.c

Add to existing structure:
- sNaN and -NaN to test_special
- mid denorm to test_tiny
- test_hard with pi bit patterns: `0x400921FB54442D18ULL`, `0x401921FB54442D18ULL`
- test_exhaustive_small: [0, pi/4] every 4503599627370496 ULP (2^52 / 1024)
- Increase sweep to 200 steps

### Group 6: Double-precision exp/log
- test_exp.c, test_log.c, test_log10.c, test_expm1.c, test_log1p.c

Add: sNaN/-NaN, subnormals, test_hard, test_exhaustive_small, sweep
exp hard: `0x40862E42FEFA39EULL` (ln(2)*128), near overflow 709, underflow -745
log hard: powers of 2 bit patterns, near 1.0
expm1: near 0 critical, test_hard with values near where expm1(x) ≈ x

### Group 7: Double-precision hyperbolic
- test_sinh.c, test_cosh.c, test_tanh.c

Add: sNaN/-NaN, test_hard, test_exhaustive_small

### Group 8: Double-precision rounding
- test_ceil.c, test_floor.c, test_trunc.c, test_round.c, test_rint.c
- test_lrint.c, test_lround.c
- test_fmod.c, test_remainder.c, test_remquo.c
- test_modf.c, test_frexp.c, test_ldexp.c
- test_ilogb.c, test_nextafter.c, test_fpclassify.c
- test_fmax.c, test_fmin.c, test_fabs.c

Rounding hard cases: 0.5 exactly, n+0.5 for various n, large integers
exhaustive: [0, 10] for rounding functions
ilogb: powers of 2 and odd multiples

### Group 9: Double-precision special
- test_sqrt.c, test_pow.c, test_hypot.c
- test_erf.c, test_erfc.c, test_lgamma.c
- test_acosh.c, test_atanh.c

### Group 10: Bessel functions
- test_j0.c, test_j1.c, test_jn.c, test_y0.c, test_y1.c, test_yn.c

Hard cases: zeros of each Bessel function (known values)
Large arguments: up to 100
Note: y-functions only defined for x > 0

## Execution Strategy

Revise files in parallel using 3 agents, each handling 2 groups at a time:
- Agent A: Groups 1+2 (sf_ trig, sf_ exp/log)
- Agent B: Groups 3+4 (sf_ hyperbolic, sf_ misc)
- Agent C: Groups 5+6 (double trig, double exp/log)
- Then: Groups 7+8, Groups 9+10

Each agent: read existing file, write complete replacement matching test_sinf.c structure.

## Critical Files

- Reference: `/home/nick/work/picolibc_agentic/libm/machine/riscv/test/test_sinf.c`
- All other test files in same directory

## Verification

After revision, spot-check a few files to confirm:
1. test_special has 7 entries (zeros, 3 NaN variants, 2 Inf)
2. test_tiny has 10+ entries including denorm variants
3. test_hard exists and has function-specific cases
4. test_exhaustive_small exists with ULP-level loop
5. test_sweep uses 200 steps
