---
name: premium-mext-csr-capability
description: which writable M-mode CSRs the premium engine can actually verify in the hybrid handoff
metadata: 
  node_type: memory
  type: project
  originSessionId: 9fb5c597-ba1e-4046-8ada-d69e84b4f335
---

The v4 M-ext CSR transport (`HYBRID_M_EXT_CSR_LIST`, 51 CSRs) is capability-gated.
On `ax45mpv_premium` (M-only, priv=1) only **17** are implemented and thus
round-trip-verifiable: the perf-counter set (mcountinhibit, mhpmcounter3-6,
mhpmevent3-6, mcounterwen, mcounterinten), mdcause, and the 5 trigger CSRs
(tselect, tdata1, tdata2, tcontrol, mcontext). Premium enables exactly these via
PERF_MONITOR + TRIGGER + ALWAYS gates; the other 34 are gated OFF (UMODE/SMODE/
EXCSLVL/SMRNMI/CLIC/SMSTATEEN/CCTL/PPI/FIO/EPMP all absent in its config.inc).

Key gotcha: QEMU's `andes-ax45mpv` models full S+U+M and EXPOSES CSRs (menvcfg,
mcounteren, the U-delta block, mcctl*) that vsim premium does NOT implement.
QEMU-gdbstub-exposes != vsim-implements; restoring a CSR vsim lacks can stall the
DM. So capability is decided from vsim's config.inc (andes_caps_from_config), not
from what QEMU drains. `mhpmcounter3-6` are HW counters that increment during the
ROI, so they are transported+restored but verify-EXCLUDED (like mcycle/mip).

To dump an engine's real exposed CSR set, speak RSP qXfer:features:read:
riscv-csr.xml to its gdbstub. Related: [[andes-engine-config-source]].
