---
name: LMUL is irrelevant when VL < VLMAX_m1
description: V1024_8MB VLSU 2*EMUL throughput formula is worst-case VL=VLMAX; for partial-VL transfers m1==m4==m8 in cycles
type: feedback
originSessionId: c5543f22-1bda-47c4-a76e-d6e3930611f2
---
On AX45MPV V1024_8MB, the pipeline-tuning page's unit-stride load throughput formula `(VLEN/VLSU_MEM_DW)*EMUL = 2*EMUL` cycles/instruction applies ONLY at VL=VLMAX. For partial-VL transfers (e.g. vl=64 elements < VLMAX_m1=128), actual throughput is data-movement-limited at one BIU beat (64 B/cyc per request) and m1, m4, m8 produce identical cycle counts.

**Why:** Empirically tested on `conv_HWC_s8_s8_s8_asym_bias_any` (round 1, 2026-04-27, fresh session). Trimmed `nn_dup_s8` from m8 to m4 (size=192) and m1 (size=64). Predicted 5-7% from formula; actual was +28 cyc (FPGA noise). objdump confirmed `vsetvli e8,m1` and `vsetvli e8,m4` did emit -- the LMUL propagated but didn't cost different cycles.

**How to apply:**
- Before optimizing LMUL of any short VLSU transfer, check: is `size * sew_bytes` >= `VLMAX_m1 * sew_bytes` (= 128 B at e8 m1)? If no, LMUL change is a no-op.
- For dup/copy helpers with `size <= 256`, prefer m1 anyway because it leaves more reg groups free and never wastes -- but don't expect FPGA cycles to move.
- The formula `2*EMUL` is the THROUGHPUT CEILING the VLSU FU enforces when VL=VLMAX. Below that, the BIU rate (64 B/cyc) governs.

Cross-link [[ipc-vs-throughput]].
