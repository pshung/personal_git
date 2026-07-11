---
name: log-first-debugging
description: "Debug andesim failures ONLY through its logs; missing info means add logging, not ad-hoc probing"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3fc4b524-7ee6-4896-a68e-b9c210a9831e
---

When an andesim/vsim run fails, locate the bug using ONLY the shipped logs: `--log-level 1` (debug) or `0` (trace), `--log-file`, and the repro bundle under `~/.cache/andesim/repro/`. If the logs do not contain enough information to locate the fault, that is itself the bug to fix first: add the missing log line (driver `log_line`, plugin `log_level` arg, vsim OpLog/spdlog), then debug.

**Why:** the log/repro system was built (ROADMAP L0-L5, V1-V3) exactly so bugs are reproducible and diagnosable from artifacts; bypassing it with ad-hoc printf/gdb probing leaves the next failure just as blind.

**How to apply:** on any failure, first re-run with `--log-level 1`, then `0 --log-file`; read the repro manifest. Only if the fault is still not locatable, propose a new log point as a TDD change in the right component.
