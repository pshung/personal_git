---
name: reference-golden-driver-hsim-filename
description: "The Python golden driver is the `hsim` file (no .py extension); `hsim.py` references in docs are wrong until F14"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3e2a2b1e-129a-4fc4-9f56-bf55e467a6bc
---

The golden reference driver is the executable `hsim` at the repo root (a Python
script with NO `.py` extension). `driver/ROADMAP.md`'s parity conventions and some
docs say `python3 hsim.py`, but **no `hsim.py` file exists** -- that name is
aspirational until F14 renames the binary.

This bit me in F9: an Explore subagent asked to read `hsim.py` invented plausible
line numbers (e.g. "_qemu_drain_argv at 725-755") instead of erroring. The real
`hsim` happened to have similar content, but the citations were fabricated.

When doing parity/golden work: read the real `hsim` file directly (e.g.
`grep -n 'def cmd_' hsim`); never trust a citation to `hsim.py`. Related:
[[project_hsim_cpp_rewrite]].
