---
name: andes-engine-config-source
description: "which config.inc is authoritative for a built vsim engine's Andes-CSR capability"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9fb5c597-ba1e-4046-8ada-d69e84b4f335
---

A built vsim engine embeds and compiles from `build/V<core>/obj_sc/config.inc`
(copied at build time), which can DIFFER from the `external/<core>/.../config.inc`
source tree. Observed 2026-06-28: the built `sim_ax45mpv_premium` has
perf-monitor + PMA **on** (its `--describe andes_csrs` lists
`mcountermask_m`/`pmacfg`/`pmaaddr`), while
`external/ax45mpv_premium/andes_ip/kv_core/top/hdl/config.inc` has them **off**.

So to check an engine's real Andes-CSR capability, read the engine's OWN config:
its `build/.../obj_sc/config.inc` or its runtime `--describe andes_csrs` (which
the engine derives from its compiled-in `_NDS_*` macros) -- NOT the `external/`
source tree. The capability-gating flywheel test
(`tests/andes_sim/test_andes_caps_parity.sh`) was first written against the wrong
(external) path and the parity check caught the mismatch. Related:
[[andes-csr-transport-roadmap]].
