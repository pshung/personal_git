---
name: ax46mpv-cache-size-not-the-lever
description: Measured 2026-08-03/04 - doubling ax46mpv_fpga_l3 D$/L3 makes Q1_0 decode ~5% SLOWER; BIU addr width 32->39 is exactly free
metadata: 
  node_type: memory
  type: project
  originSessionId: ebfb04e0-19ef-4a1a-9e2c-58953c138710
  modified: 2026-08-04T02:33:22.112Z
---

Two engine-config experiments on `vsim:ax46mpv_fpga_l3`, both measured with the
K=51 ROI ladder (`bash measure.sh`, `blk.7.attn_v.weight`, Bonsai-4B).

**BIU/L3 address width 32 -> 39 (commit `87a0baa` in `/home/nick/work/vsim_andesim`): free.**
6 of 7 ladder numbers came back bit-identical to the addr32 reference
(decode pristine 4,476,673 / prefetch 1,389,236 / d4 362,799; prefill pristine
8,875,248 / prefetch 1,651,949 / d4 818,314). Only baseline decode moved, by
1,028 cycles = 0.05%, which is the same order as known run-to-run noise.

**Doubling the caches (D$ 32->64 KB, L3 2->4 MB) made decode SLOWER:**

    decode        32K/2M      64K/4M
    pristine   4,476,673   4,671,291   +4.4%
    baseline   2,143,185   2,124,273   -0.9%
    prefetch   1,389,236   1,459,739   +5.1%

`baseline` (repack, prefetch OFF) is the only config with uncovered demand
misses and the only one that gained. Everything else paid deeper tag lookup for
nothing: the diff also took `NDS_L3C_TAG_RAM_AW` 6->10 (16x tag array for 2x
capacity) and `NDS_DCACHE_UTAG_DEPTH` 16->32.

**Why:** the Q1_0 gemv streams each `block_q1_0x64` once with zero reuse, and
attn_v's 360 KB working set already fit the 2 MB L3. Capacity was never the
constraint - latency was, and the zicbop prefetch (see
[[q1_0-wide-vlen-repack-rowparallel]]) had already covered it.

**NOT tested, and it is the only test that could still show an L3 win:**
`ffn_down` at 3.5 MB does not fit 2 MB but does fit 4 MB. `bin-d4-k56` and
`bin-prefetch-k56` are built and ready; needs the cache enlarged again.

**Trap that cost a day:** a background watcher using
`until ! pgrep -f "measure.sh"; do sleep; done` never exits - `pgrep -f` matches
the watcher's own command line. Chain runs sequentially in one job instead.

Engine configs live in `/home/nick/work/vsim_andesim/data/configs/`, NOT
`/local/nick/vsim/data/configs/` (stale copy). The engine is the compiled
`$VSIM_BIN_DIR/sim_<engine>` binary; `VSIM_BIN_DIR` is set in
`/home/nick/work/andesim/config.env`. Check its mtime to confirm a rebuild.
