---
name: FPGA benchmark compile/run approach
description: How to compile and run benchmarks on the Andes FPGA - use simple gcc with -mvh, not picolibc specs
type: feedback
---

For compiling programs to run on the Andes FPGA board:
- Just use the toolchain's built-in newlib: `riscv64-elf-gcc -Os -mvh -o foo.elf foo.c -lm`
- Do NOT use `--specs=picolibc.specs`, `--oslib=semihost`, `--crt0=semihost`, `-Wl,--defsym` hacks, etc.
- `-mvh` enables Andes virtual hosting (semihosting) — required for printf output via GDB
- Toolchain: `/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin/`
- GDB (no-python): `/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin/riscv64-elf-gdb-nopython`
- The picolibc build (`build_mculib3.sh`) produces `libm.a` etc. for benchmarking, but linking for FPGA runs should use the simple approach above.

When benchmarking picolibc's libm specifically, link against the built picolibc libm.a directly rather than through specs.
