---
name: User Role and Goals
description: User is tuning/optimizing libnn RVV functions for RISC-V Andes processors, collecting FPGA cycle counts
type: user
---

- Working on RVV (RISC-V Vector Extension) optimization of libnn neural network library functions
- Target platform: Andes AX45MPV with VLEN=1024
- Goal: Fine-tune libnn functions to match or beat expert-written RVV performance
- Has access to Andes ast530 toolchain (GCC 12.2.0), Andes-fork QEMU, and FPGA board for cycle-accurate measurement
- Collects performance data (inst/cycle counts) by running on FPGA board via GDB/ICEman
