---
name: FPGA board for benchmarking
description: Andes RISC-V FPGA board at sqa-boards.andestech.com:1113 used for running picolibc libm benchmarks
type: reference
---

FPGA board for picolibc benchmarking: sqa-boards.andestech.com:1113
Used for cycle-count profiling of libm functions via GDB/semihosting.

GDB command pattern:
  riscv64-elf-gdb <elf> -batch -ex "target remote sqa-boards.andestech.com:1113" -ex "reset-and-hold" -ex "lo" -ex "c"

GDB binary: /local/nick/SW_Release/build-ast542/build-toolchain/linux/nds64le-elf-mculib-v5/bin/riscv64-elf-gdb
(same toolchain prefix as the XLEN=64 build; Makefile uses $(PREFIX)gdb)
