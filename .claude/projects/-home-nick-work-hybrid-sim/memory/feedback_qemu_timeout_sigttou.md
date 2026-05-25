---
name: qemu-timeout-sigttou
description: "QEMU -nographic under coreutils `timeout` hangs from SIGTTOU on tcsetattr; fix is `</dev/null` to detach stdin from tty."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f46138b0-b423-4d93-9d45-8bb4495612a0
---

When a bash demo wraps `qemu-system-riscv64 -nographic` with coreutils `timeout`, QEMU hangs producing zero output until `timeout` fires SIGKILL (rc=124). Root cause: `timeout` creates a new process group for the child; QEMU `-nographic` calls `tcsetattr(STDIN, ...)` on the controlling tty; POSIX sends SIGTTOU to the whole pgrp when a non-foreground pgrp does this; default action STOPs the process.

Fix: redirect stdin from `/dev/null` before the output redirect:

```bash
timeout 120 "$VSIM_QEMU" ... \
  </dev/null >"$QEMU_LOG" 2>&1
```

With stdin as a regular file (not a tty), `tcsetattr` is a no-op for the SIGTTOU path.

**Why:** Bit me when `./hsim demo icount_roundtrip` passed inside Claude Code's shell (stdin not a real tty) but failed in user's tmux with rc=124. PC/CSR demos passed in tmux because `tests/e2e.sh` launches QEMU WITHOUT `timeout` (line 76), keeping QEMU in the shell's foreground pgrp. The 4 icount/simpoint demos wrapped QEMU with `timeout` directly, so they hit this. Python's `subprocess.run(timeout=...)` is unaffected because it does NOT fork a new pgrp.

**How to apply:** Any time you wrap an interactive-by-default binary (QEMU, gdb, etc.) with `timeout` in a bash script, redirect stdin from `/dev/null`. Diagnostic tell: empty log file + rc=124 + process state `T` (stopped) in `/proc/$PID/status` while running. Don't try to fix with `stdbuf` (this is not buffering) or smaller workloads (this is not slowness) - the process is genuinely frozen by the kernel. See [[run-e2e-jobs]] for the related lesson about how harness-level wrapping changes process behavior in non-obvious ways.
