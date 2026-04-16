---
name: i8 widening v_inner uses input SEW not accumulator SEW
description: For i8-to-i32 widening ops, v_inner = VLEN/SEW_input (SEW=8), not VLEN/32 (accumulator width)
type: feedback
---

i8-to-i32 widening tiers must use input element width (SEW=8) for v_inner calculation:
- MF4: VLEN/8 * 1/4 = 32 (not 8)
- MF2: VLEN/8 * 1/2 = 64 (not 16)
- LMUL1: VLEN/8 * 1 = 128 (not 32)
- LMUL2: VLEN/8 * 2 = 256 (not 64)

This was incorrectly using VLEN/32 (i32 accumulator width) which gave 4x too small v_inner values.
The regression test `test_i8_widening_v_inner_uses_input_sew` guards against this.
