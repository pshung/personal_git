---
name: vsim (sim_ax45mpv_premium) build gotchas
description: Build flags and runtime-init quirks needed when targeting /local/nick/vsim/build/sim_ax45mpv_premium with bare-metal RVV code. Used by hot-inner-kernel-extractor's vsim mode.
type: reference
originSessionId: b4f5b9f7-fb07-4972-8cec-a175472fb595
---
vsim binary: `/local/nick/vsim/build/sim_ax45mpv_premium`
Demo Makefile: `/local/nick/vsim-workspace/vsim-demo/{Make.var,hello/Makefile,rvv/Makefile,acervv/Makefile}`
Bare-metal runtime: `crt0.S, libgloss.c, handler.c, trap.S` (vendored under hot-inner-kernel-extractor/vsim_runtime/)

**Build flags that work** (matches vsim-demo/rvv with xandes added):
```
-march=rv64gc_zve32x_xandes -O1 -fno-tree-vectorize -fno-tree-slp-vectorize
-static -Wl,--defsym,_stack=0x3000000 -nostartfiles
```

**Build flags that DON'T work**:
- `-march=rv64gcv_...` (full V): traps illegal-instruction on `vle64.v v8,(...)`
  with vsetivli e64,m8 that GCC -O1 sometimes emits inside libc helpers
  (e.g. _fstat -> SYSCALL_2 path). vsim apparently doesn't support that
  combo. zve32x is enough for libnn kernels (we only use e8/e16/e32).
- Skipping `-fno-tree-vectorize`: same trap risk if any wrapper.c gets
  vectorized.

**Runtime gotcha #1: enable mstatus.VS before any vector op**
vsim resets with `mstatus.VS = Off`, so the first vector instruction
traps illegal (mcause=2). Enable in main():
```c
__asm__ __volatile__("csrs mstatus, %0" :: "r"((unsigned long)1 << 9));
```
The FPGA build doesn't need this -- AE350 boot enables VS already.

**Runtime gotcha #2: vsim is slow (~7-9 kHz)**
Whole libnn perf tests take hours. The hot-inner-kernel-extractor exists
because of this -- it produces a microbenchmark of just the hot loop so
you can iterate in seconds.

**vsim vs FPGA cycle ratio (measured on conv_HWC_s8_s8_s8_asym_bias_any)**:
- vsim:  73.64 cyc/iter  (pipeline-only, no memory model)
- FPGA: 170.94 cyc/iter  (with cache + DRAM)
The 2.3x ratio is the cache/memory tax. Use vsim for pipeline tuning,
FPGA for ground-truth perf.

**Output line format**: vsim wrapper uses raw `csrr mcycle/minstret` and
prints `"The cycle count is N"` / `"The inst count is N"` -- intentionally
identical to libnn's nds_pfcounter readResult() output, so the same grep
pipeline parses both fpga and vsim runs.
