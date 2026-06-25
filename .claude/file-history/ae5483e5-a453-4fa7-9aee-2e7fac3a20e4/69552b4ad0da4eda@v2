---
name: zsh-noclobber-overwrite
description: "This zsh has noclobber set; `>` to an existing file fails, use `>|`"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ae5483e5-a453-4fa7-9aee-2e7fac3a20e4
---

The interactive zsh in this environment has `noclobber` set. Redirecting with
`>` to a path that already exists fails with `zsh: file exists: <path>` and the
command does NOT run. Use `>|` to force-overwrite (e.g. `cmd >| /tmp/out.log`),
or `rm -f` the file first. This bit me repeatedly when reusing `/tmp/*.log` and
heredoc target files across Bash tool calls.

Also: `mapfile` / `readarray` are unavailable in this zsh, and `for x in $var`
does NOT word-split on newlines (use `while IFS= read -r x` to iterate lines).
