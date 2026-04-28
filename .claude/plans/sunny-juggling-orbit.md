# Port-Aware Reschedule of nn_mat_mul_kernel_q7_bias_2sft Requantize Tail

## Context

Round 1-3 on `conv_HWC_s8_s8_s8_sym_bias_fast` netted only 1.0062x (528,241 -> 524,971), well below the u8/s8/s8 sibling's 1.0082x and below the user's expectation. Root cause: the prior rounds applied chaining-style optimizations (vmadd fusion, VMV hoist, VSRA+VMADD interleave) without consulting `docs/wiki/general/ax45mpv-vpu-uarch-spec.md`'s VRF port tables.

After re-reading the uarch spec, the dominant inefficiency in the unroll4 requantize tail is **not** chaining latency -- it is **VRF port contention and FU underutilization**:

- The 12-instruction `vslideup` chain (VPERMUT FU) runs ~24 cycles with VLSU/VALU/VMAC FUs all idle, even though `vle32` for bias and `vmv.v.x` for NN_ROUND are CLEAN dual-issue partners (different read ports, different write ports).
- The current r3-style `vsra` + `vmadd` interleave is a **VALU+VMAC pair, which shares read ports 0-2 (3-way conflict per DS 23.15.2)**. The chain forwarding does net a small win, but each adjacent pair pays a VSCB bubble.
- `vnclip.wi` (VALU, write port 0) is followed immediately by `vsb` (VLSU, write port 0) -- write-port-0 conflict, ~1 bubble per store.

This plan executes a 3-round port-aware reschedule of the q7-only kernel's requantize tail (both byte-identical copies in `nn_mat_mul_kernel_q7_bias_2sft.c`), targeting CLEAN dual-issue pairs identified in the spec.

## Approach

Run as a fresh `/optimize conv_HWC_s8_s8_s8_sym_bias_fast` session starting from the current 524,971 baseline (post-r1/r2/r3). Each round is independently revertable via `refs/optimize-ckpt/<fn>/round-N-pre`.

### Round 1: Hoist bias `vle32` into the slideup chain

**Pair sought:** VPERMUT + VLSU (clean -- VPERMUT read 9-10/write 3, VLSU read 4-5/write 0; VLSU as 2nd slot satisfies DS 23.15.1 restriction 3).

**Edit:** In both tail copies (~lines 491-533 and ~1112-1149), move `NDS_VEC_VLW_V(V30, bias)` from just-above the 4 `VADD_VV` group to **after the first `vslideup` instruction** in the 12-slideup chain. Update bias pointer increment to match.

**Why:** Cacheable bias load latency is `4 + VLSU_MEM_LATENCY` (12-14 cyc per spec table). VPERMUT-occupied slideup chain (~24 cyc total) fully hides this. VADD_VV consumers of V30 still see V30 ready by the time the 4-VADD group dispatches.

**Expected gain:** +0.3-0.6% (hides full load latency that previously serialized into VADD critical path).

**Risk:** VLSU + VALU shares write port 0; if any VALU is dispatched in the same cycle as the hoisted VLW it'll add a bubble. Mitigated by placing it among VPERMUTs (write port 3, not 0).

### Round 2: Hoist `vmv.v.x V30,NN_ROUND` further up into slideup chain

**Pair sought:** VPERMUT + VALU (clean -- VPERMUT read 9-10/write 3, VALU read 0-2/write 0; no overlap).

**Edit:** Move the existing `NDS_VEC_VMV_V_X(V30, NN_ROUND(...))` (currently above the 4 VSRA group from r2) up into the **mid-slideup region**, after the bias VLW but before the last 6 slideups. Note: requires renaming the NN_ROUND broadcast register since V30 is the bias-add target -- use V29 for NN_ROUND, free V30 for bias as before.

**Why:** Currently the VMV serializes ahead of the VSRA group (both VALU, same-FU). Moving it into the VPERMUT region lets it dual-issue with a slideup, freeing 1 VALU slot in the post-bias region.

**Expected gain:** +0.1-0.2%.

**Risk:** Register pressure -- need to confirm V29 is dead in the active branch (preprocess `.i` and grep). If not, pick a different free register.

### Round 3: Insert scalar pointer arithmetic between VNCLIP and VSB

**Pair sought:** scalar + VLSU (always clean -- scalar uses no VRF ports).

**Edit:** Move the `out += vl`, `pOut2 += vl`, `pOut3 += vl`, `pOut4 += vl` scalar increments from after the VSB group to **between the 4 VNCLIP and 4 VSB**. One increment paired with each store.

**Why:** Currently VNCLIP (VALU, write 0) -> VSB (VLSU, write 0) is a write-port-0 conflict (~1 bubble per store; 4 bubbles total). Inserting scalar increments breaks the pair.

**Expected gain:** +0.1-0.3%.

**Risk:** None significant -- scalar+vector is the safest dual-issue pair per spec.

### Rounds NOT pursued (deferred or rejected)

- **Un-interleaving r3's VSRA+VMADD pattern:** Spec says VALU+VMAC is BAD-READ. But r3 measured a positive (+0.04% here, +0.27% on sibling). Net: chain forwarding > VSCB bubble. **Leave as-is.**
- **VMAC+VLSU pairing for next-tile bias prefetch:** Would require restructuring the outer loop, not just the tail. Out of scope.
- **VPERMUT throughput optimization (LMUL split for slideups):** Spec doesn't list slideup throughput; empirically already saturated per memory `feedback_lmul_partial_vl_throughput.md`. Not pursued.

## Critical Files

- `/home/nick/work/libnn_0421/Source/NNSupportFunctions/nn_mat_mul_kernel_q7_bias_2sft.c`
  - Active branch: `#elif defined(ENA_NDS_V5_VEC_DOT_PROD)` (non-intrinsic)
  - **Two byte-identical tail copies** -- use `Edit` with `replace_all=true` per memory `feedback_q7_kernel_sibling_port.md`
  - Tail 1: 4-row main, ~lines 491-533 post-r3
  - Tail 2: fast-path 4-acc, ~lines 1112-1149 post-r3
- `/home/nick/work/libnn_0421/.claude/skills/optimize/state.json` -- reset to idle, then re-init for `conv_HWC_s8_s8_s8_sym_bias_fast`
- `/home/nick/work/libnn_0421/ROADMAP.md` -- row 4 already marked `[x]`; update `uarch_Opt_cycle` and `uarch_speedup` columns after each successful round

## Reused Functions / Utilities

- `${SCRIPT_DIR}/rebuild_single.sh` -- single-file recompile (~0.6s) for verify cycle
- `${SCRIPT_DIR}/rebuild_single.sh -E` -- preprocess to confirm active branch and check register liveness
- `${SCRIPT_DIR}/run_qemu_test.sh conv_HWC_s8_s8_s8_sym_bias_fast` -- correctness gate (catches VNCLIP-style accuracy regressions)
- `${SCRIPT_DIR}/run_fpga_test.sh conv_HWC_s8_s8_s8_sym_bias_fast` -- FPGA cycle measurement (ground truth)
- `${SCRIPT_DIR}/emit_trace.sh` -- per-step trace emission (analyze/implement/verify/measure/learn)
- Per-round git checkpoint pattern: `refs/optimize-ckpt/conv_HWC_s8_s8_s8_sym_bias_fast/round-N-pre` for revert

## Verification Plan

End-to-end per round:

1. **Compile check:** `rebuild_single.sh Source/NNSupportFunctions/nn_mat_mul_kernel_q7_bias_2sft.c` -- exit 0, no warnings.
2. **Correctness:** `run_qemu_test.sh conv_HWC_s8_s8_s8_sym_bias_fast --strace --vlen 1024` -- accuracy PASS.
3. **Performance:** `run_fpga_test.sh conv_HWC_s8_s8_s8_sym_bias_fast` -- cycle count delta vs prior round.
4. **Sibling regression check (final):** confirm `conv_HWC_s8_s8_s8_sym_fast` (no-bias variant, ROADMAP row 9) still passes -- it links the same kernel and inherits any tail edits.

Pass criteria for the full plan: cumulative speedup over current 524,971 baseline >= 1.005x (i.e., <= 522,360 cyc) with all rounds clean. Stop early at any round that regresses or fails accuracy; revert via the round's `-pre` checkpoint.

## Memory Updates

After completion, update `feedback_q7_kernel_sibling_port.md` to record port-aware reordering as the post-chaining optimization tier, including the specific clean-pair recipes (VPERMUT+VLSU bias hoist, VPERMUT+VALU NN_ROUND hoist, scalar+VLSU store decoupling).
