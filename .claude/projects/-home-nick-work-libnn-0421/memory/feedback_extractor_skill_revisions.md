---
name: hot-inner-kernel-extractor revisions from cross-function testing
description: Three failure modes surfaced when running the extractor on conv_HWC_u8_u8_s8_sym_bias_fast (vsim target). The fixes are landed; this captures *why* so future skill changes don't regress them.
type: feedback
originSessionId: b4f5b9f7-fb07-4972-8cec-a175472fb595
---
When exercising hot-inner-kernel-extractor on additional libnn functions,
three issues surfaced that needed skill changes. Fixes already applied to
emit_harness.py + extract_kernel.sh + run_kernel_vsim.sh.

**Why:** The original skill was developed against a single conv kernel
(`conv_HWC_s8_s8_s8_sym_bias_fast`). Running it on its u8 sibling and
likely other functions exposed three brittleness spots:

1. **FN with vs without `riscv_nn_` prefix.** extract_kernel.sh stripped
   the prefix to find the test (`t_<short>.c`) but passed FN verbatim
   to find_hot_loop.py for objdump-symbol lookup. Symbol always has
   `riscv_nn_` prefix so bare-name calls failed at step 4. Fixed by
   normalizing both forms: SHORT (no prefix) for filename, FULL_FN
   (with prefix) for objdump.

2. **Andes vendor branch instructions.** `nds.bbs` / `nds.bbc` /
   `nds.beqc` / `nds.bnec` were missing from BRANCH_MNEMONICS in
   emit_harness.py. Their operands carry an objdump `<sym+0xN>`
   annotation that GAS rejects, AND any out-of-loop target wasn't
   rewritten to _oob_exit. Symptom: GAS error "invalid operands
   (*ABS* and *UND* sections) for `<'". Fixed by adding the four
   conditional-branch mnemonics to BRANCH_MNEMONICS.

3. **Live-in init short-circuits the loop body.** The heuristic gave
   ALL unknown pointer-shaped scalars `la <reg>, scratch_in`, so any
   `bge sX, sY` / `beq sX, sY` between two such regs trivially fires
   and exits the body via _oob_exit. Symptom: cyc/iter <<<
   body_inst_count, but harness reports "RESULT: PASS" because the
   counter still ticked. Fixed two ways: (a) distinct +64*i offsets
   per pointer in emit_live_in_init AND emit_live_in_reset; (b) a
   sanity check in run_kernel_vsim.sh that flags
   `avg_insn_per_iter < body_size/4` with a warning telling the user
   to splice values from analysis.md's verbatim prologue.

**How to apply:**
- When adding new libnn functions to the skill's test set, look for
  these classes of failure first.
- If a kernel has multi-stage computed bounds checks (e.g.
  `mulw t1,a4,a5; subw t1,t1,s9; bge a0,t1,exit`), no scalar-init
  heuristic will satisfy them. The user MUST hand-edit init values
  using the verbatim prologue from analysis.md, or fall back to the
  full FPGA perf test. The warning in run_kernel_vsim.sh is the
  detection mechanism -- don't trust a "PASS" alongside it.
- If you see Andes-vendor instructions other than the four already
  added (e.g. `nds.lea.h`, `nds.vd4dots.vv`), check whether they're
  branches/jumps -- only branches need to be in BRANCH_MNEMONICS;
  arithmetic insns pass through verbatim and that's correct.
