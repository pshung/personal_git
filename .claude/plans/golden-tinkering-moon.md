# Plan: Annotate sf_sin.s with GoFast Algorithm Comments

## Context

`sf_sin.s` implements `sinf()` using the GoFast soft-float library's algorithm. The code is uncommented assembly that's hard to follow without understanding the fixed-point representation and polynomial evaluation scheme. The goal is to add inline comments explaining each section.

## Algorithm Summary

The GoFast `sinf` uses:
1. **Unpacked fixed-point representation**: mantissa in one register (MSB = implicit 1, normalized), biased exponent in another register (bias 127 for float)
2. **Argument reduction** via `__gf_fpreduct`: divides input by pi/2, returns reduced mantissa (x10), exponent (x11), and quadrant count (x12)
3. **Quadrant dispatch**: selects sin or cos polynomial based on `(quadrant-1) & 2`
4. **Horner-scheme polynomial evaluation** on r^2 with alternating signs, using sentinel-terminated coefficient tables
5. **IEEE 754 reassembly**: strips implicit leading 1, positions mantissa and exponent fields, ORs in sign bit

## Approach

Add block comments and inline comments to `sf_sin.s` after each logical section of assembly. Comments go after the code they describe, as requested.

### Key sections to annotate:
- **Lines 9-14**: Prologue (stack frame, save callee-saved registers, save input)
- **Lines 15-18**: Call argument reduction, move results to working registers
- **Lines 19-22**: Tiny-argument early exit (fpreduct returned exponent < 0)
- **Lines 24-27**: Compute result sign from quadrant and input sign
- **Lines 28-36**: Compute r^2 = mulhu(mantissa, mantissa), right-shift by 2*(127-exp) to align
- **Lines 37-39**: Quadrant dispatch: `(q-1) & 2` selects sin vs cos path
- **Lines 40-55**: Sin polynomial path (Horner loop on __gf_fpsincof, then multiply by r)
- **Lines 56-66**: Cos polynomial path (Horner loop on __gf_fpcoscof, set exp=127)
- **Lines 67-76**: IEEE 754 float reassembly (normalize, strip leading 1, pack fields)
- **Lines 77-83**: Epilogue (restore registers, return)

### File to modify
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/sf_sin.s`

## Verification

- `make test-sinf` - confirm assembly still assembles and passes accuracy tests
- Visual review of comments for correctness
