---
name: vsim vs FPGA cycle counts
description: vsim models core only (no memory subsystem), use FPGA for cycle-accurate results. vsim is for pipeline profiling reference only.
type: feedback
---

- vsim (AndesCycle) only models the CPU core, not the full memory hierarchy. Its cycle counts are profiling references, not ground truth.
- Always run on FPGA to get cycle-accurate results.
- Target VLEN is 1024, not 512. When running vsim, configure for VLEN=1024 if possible.
