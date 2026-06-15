---
name: reference-riscv-toolchain-path
description: RISC-V toolchain real location for building fixtures; committed config.env path is stale
metadata: 
  node_type: memory
  type: reference
  originSessionId: 91a1ac52-6732-4586-b6e0-4e20a2f5ca87
---

Andes RISC-V GCC lives at `/local/nick/build-ast540/bin/` (riscv64-unknown-elf-{gcc,ld,objdump,nm,...}). So `TOOLCHAIN=/local/nick/build-ast540`.

Why I kept re-searching: the committed `config.env` template pins `HYBRID_TOOLCHAIN=/local/nick/SW_Release/build-ast540/build-toolchain/linux/nds64le-elf-newlib-v5d`, which no longer exists. `setup.sh` exports `HYBRID_TOOLCHAIN` but I avoid `source ./setup.sh` (it can trigger builds), and the toolchain is not on PATH in the Bash tool. So each session started with a stale/unset value.

To build fixtures without re-discovering: `make -C tests/fixtures TOOLCHAIN=/local/nick/build-ast540 <name>.elf`, or compile directly with that prefix. Fixture flags (from tests/fixtures/Makefile): `-march=rv64gc -mabi=lp64d -nostdlib -static`, link `-T runtime/andes-sim.ld -nostdlib -static`. See [[reference-hybrid-unit-test-host-build]].
