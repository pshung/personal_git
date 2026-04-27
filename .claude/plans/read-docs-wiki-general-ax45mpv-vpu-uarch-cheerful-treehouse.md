# Plan: AX45MPV V1024_8MB Pipeline Tuning Reference Page

## Context

The wiki currently has one VPU pipeline reference: `docs/wiki/general/ax45mpv-vpu-uarch-spec.md`. That page is a faithful transcription of the data-sheet (DS 1.5.2 / 23.15) and uses parametric formulas in `VLEN`, `DLEN`, `VLSU_MEM_DW`. Its worked example assumes `VLEN=1024 / DLEN=512`, which is **not** the silicon we ship.

The actual config the optimize loop targets is fully described in `.claude/skills/optimize/fpga_config/ax45mpv_v1024_8mb.inc`. Resolving the spec formulas with these values gives concrete cycles/throughput numbers that are materially different from the spec's example column -- e.g. `(VLEN/DLEN)*LMUL = 1*LMUL` instead of `2*LMUL`, vd4dots at m1 is a 1-cycle-issue instruction, vqmacc at m1 is 4, and the in-flight VLSU data cap is 2 KB.

We need a single LLM-agent-facing reference that:
- Resolves every formula in the spec page against the real V1024_8MB config.
- Lists the tuning rules that follow from those concrete numbers (LMUL choice, dual-issue pairings, SW-pipeline budget, prefetch budget, memory-bound ceiling).
- Stays explicitly subordinate to the spec page and the PDF -- it is a reference summary, not a new source of truth.

The goal is faster, more grounded `select`/`analyze` decisions in the optimize skill: the agent reads one page that already has the arithmetic done, instead of re-deriving formulas every round.

## Scope

One new page plus one index entry. No code, no skill changes.

## Files to Create / Modify

1. **Create** `/home/nick/work/libnn_0421/docs/wiki/general/ax45mpv-v1024-8mb-pipeline-tuning.md`
2. **Modify** `/home/nick/work/libnn_0421/docs/wiki/index.md` -- add one bullet under `### Pipeline and Throughput` (after line 31, between the spec page and `[[ipc-vs-throughput]]`).

## Source Inputs (read-only, ground truth)

- `/home/nick/work/libnn_0421/docs/wiki/general/ax45mpv-vpu-uarch-spec.md` -- parametric formulas, dual-issue rules, VRF port table, chaining model.
- `/home/nick/work/libnn_0421/.claude/skills/optimize/fpga_config/ax45mpv_v1024_8mb.inc` -- silicon config to resolve the formulas against.
- `AndesCore_AX45MPV_DS220_V1.4.pdf` -- ultimate authority; cite by section, do not duplicate.

Concrete config values to lift into the new page (verified from the .inc):

| Param | Value |
|---|---|
| `NDS_VLEN` | 1024 |
| `NDS_DLEN` | 1024 |
| `NDS_VPERMUT_DLEN` | 1024 |
| `NDS_ELEN` | 64 |
| `NDS_VRF_MUX` | 2 |
| `NDS_VSCB_DEPTH` | 16 |
| `NDS_VLSU_MSHR_DEPTH` | 16 (max in-flight VLSU requests) |
| `NDS_VLSU_BUF_DEPTH` | 16 entries x VLEN bits = 2 KB in-flight load data |
| `NDS_VMAC2_TYPE` | 3 (VMAC2 present) |
| `NDS_QMAC_SUPPORT` | yes (vqmacc available) |
| `NDS_VECTOR_VDOT_SUPPORT` | yes (vd4dots available) |
| `NDS_INT4_VECTOR_LOAD_SUPPORT` | yes |
| `NDS_BFLOAT16_SUPPORT` / `ZVFBFMIN` / `ZVFBFWMA` | yes |
| `NDS_HVM_SIZE_KB` | 0 (no HVM region; all loads via D-cache/L2) |
| `NDS_BIU_DATA_WIDTH` | 512 -> `VLSU_MEM_DW = 512` for cacheable/non-cacheable |
| `NDS_L2_DATA_WIDTH` / `NDS_L2C_DATA_RAM_DW` | 512 |
| `NDS_L2C_CACHE_SIZE_KB` | 8192 (8 MB) |
| `NDS_L2C_WAY` | 16 |
| `NDS_L2C_BANKS` | 2 |
| `NDS_L2C_TAG_RAM_SETUP_CYCLE` / `DATA_RAM_SETUP_CYCLE` / `DATA_RAM_OUTPUT_CYCLE` | 1 / 2 / 2 |
| `NDS_DCACHE_SIZE_KB` / `WAY` / `DATA_RAM_DW` | 32 / 4 / 64 |
| `NDS_ICACHE_SIZE_KB` / `WAY` | 32 / 2 |
| `NDS_CACHE_LINE_SIZE` | 64 B |
| `NDS_LSU_MSHR_DEPTH` | 32 (scalar LSU, separate from VLSU) |
| `NDS_DSP_SUPPORT` / `NDS_ACE_SUPPORT` | no |

Derived quantities (these are what the new page exists to tabulate):

- Throughput at LMUL=k: `(VLEN/DLEN)*k = k` cycles/instr for VALU/VMAC class.
- vd4dots m1 = 1 cyc issue, latency 4. vqmacc m1 = 4 cyc issue, latency 4 (4x VMAC occupancy).
- vredsum at e8 LMUL=k: `k + LOG2(16)*2 + LOG2(8) = k + 11` cycles. Fixed +11 overhead per reduction.
- Unit-stride load: `(VLEN/VLSU_MEM_DW)*EMUL = 2*EMUL` cyc throughput; latency `4 + 12..14` (D$ hit / L2 hit) up to `4 + 25` (shareable Modified). HVM=0 so the 3-cycle HVM path is unavailable.
- VLSU in-flight cap: 16 buf entries x 128 B/entry = **2 KB**. At BIU 64 B/cyc, that is 32 cycles of in-flight data -- enough for one L2-hit miss (~14 cyc), not for stacked misses.
- L2 peak bandwidth ceiling: 512 bit/cyc = **64 B/cyc**. Memory-bound declaration threshold (per existing wiki convention): bytes/cyc within ~15% of 64 B.
- e8 VL_max at m8 = 1024 elements -> exactly four reg groups (v0/v8/v16/v24). No spare group for SW-pipeline next-iter loads. Documented in `[[anti-sw-pipeline-same-reg-group]]`; the new page just cross-links.
- VPERMUT_DLEN = DLEN -> permutes are not slower than VALU on this config (relevant for transpose/im2col).

## Page Structure

Filename: `ax45mpv-v1024-8mb-pipeline-tuning.md` (slug matches index link target).

Frontmatter (mirrors `ipc-vs-throughput.md` / `ax45mpv-vpu-uarch-spec.md`):

```yaml
---
type: pipeline-insight
tags: [ax45mpv, v1024, 8mb, pipeline, tuning, lmul, vlsu, dual-issue, dlen]
source: .claude/skills/optimize/fpga_config/ax45mpv_v1024_8mb.inc
ground_truth: ax45mpv-vpu-uarch-spec, AndesCore_AX45MPV_DS220_V1.4.pdf
---
```

Sections (each section just resolves the spec's parametric formula and states the tuning rule that follows):

1. **# AX45MPV V1024_8MB Pipeline Tuning Reference** -- one-paragraph scope statement: this is a derived summary, ground truth is `[[ax45mpv-vpu-uarch-spec]]` and the DS PDF.
2. **## Resolved Configuration** -- the param table above.
3. **## Throughput / Latency Resolved at This Config** -- one row per instruction class (VALU, VMAC int, vd4dots, vqmacc, VFMIS, vredsum, unit-stride load, unit-stride store, strided, indexed). Two columns: the spec's formula -> the resolved cycles for this silicon.
4. **## VLSU Budget** -- 16 MSHR / 16 buf / 2 KB in-flight / 64 B/cyc L2 ceiling / no HVM. State: "if a kernel needs more than ~32 cycles of latency hiding past one issued load, prefetch is required."
5. **## LMUL Selection at DLEN=1024** -- because DLEN==VLEN, m1 already issues in 1 cycle. Rule: prefer m1 for vd4dots (8 free accumulator groups, 4-element register block). m4 only when load count dominates (EMUL=4 for unit-stride). m8 only when VL=VLEN_max is required AND no SW-pipelining is needed (cross-link `[[anti-sw-pipeline-same-reg-group]]`).
6. **## Dual-Issue Quick Picks for V1024_8MB** -- copy the spec's "good pairs" but distilled to a one-line rule per pair, and note that VLSU-second is the only legal ordering involving VLSU. Reference VRF table in spec rather than re-printing it.
7. **## Memory-Bound Ceiling** -- at L2_DATA_WIDTH=512, peak = 64 B/cyc. Within 15% (~54 B/cyc): declare done. Cross-link `[[memory-bound-diagnosis]]`.
8. **## Cache & Line-Hazard Notes** -- 64 B line; D$ 32 KB / 4-way / 64 B/cyc data RAM; in-place quant RAW hazard rule from spec applies unchanged.
9. **## What This Page Is Not** -- explicit disclaimer: does not replace the spec page or the PDF; if a number here disagrees with the PDF, the PDF wins. Update this page when the .inc changes.
10. **## Related** -- `[[ax45mpv-vpu-uarch-spec]]`, `[[ipc-vs-throughput]]`, `[[lmul-selection]]`, `[[memory-bound-diagnosis]]`, `[[anti-sw-pipeline-same-reg-group]]`, `[[tiling-gemm-to-vd4dots]]`.

## Index Update

Insert under `### Pipeline and Throughput` between the spec line and the `[[ipc-vs-throughput]]` line:

```markdown
- [[ax45mpv-v1024-8mb-pipeline-tuning]] -- Spec formulas resolved against the V1024_8MB silicon (DLEN=1024, VLSU buf=16, L2=8MB/512b). Concrete cycles, LMUL picks, dual-issue picks, memory-bound ceiling. Reference summary; ground truth is the spec page and the DS PDF.
```

## Verification

- `Read` the new file and confirm: frontmatter parses, every numeric claim is traceable to either the spec page or a `NDS_*` define in the .inc.
- `Grep` the new filename slug from `docs/wiki/index.md` to confirm the index entry was added exactly once.
- `Grep` `[[ax45mpv-v1024-8mb-pipeline-tuning]]` across `docs/wiki/` -- should appear only in the index for now (no operator pages updated yet).
- Sanity-check one resolved number end-to-end: e.g., vredsum-e8 at m1 = `1 + 11 = 12` cycles, matches spec formula `(VLEN/DLEN)*LMUL + LOG2(DLEN/64)*2 + LOG2(64/SEW)` with VLEN=DLEN=1024, LMUL=1, SEW=8.
- Confirm no other wiki page references `[[ax45mpv-pipeline]]` (the page just deleted in the previous turn) so we are not re-introducing a broken link target.

## Out of Scope

- Updating operator pages to link to the new reference (do that lazily, only when an operator's analyze-step result actually depends on a number from this page).
- Writing a parallel page for any other VPU config (V512, V256). Same template can be cloned per-config later if needed.
- Changing the optimize skill -- it already reads `index.md` first, so the new page is discoverable as soon as the index entry lands.
