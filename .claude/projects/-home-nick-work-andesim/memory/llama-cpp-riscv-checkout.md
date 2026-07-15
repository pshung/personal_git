---
name: llama-cpp-riscv-checkout
description: "What already exists in /home/nick/work/llama.cpp for RISC-V (Bonsai models, build-rv64* dirs, run-rv64-qemu.sh) and how it relates to andesim's vlinux roadmap."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

`/home/nick/work/llama.cpp` is a separate checkout (stock upstream, `origin/master`,
not an Andes fork) used to cross-build and sanity-check llama.cpp for RISC-V
*before* investing in andesim's [[andesim-linux-runtime-roadmap]] (vlinux).

## Bonsai models (`models/*.gguf`, all `general.architecture = qwen3`)
- `Bonsai-4B-Q1_0.gguf` - 572 MB, 2560 embed, 36 layers, 32 heads, 32768 ctx, 398 tensors.
- `Bonsai-8B-Q1_0.gguf` - 1.2 GB.
- `Bonsai-27B-Q1_0.gguf` - 3.8 GB (exceeds andesim's 2 GiB DRAM window; needs the
  roadmap's U10 DRAM-window-expansion or U11 GGUF-layer-slice to run there).
No "Bonsai" docs/readme anywhere in the tree - it's the user's own model, not
an upstream-documented architecture name (the GGUF's arch tag is plain `qwen3`).

## `tools/completion` -> binary `llama-completion`
This is llama.cpp's current text-generation CLI (the modern successor to the old
`main`/`llama-cli` example: `-m model.gguf -p "prompt" -n N -t 1`, etc.). Not a
benchmark tool like `llama-bench`.

## Three local build dirs (all gitignored, not committed)
- `build-rv64/`, `build-rv64-noomp/`: cross-built with the Andes **glibc** Linux
  toolchain (`nds64le-linux-glibc-v5d`, matches andesim's `LINUX_TOOLCHAIN`).
  **Dynamic** link (`BUILD_SHARED_LIBS=ON`) with `GGML_RV_ZFH=ON GGML_RV_ZVFH=ON
  GGML_CPU_REPACK=ON`. Both already have a working `llama-completion` binary.
  Meant to run under Andes's own **linux-user QEMU** (`qemu-riscv64`, syscall
  translation only, no system/device emulation) via `run-rv64-qemu.sh` - a fast
  functional sanity path completely separate from andesim's system-mode QEMU +
  vsim hybrid pipeline. NOT reusable as-is for andesim's vlinux: vlinux needs
  `-static`, `BUILD_SHARED_LIBS=OFF`, and ZFH/ZVFH/CPU_REPACK=OFF (vsim RTL is
  ELEN=32, no zfh/zvfh - see the roadmap's verified facts).
- `build-rv64-baremetal/`: an abandoned attempt at a newlib/baremetal cross-build
  via `cmake/riscv64-andes-elf-newlib-gcc.cmake`. That toolchain file no longer
  exists anywhere in the tree; the build dir has a fully configured CMakeCache
  but **zero built binaries**. Not a usable shortcut around vlinux - ignore it.

## `run-rv64-qemu.sh` (untracked, repo root)
Wrapper: `./run-rv64-qemu.sh <binary> [args]` runs a `build-rv64/bin/` binary
under `$ANDES_ROOT/build-qemu/linux/qemu-riscv64` with `-L $SYSROOT
-E LD_LIBRARY_PATH=$BIN_DIR -cpu andes-ax45mpv,vlen=512,zfh=true,zvfh=true`,
defaulting `-m` to `models/Bonsai-27B-Q1_0.gguf` if none is given.
`ANDES_ROOT` defaults to `/local/nick/SW_Release/build-ast542` (confirmed present).

Verified 2026-07-15: `./run-rv64-qemu.sh llama-completion -m models/Bonsai-4B-Q1_0.gguf
-no-cnv --prompt "The capital of France is" -n 32 -t 1 --seed 42` -> exit 0,
correct output ("The capital of France is Paris."). De-risks vlinux's syscall/
threading/model-format assumptions (U3-U8) but does NOT replace the need for
vlinux, since linux-user QEMU never touches vsim and can't produce a
cycle-accurate hybrid ROI measurement (the roadmap's actual end goal).

## How to apply
Before redoing RISC-V/llama.cpp exploration work, check this checkout first -
a working cross-build and a known-good model/arch combination may already be
sitting here. When picking a build dir to extend for vlinux (U8), start a
*fresh* static config; do not try to flip `build-rv64`'s existing dynamic one.
