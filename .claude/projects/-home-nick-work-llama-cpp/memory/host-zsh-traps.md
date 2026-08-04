---
name: host-zsh-traps
description: "this host's zsh kills compound commands three ways - noclobber (use >|), =word expansion, and failed-glob aborts"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7b02ee17-ca6c-451c-bf96-d15b23ca1de3
  modified: 2026-08-04T17:34:09.226Z
---

The Bash tool's shell on this host is zsh with options that abort whole
command lines before anything runs:

- **noclobber**: `> existing-file` fails with "file exists". Use `>|` for any
  redirect to a log that may exist. Background runs that "fail instantly with
  an empty log" are usually this.
- **=word expansion**: any bare word starting with `=` (e.g. `echo ===` or
  `echo ================`) is expanded as `=cmd` -> "not found" and the ENTIRE
  line aborts, including commands before the echo. Quote separators:
  `echo '---'`.
- **failed glob aborts**: one non-matching glob (`kernel-lab/*.sh`) aborts the
  whole compound command, so unrelated earlier globs print nothing. Guard with
  `2>/dev/null` + `|| true` per glob, or test existence first.

Also: qemu-user (run-rv64-qemu.sh) SIGSEGVs (exit 139, no output) on the
static Zce/ax46mpv andesim binaries (bin-*); it runs the DYNAMIC
build-rv64/bin binaries fine (script defaults). Static andesim ELFs belong on
qemu-system / andesim fast mode instead.
