---
name: AX45MPV vd4dots throughput
description: vd4dots on AX45MPV issues at 1 instr/cycle (fully pipelined); multi-cycle VW tail is latency only
type: project
originSessionId: 78480fd0-4e9c-468e-9001-7197924fb96c
---
On the AX45MPV VPU (VLEN=DLEN=1024), `vd4dots` throughput is **1 instruction per cycle** (fully pipelined). The "~4-8 cycles VW sub-stage spacing" noted in `docs/wiki/general/ax45mpv-pipeline.md` and `.claude/skills/optimize/references/uarch/andes_45_series.md` describes the writeback latency tail, NOT the issue rate.

**Why:** Confirmed by the uarch owner (user) on 2026-04-24 in response to my two-model roofline presentation. My conservative "32 multiplier lanes -> 4 cyc/issue" model was wrong.

**How to apply:**
- Peak int8 MAC at M1 = 128 MAC/cycle (32 int32 output lanes x 4 byte-pairs). At 60 MHz -> 7.68 GMAC/s peak.
- When judging whether a vd4dots-heavy kernel is "near peak", use 1/cyc throughput, not 1/(VW-depth).
- IPC targets in [[ipc-vs-throughput]] (0.45-0.70 for compute-bound GEMM) are already calibrated for this throughput model.
- Back-to-back independent vd4dots (no RAW dependency) should issue every cycle. If measurement shows slower, it's scheduler stalls (operand RAW, dual-issue conflict, VLSU contention), not instruction throughput.
- Consider updating `docs/wiki/general/ax45mpv-pipeline.md` to clarify that VW spacing != issue rate if this wording continues to mislead.
