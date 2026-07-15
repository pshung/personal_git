---
name: andesim-llamacpp-hybrid-gaps
description: "Verified gaps and working facts for running llama.cpp (Bonsai-27B target) on andesim hybrid mode - 2GiB RAM cap, no threads in toolchain, vplat runtime limits, ISA flag matrix"
metadata: 
  node_type: memory
  type: project
  originSessionId: b082ecbe-e020-4890-8524-5274ddbd4e9d
---

Investigated 2026-07-15. Target: run llama.cpp with Bonsai-27B-Q1_0.gguf (3.8 GB, models/ dir) on andesim (/home/nick/work/andesim) hybrid mode. All facts below verified by probes on this machine, not just docs.

**Hard blockers**
- Guest RAM max 2 GiB: driver cap driver/cmd_run.cpp:395 (`max_program_mem_bytes()`, shm.cpp:91 kAe350DramWindowBytes); QEMU andes_ae350 refuses >2G ("Cannot model more than 2GB RAM"). Bonsai-27B needs ~4.5 GB (no-mmap weights 3.8G + KV + compute). Lifting it = QEMU machine + vsim RTL memory map + driver change.
- Bare-metal toolchain /home/nick/nds64le-elf-newlib-v5d (GCC 14.3, riscv64-unknown-elf): libstdc++ built WITHOUT gthreads (std::mutex/std::thread/std::async do not exist - probe-verified compile error), newlib pthread.h has types but no functions. llama.cpp core then fails to COMPILE: ggml/src/ggml-threading.cpp (global std::mutex), src/llama-quant.cpp (std::thread), src/llama-model-loader.cpp (std::async), ggml-cpu.c (pthread_*). Fix = single-thread stubs + small llama.cpp patches; at n_threads=1 only mutex/cond no-ops are ever called.

**vplat runtime gaps (runtime/)**
- _sbrk has NO bounds check (vplat_syscalls.c:364, verified by disasm + live corruption: 8MB alloc silently smashed stack). Default _stack=0x700000 (7MB, andesim.ld:95, overridable -Wl,--defsym,_stack=...). Verified: _stack=0x1FF00000 + 256MB heap works on fast leg.
- No clock_gettime/_times (only _gettimeofday, host wall clock - works, probe-verified). ggml_time_us uses clock_gettime(CLOCK_MONOTONIC) -> link failure; needs shim.
- crt0.S calls main with argc=0/argv=NULL (crt0.S:131) - llama-cli style argv impossible; need custom driver against llama.h (examples/simple/simple.cpp uses core API only, no common lib).
- stdin read returns EOF. HTIF file I/O: host-cwd paths, 1984 B/chunk, measured 26 MB/s on fast leg (3.8GB = ~2.5 min).
- C++ WORKS: exceptions + global ctors + libstdc++ heap verified on fast leg (g++ -specs=andesim.specs).

**ISA matching (engine vsim:ax45mpv_premium = VLEN512 DLEN512 ELEN32)**
- Hybrid QEMU leg auto-synced to `-cpu andes-ax45mpv,vlen=512`, NO zfh/zvfh. RTL describe lists no zfh/zvfh either. ggml build must set GGML_RV_ZFH=OFF GGML_RV_ZVFH=OFF.
- ELEN=32: no 64-bit vector elements. ggml repack.cpp uses __riscv_vsseg4e64 -> illegal; set GGML_CPU_REPACK=OFF.
- Andes gcc gates segment intrinsics behind -mext-zvlsseg (ELF toolchain too, --target-help verified); ggml quants.c uses __riscv_vlseg2e32. See [[andes-toolchain-rvv-segment-flag]].
- GOTCHA: `run --mode fast` standalone pins `-cpu andes-ax46mpv` (engine_registry.cpp:71) which has Zce NOT Zcd -> c.fld/c.fsdsp illegal; toolchain default multilib libc contains Zcd, so any FP printf crashes (probe-verified, mtval 0xa43e). Workaround: `-- -cpu andes-ax45mpv,vlen=512`. Hybrid leg unaffected.

**Hybrid semantics**
- Nothing executes after ROI end marker (no handback leg) - print results INSIDE the ROI (verified: printf inside ROI works on vsim leg) or use --verify.
- Big images OK: 3.6MB-image fixture passed hybrid; bytes spanning the DLM overlay window 0x200000-0x207fff read back correctly in-ROI on RTL (feared shadow did not materialize).
- vsim speed 5-50 kHz (docs/MRD.md:150, measured 8867 Hz in quickstart). Full token on 27B (~1-3G insns) = days -> ROI must be one kernel/op. Tiny models (~15M param) can do a full-token ROI.
- q1_0 (GGML_TYPE_Q1_0=41) is upstream in this llama.cpp tree with an optimized riscv RVV dot kernel (commit 68380ae11).

**Recommended staging**: (0) port kit: pthread/gthread stubs + clock_gettime shim + custom main + Generic cmake toolchain file (LLAMA_BUILD_COMMON=OFF, GGML_OPENMP=OFF, find_package(Threads) needs CMAKE_THREAD_LIBS_INIT="" hint), prove on small model fast-leg; (1) Bonsai-27B kernel-ROI today within 2GB via one-layer micro-driver with extracted tensors; (2) andesim >2GB DRAM feature for full-model residency.
