---
name: feedback-verify-codegen-with-objdump
description: Verify compiler codegen/scheduling claims with objdump before asserting; barriers and spills do not pin instruction position
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 170e2aea-625a-4764-89fa-e0722f44012b
---

When reasoning about whether the compiler keeps code where it is written
(ROI markers, V-reg spills, hoisting/sinking a kernel out of a measured
window), do NOT assert from first principles. Compile a representative case
and check with `nm` (symbol addresses) + `objdump -d` (instruction
positions) first, and present evidence with real addresses.

**Why:** In this session I confidently claimed that making
`enter_vsim`/`exit_vsim` out-of-line functions would be a "hard barrier"
that pins a vector kernel inside the `csrwi 0x7C0` window. Empirically on
the Andes GCC at -O2/-O3 it did NOT: a function call only forces a register
*spill* of live values; the compute that consumes them (a `vadd.vv`
combine) still drifted into phase 3, AND whole-vector-register spills
(`vs1r.v`/`vl1re32.v`) were added. The wrong claim cost the user several
rounds of bad guidance.

**How to apply:**
- `asm volatile("" ::: "memory")` pins only memory loads/stores, not
  register-only compute. A function call does not pin compute either.
- Only a data dependency pins instruction position:
  `asm volatile("" : "+vr"(v))` forces `v` materialized at that point.
- For ROI cycle attribution the practical rule (verified) is: real kernels
  that read inputs / write outputs through memory inside the ROI, or are
  wrapped in a `noinline` function, stay in the measured window with the
  plain inline `"memory"` markers. Register-carried crossings can drift.
  Decision taken: keep the inline markers, document the limitation in
  `tests/fixtures/runtime/rt_c_helpers.h`.
- Use the fast host build loop in [[reference-hybrid-unit-test-host-build]]
  for unit tests, and the toolchain `nm`/`objdump` (`$HYBRID_TOOLCHAIN/bin/`)
  for fixture codegen checks. Relates to [[feedback-propose-dont-defer]].
