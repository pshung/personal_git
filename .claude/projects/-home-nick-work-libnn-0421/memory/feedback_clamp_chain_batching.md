---
name: clamp / requantize-tail vmax-vmin chain should be batched, not interleaved
description: In RVV requantize tails with N independent registers each clamped to [act_min, act_max], batch all N vmax_vx then all N vmin_vx instead of alternating per-register. The 4-instr gap hides the 3-4 cyc VALU latency that the alternating order serializes.
type: feedback
originSessionId: c5543f22-1bda-47c4-a76e-d6e3930611f2
---
Pattern: a requantize-tail operates on N independent accumulator vectors and clamps each to `[act_min, act_max]` via `vmax_vx` + `vmin_vx`. The natural-looking emission is per-register interleaved:

    vmax V4, V4, act_min
    vmin V4, V4, act_max     # 1-instr gap from the vmax that wrote V4 -> ~2 cyc RAW stall
    vmax V6, V6, act_min
    vmin V6, V6, act_max
    ...

This serializes on every register because vmin Vk depends on vmax Vk. AX45MPV VALU latency at e32 m1 is ~3-4 cyc, hides nothing at a 1-instr gap.

Batched form:

    vmax V4, V4, act_min
    vmax V6, V6, act_min
    vmax V8, V8, act_min
    vmax V10, V10, act_min
    vmin V4, V4, act_max     # 4-instr gap from vmax V4 -> latency hidden
    vmin V6, V6, act_max
    ...

**Why:** measured win in `nn_mat_mult_kernel_s8_offset_unroll4` round 6: +0.64% (combined with one vsetvli merge), against a predicted ~0.06% from cycle-counting alone. The actual win exceeded the local-stall estimate, suggesting the batched form also lets the compiler/scheduler dual-issue some VMAX/VMIN with adjacent VALU ops (the alternating form blocks this).

**How to apply:** any time you see a clamp-to-range emitted as alternating max/min per register in an RVV tail, reorder to all-max-then-all-min. Same logic applies to any 2-op-per-register chain where the second op depends on the first (e.g., vadd-then-vmax, vrsub-then-vsra). Cheap, zero-risk. Estimate `N x VALU_latency` cycles saved per occurrence per call.
