---
name: Use rv32 picolibc toolchain for libm accuracy tests
description: Andes asm files target rv32 (soft-float double ops in some). Use nds32le-elf-mculib-v5d toolchain and qemu-system-riscv32.
type: feedback
---

For libm accuracy tests, use the rv32 picolibc toolchain, NOT rv64:
- Path: `/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds32le-elf-mculib-v5d/bin/riscv32-elf-gcc`
- This toolchain ships picolibc, so golden (toolchain default) and opt (with .s overrides) should match exactly
- Any diff is a real bug, not an expected accuracy difference
- QEMU: `/usr/bin/qemu-system-riscv32`
- ABI: ilp32d (hard-float double) — some asm files (fmax/fmin, rounding) use soft-float ops and are incompatible
- The asm files call `__clzsi2` which exists in rv32 libgcc but not rv64 libgcc (rv64 has `__clzdi2` instead)
