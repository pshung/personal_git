---
name: andesim-vsimcore-only-no-standalone
description: The user does not need vsim's standalone binary; VsimCore as a FastSim module (core only, no internal devices) is the only product of the AndeSim-on-FastSim port
metadata:
  type: project
---

Stated 2026-09-11 while porting AndeSim onto FastSim (fastsim_v3 branch `andesim`,
vsim_andesim branch `fastsim`): "我不需要 standalone vsim binary" and, before that,
"interconnect, smu, 那些應該都不需要了才對" -- VsimCore must be the RTL core only.

**Why:** the FastSim platform (router + gs_memory + Uart16550V2 ...) is the one
device set; a platform inside the core module is a second router. The old
process-based AndeSim (sim_<cpu> + QEMU processes, mmap sharing) is what the
port replaces.

**How to apply:** vsim's own Platform/Interconnect/SimpleMemory/UART/SMU and
main.cpp are deletable, not to be preserved; SimControl becomes its own FastSim
module (exit register + syscall window); VsimCore keeps only RTL, AXI<->TLM
bridges, clock/reset, debug module. Do not spend effort keeping the standalone
build or the S1 standalone-vs-hosted comparison alive. Keep `hybrid/` code for
S3 unless told otherwise. See [[andesim-fastsim-build-recipe]] if written.
