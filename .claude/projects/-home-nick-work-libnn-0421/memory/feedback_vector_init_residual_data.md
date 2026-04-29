---
name: Vector live-in init affects steady-state cycles on AX45MPV
description: Skipping vector live-in init in hot-inner-kernel-extractor harnesses slowed conv kernel by 53 cyc/iter (170->223). Don't strip "for free" prologue work without measuring.
type: feedback
originSessionId: b4f5b9f7-fb07-4972-8cec-a175472fb595
---
In the hot-inner-kernel-extractor skill (work/<fn>/kernel.s), removing the
vector live-in initialization block (zero v0..v15, vle8 v16..v31 from
scratch_in) slowed `riscv_nn_conv_HWC_s8_s8_s8_asym_bias_any` steady-state
from 170 cyc/iter to 223 cyc/iter (+31%). Inst count dropped by 26 as
expected, but cycles went UP because every measured iter was slower, not
just iter-1 startup.

Why: the warmup call leaves residual data in v24..v31 (last batch loaded
by body's vle8 chain). Without re-init, the measured call's first
software-pipelined iter feeds those residuals into `nds.vd4dots.vv vd, v24,
v28`. AX45MPV's vd4dots issue timing is apparently NOT fully
data-independent for this operand pattern, OR the vector regfile read
ports gate differently based on prior write history.

**Why:** I assumed AX45MPV's integer vector pipeline (vd4dots/vmacc/vsra)
was data-independent, so vector init looked like dead weight worth ~26
inst/call. Empirical measurement said the opposite.

**How to apply:** When extracting a kernel for cycle measurement, leave
vector init ON. The skill's `--no-vector-init` flag exists but should not
be used as an "optimization" without re-measuring. The init's value isn't
the *vl/vtype* state (the body's own vsetvli overrides it) -- it's
forcing every vector reg through a deterministic write before measurement
starts.
