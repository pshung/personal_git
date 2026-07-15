---
name: riscv64-linux-gdb-broken
description: The LINUX_TOOLCHAIN vendor gdb (riscv64-linux-gdb) cannot run on this host -- stale Jenkins CI paths baked into its python linkage.
metadata: 
  node_type: memory
  type: project
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

`$LINUX_TOOLCHAIN/bin/riscv64-linux-gdb`
(`/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds64le-linux-glibc-v5d/bin/riscv64-linux-gdb`)
does not run on this host.

Two stacked failures:
1. `error while loading shared libraries: libpython3.10.so.1.0` - fixable:
   `LD_LIBRARY_PATH=/local/ycc738/python/lib` (a matching libpython3.10 build
   happens to live there).
2. Even with that fixed, gdb's OWN python init fails: it was built with
   `PYTHONHOME`/`sys.prefix`/`sys.path` all pointing at
   `/local/sqa/Jenkins/workspace/build-system-3-ast542/toolchain/.../python`
   and `build-system-3-ast540/toolchain/python` - Jenkins CI workspaces that
   no longer exist on disk. Result: `ModuleNotFoundError: No module named
   'encodings'`, gdb never initializes, `-batch -x script.gdb` produces no
   output at all.

Did not find a quick fix (would need a real `PYTHONHOME` matching gdb's
build-time python 3.10, or a gdb rebuilt/reconfigured without the baked-in
Jenkins paths). Native host gdb (x86-64) works fine for host-side
comparisons; there is no working way to attach gdb to a QEMU `-gdb` stub for
a riscv64 target on this host as of 2026-07-15.

**How to apply**: before planning to use `riscv64-linux-gdb` for live
register/memory inspection of a vlinux-loaded app (e.g., chasing
[[andesim-linux-runtime-roadmap]]'s U4 exit() gap), budget time to actually
fix this first, or use the fallback that worked instead: read raw register/
memory state via the trap frame in `runtime/handler.c`'s `exception_handler`
(it already receives `tf`, the full 31-GPR save frame) and print whatever is
needed with `WRITE_ERROR`/direct `htif_uart_putc` - unbuffered, always
visible, no debugger required. QEMU's own `-d exec -D logfile` instruction
trace is also usable without gdb for coarse "what ran before the crash"
questions.
