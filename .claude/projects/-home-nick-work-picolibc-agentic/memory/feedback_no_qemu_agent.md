---
name: feedback_no_qemu_agent
description: Do not use qemu-runner agent; use the Makefile compare target to build and test RV32 ELFs
type: feedback
---

Do not use the qemu-runner agent to run RISC-V test ELFs. Instead, use `make compare` (or the appropriate Makefile target) which handles QEMU invocation with the correct flags. The Makefile in `libm/machine/riscv/` has the QEMU path and flags already configured.
