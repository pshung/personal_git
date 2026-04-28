---
name: vmadd.vx fuses vmul+vadd(NN_ROUND) in requantize tail
description: In u8/s8 mat-mul kernel requantize tails, vmadd.vx vd, scale, V_round replaces vmul.vx + vadd.vx(NN_ROUND), saving 3 instrs/cur_row and collapsing a 3-stage RAW chain into 2 stages. Reuse the bias-load reg (V30) as the NN_ROUND broadcast vector.
type: feedback
originSessionId: 3b8ffb78-c49b-483b-a18a-17d1527ab107
---
In libnn mat-mul kernels with the symmetric requantize pattern `acc = max(out_scale * (acc + bias) >> pre_rshift + NN_ROUND, 0) >> post_rshift`, the post-bias requantize tail typically emits:

```
4 vsra.vx  Vi, Vi, pre_rshift
4 vmul.vx  Vi, Vi, out_scale
4 vadd.vx  Vi, Vi, NN_ROUND
4 vmax.vx  Vi, Vi, 0
...
```

This can be fused into:

```
1 vmv.v.x  V30, NN_ROUND        // V30 is dead after the bias add
4 vsra.vx  Vi, Vi, pre_rshift
4 vmadd.vx Vi, out_scale, V30   // Vi = out_scale*Vi + V30
4 vmax.vx  Vi, Vi, 0
...
```

**Wins:**
- -3 instrs/cur_row (8 -> 5)
- 3-stage RAW chain (vsra -> vmul -> vadd) collapses to 2 stages (vsra -> vmadd) — saves ~3 cyc latency on the critical path per cur_row.
- Reuses V30 (bias holder, dead after the bias-add chain), so no extra register pressure.

**Why:** vmadd.vx vd, rs1, vs2 = (rs1 * vd) + vs2. Treating Vi as the multiplicand and V30 (broadcast NN_ROUND) as the addend computes out_scale * pre_rshifted_acc + NN_ROUND in a single instruction.

**How to apply:** Look for the vmul.vx ... + vadd.vx ...(NN_ROUND(...)) pattern in any u8/s8/s16 requantize tail. Confirmed +0.19% (1081 cyc, -2400 instrs) on `conv_HWC_u8_u8_s8_sym_bias_fast` r4 (2026-04-28). Apply ONLY at hot-path sites (unroll4 main loop) — extending to rare paths (M2 tail blocks, single-call non-unroll4 tail kernel) is noise-level (regressed +397 cyc in r5).

**Pre-condition:** A free e32 m1 vector register that's dead by this point. V30 (bias load) typically fits because bias is consumed by the vadd before the requantize chain.
