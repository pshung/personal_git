---
name: andes-toolchain-rvv-segment-flag
description: Andes RISC-V GCC gates RVV segment load/store intrinsics behind -mext-zvlsseg; check vendor -m flags before patching source
metadata: 
  node_type: memory
  type: project
  originSessionId: f8083144-88fa-478d-bc3e-92321463e7b4
---

The Andes toolchain (`/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds64le-linux-glibc-v5d/bin/riscv64-linux-gcc`, GCC 14.2, target `riscv64-linux`) does NOT enable RVV tuple segment load/store intrinsics (`__riscv_vlseg*`, `__riscv_vsseg*`, tuple `vcreate`/`vget`) with plain `-march=rv64gcv`. They are gated behind Andes-specific machine flags:

- `-mext-zvlsseg` - segment load/store
- `-mext-zvlss` - strided load/store
- `-mext-zvlsidx` - indexed load/store

**Why:** Andes vector units make these instruction groups optional, so the fork hides the intrinsics unless the flag is given. Errors look like "implicit declaration of __riscv_vlseg2e32_v_u32mf2x2", which wrongly suggests the intrinsics are missing.

**How to apply:** When an intrinsic is "not declared" under this toolchain, first check `riscv64-linux-gcc --target-help | grep -i <feature>` for a `-mext-*` flag. Do not rewrite the source. For llama.cpp rv64 builds, pass `-DCMAKE_C_FLAGS=-mext-zvlsseg -DCMAKE_CXX_FLAGS=-mext-zvlsseg`. Working cross-build configure (build dir `build-rv64`):

```
cmake -B build-rv64 \
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=riscv64 \
  -DCMAKE_C_COMPILER=$TC/riscv64-linux-gcc -DCMAKE_CXX_COMPILER=$TC/riscv64-linux-g++ \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS=-mext-zvlsseg -DCMAKE_CXX_FLAGS=-mext-zvlsseg \
  -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF
```

ggml then compiles the CPU backend with `-march=rv64gcv_zfh_zvfh_zicbop_zihintpause -mabi=lp64d` (GGML_RVV/GGML_RV_ZFH/GGML_RV_ZVFH/GGML_RV_ZICBOP default ON).

**Running the result under QEMU (user-mode):** stock `/usr/bin/qemu-riscv64` SIGILLs in ld.so (sysroot glibc uses xandes custom opcodes). Use the Andes linux-user QEMU at `/local/nick/SW_Release/build-ast542/build-qemu/linux/qemu-riscv64` (also `build-qemu-ast542/linux/`). Critical: `-cpu andes-ax45mpv` does NOT enable zvfh by default, so ggml's `vfncvt.f.f.w` in `ggml_cpu_fp32_to_fp16` SIGILLs - add `zfh=true,zvfh=true`. Working command:

```
/local/nick/SW_Release/build-ast542/build-qemu/linux/qemu-riscv64 \
  -L $TOOLCHAIN_ROOT/sysroot \
  -E LD_LIBRARY_PATH=<build>/bin \
  -cpu andes-ax45mpv,vlen=512,zfh=true,zvfh=true \
  <build>/bin/llama-bench -m <model.gguf> ...
```

Note: guest stdout is buffered under QEMU - a crash before flush shows empty stdout even if the program printed. Do not conclude "crashed before main" from empty stdout; check the faulting PC via `-g <port>` + `riscv64-linux-gdb -batch -ex "target remote :<port>" -ex continue -ex "x/i \$pc"` and map it with `-E LD_DEBUG=libs`.
