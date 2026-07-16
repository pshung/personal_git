---
name: cm-build-halted-cache-enable-wedge
description: "On NDS_CACHE_COHERENCE_SUPPORT engines a halted-mode mcache_ctl D-cache enable without DC_COHEN wedges all device/uncached access - silent UART, aperture timeouts"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e8f04a6-33d1-4404-8e0c-17b9f5fccb82
---

On a coherence-manager RTL build (`NDS_CACHE_COHERENCE_SUPPORT 1` in config.inc,
e.g. ax46mpv_fpga_l3), enabling the D-cache from DEBUG HALT (abstract CSR write
OR Program Buffer csrrw) without also setting mcache_ctl.DC_COHEN (bit 19)
wedges the core's uncached/device access path: every later device load returns
0 and UART stores are dropped. Symptom class: hybrid in-ROI printf output
silently vanishes (run still "passes" - exit trigger fires, cycle figure prints),
and slave-port/aperture reads hang (step timeout). A running hart's own csrw
(crt0, cycle mode) is fine; either L1 enable alone is fine; the full value WITH
DC_COHEN set is fine.

Fixed 2026-07-16 (vsim_andesim 9be968a): ResumeDriver restores mcache_ctl via
PB csrrw and ORs DC_COHEN when `Simulator::cache_coherent()` (from
_NDS_CACHE_COHERENCE_SUPPORT) says CM build.

SECOND manifestation, same root: a RUNNING hart with DC_EN=1 but COHEN=0 on a
CM build corrupts data under D-cache EVICTION pressure - small demos pass,
CoreMark validates CRC garbage in cycle mode (list 0x0834, matrix/state 0,
~4k ticks). Fixed in andesim runtime crt0 (a9e77ef): bounded DC_COHEN join
(1024-try COHSTA poll) before the D-cache enable - bounded because non-CM
cores WARL-0 COHEN and QEMU permissively sticks COHEN without ever setting
COHSTA (unbounded poll = boot hang).

**Why:** QEMU never sets COHEN (models no CM), so the drained value is bare
0x703; the restore must supply the coherence join itself. And a "passing"
sweep can hide this: a corrupted CoreMark finishes in ~4k ticks and exits 0,
so the run only fails AFTER the fix makes the real ROI outrun the 90s step
timeout (raise --step-timeout-ms for big ROIs on ~3.5kHz engines).

**How to apply:** when a NEW engine shows silent in-ROI output or aperture
timeouts on hybrid only (cycle mode fine), check its config.inc for
CACHE_COHERENCE/CM_SUPPORT first. Debug method that found it: bisect the
restore via the state file - clear v6 write_mask bits (offset 7440) to disable
CSR groups, then mutate the CSR value bits; read back in-ROI facts through
drained GPRs (immune to the dead UART). Related: [[fast-leg-permissive-cycle-enforces-hw-contract]],
[[pipe-swallows-build-exit-code]] (the container ninja mtime-skip nearly
masked the fix - rm -f the exact main.cpp.o files before rebuild).
