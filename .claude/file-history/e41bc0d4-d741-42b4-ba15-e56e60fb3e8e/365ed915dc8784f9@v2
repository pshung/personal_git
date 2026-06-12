---
name: background-bash-cwd
description: "Background Bash tasks inherit the last foreground cwd; use absolute paths, and a trailing echo masks the real rc"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e41bc0d4-d741-42b4-ba15-e56e60fb3e8e
---

A `run_in_background` Bash call inherits whatever cwd the last foreground
call left (e.g. a `cd tools && pytest` leaves cwd at tools/). A relative
`./scripts/build_vsim.sh` then fails, and a compound like
`cmd; echo rc=$?` reports task exit 0, so the failure is silent.

**Why:** lost ~10 min on a vsim rebuild that never ran (L11 session).

**How to apply:** in background Bash commands, always use absolute paths
(or lead with `cd /home/nick/work/hybrid_sim`), and check the log file
content, not just the completion status. Related: [[qemu-timeout-sigttou]]
for foreground QEMU quirks.
