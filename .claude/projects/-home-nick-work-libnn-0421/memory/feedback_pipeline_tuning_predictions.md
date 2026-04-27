---
name: pipeline-tuning page over-predicts SW-pipe gain
description: V1024_8MB pipeline-tuning math gives the inner-loop ceiling, not the function ceiling
type: feedback
originSessionId: c5543f22-1bda-47c4-a76e-d6e3930611f2
---
When the AX45MPV V1024_8MB pipeline-tuning page predicts an X% improvement from a SW-pipeline / dual-issue change, that X% applies to the INNER LOOP cycles, not to the whole function. Always weight the prediction by the inner loop's share of total cycles.

**Why:** Empirically tested on `conv_HWC_s8_s8_s8_asym_bias_any` (round 1, 2026-04-27). Inner loop predicted 35 -> 19 cyc (1.84x), but inner loop was only ~10-19% of total function cycles -- net measured speedup was only 1.026x, not the 1.10-1.13x the page implied.

**How to apply:** Before committing time to a SW-pipe round, estimate inner-loop cycle share from instr counts in objdump. If inner loop < 25% of total, the architectural floor (vredsum chains, function-call overhead, im2col copies) will dominate. Don't promise > inner_share x predicted_inner_speedup as the net.

**Corollary:** vsetvli removal saves instruction count but often zero cycles when the eliminated vsetvli was issuing in a free dual-issue slot. IPC and instr-count are misleading; only cycle count matters. Cross-link [[ipc-vs-throughput]].
