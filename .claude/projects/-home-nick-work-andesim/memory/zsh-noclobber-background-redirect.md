---
name: zsh-noclobber-background-redirect
description: "this host's zsh has noclobber - a plain > redirect to an existing file fails with \"file exists\"; use >| in Bash-tool commands"
metadata: 
  node_type: memory
  type: user
  originSessionId: 759352b2-0596-4c9a-97d6-1413f9278151
---

Nick's zsh profile sets noclobber. In Bash-tool commands, `cmd > existing.log`
fails with "(eval):1: file exists" and the command never runs (easy to misread
as the command failing). Use `>|` to overwrite, or write to a fresh filename.

**Why:** a background test run silently no-oped because the log redirect
failed, wasting a full baseline cycle.
**How to apply:** always use `>|` when redirecting to a log file that may
already exist. Related: [[pipe-swallows-build-exit-code]].
