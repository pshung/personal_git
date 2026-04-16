---
name: QEMU semihosting requires strace in Claude Code
description: Andes QEMU semihosting writes to fd 9 (not stdout) in Claude Code's sandbox — use qemu-validate scripts with --strace, never run QEMU wrappers or run.sh directly
type: feedback
---

## Problem
In Claude Code's sandboxed environment, Andes QEMU's semihosting output (printf from guest code) is written to host fd 9 instead of stdout. This means:
- QEMU wrapper scripts produce zero output
- `run.sh` (project/ax45mpv/run.sh) reports 0% pass rate because `tee` captures nothing
- QEMU exits successfully (code 0) but all log files are empty

## Root Cause
QEMU's semihosting implementation maps the guest's stdout (`:tt`) to a host fd that ends up as fd 9 due to QEMU's internal fd allocation. In a normal terminal this fd is connected; in Claude Code's sandbox it isn't, causing `write(9, ...) = EBADF`.

## Solution: Use qemu-validate/ scripts
Always use the scripts in `qemu-validate/` directory with `--strace` mode:

```bash
# Build
/usr/bin/bash /home/nick/work/libnn/qemu-validate/build_libnn.sh

# Run single test
/usr/bin/bash /home/nick/work/libnn/qemu-validate/run_qemu_test.sh <test_name> --strace --vlen 1024

# Examples:
/usr/bin/bash /home/nick/work/libnn/qemu-validate/run_qemu_test.sh conv_HWC_s8_s8_s8_asym_bias_any --strace --vlen 1024
```

The `--strace` mode uses `strace -f -e trace=write` to capture semihosting output from the fd and parses "accuracy checking pass/fail" from the strace log.

## DO NOT use
- `project/ax45mpv/run.sh` directly — it will show 0% pass rate
- QEMU wrapper scripts directly (e.g. `riscv-qemu-wrapper-v512_d512_b512`) — no output
- Running QEMU binary directly — same issue
