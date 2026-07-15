---
name: l2c-l3c-transport
description: "Platform shared-cache (L2C/L3C) MMIO transport landed 2026-07-15 - ax66 L3C live, ax45/ax46 RTL-blocked by cfg size 0, one-flip path to enable"
metadata: 
  node_type: memory
  type: project
  originSessionId: 569cdfe1-891e-4020-b14b-860c21a9f868
---

DONE 2026-07-15: the hybrid handoff transports the platform shared-cache
registers at 0xE0500000 (Control policy bits via read-MERGE-write, HPM
Control 0, WAYMASK0-4). Commits: ABI 9ecc0cc (HYBRID_L2C_CTRL_POLICY_MASK
0xFF), vsim 9b01c20, andesim ff583f3, demo de26930.

Facts that will matter later:
- The shared cache is the L2C on 45-series, the L3C on 46/66 - SAME register
  layout at every transported offset (DS220 Table 112 == DS295 Table 33).
  The demo tests are split by level: demo/cache l2c.elf vs l3c.elf (one
  source, -DSHC_L3).
- Gate chain: vsim src/hybrid/shared_cache_config.hpp binds _NDS_L2C/L3C_*
  macros -> --describe shared_cache_level/base/size_kb -> driver descriptor
  -> plan plugin token l2c_base= AND `list engines` CACHE column -> demo
  check.sh picks the leg or SKIPs.
- ax45mpv_premium and ax46mpv_advanced SKIP because their engine cfgs set
  NDS_L2C/L3C_CACHE_SIZE_KB=0 (block absent from RTL). To enable: flip that
  one value in vsim_andesim/data/configs/<engine>.cfg and rebuild with
  [[vsim-build-via-container]] - full re-verilation, and every cycle figure
  for that engine shifts. Wrapper/driver/demo need NO change.
- Control Register: only bits [7:0] round-trip (CEN, PFTHRES, IPFDPT,
  DPFDPT, ECCEN). RAM-timing [13:8] belongs to the RTL (ax66 L3C resets
  DRAMOCTL=1, probe-measured 0x801); a raw restore would zero it. Verify
  compares l2c.ctrl under the policy mask only.
- WAYMASK regs on domains a cluster lacks are RAZ/WI (probed on 1-core
  ax66_makatau: masks 2-4 drop writes, read 0, no fault).
- The l2c/l3c demo is deliberately NOT --verify-able: the oracle's in-ROI
  MMIO reads hit QEMU's stub, the vsim leg reads the RTL, so ROI GPRs
  legitimately diverge. In-guest asserts only.
