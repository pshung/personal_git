---
name: vsim-submodule-pins-must-be-pushed
description: hybrid_vsim submodule pins that exist only on a workstation break every clean clone; the andesim image build and any release gate cannot build the engine.
metadata:
  type: project
---

The andesim image build clones `hybrid_vsim` from the remote and runs
`git submodule update --init --recursive`, so **every submodule commit
`hybrid_vsim` pins must be reachable on that submodule's own remote.**
A pin that exists only in a local checkout fails as:

```
fatal: remote error: upload-pack: not our ref <sha>
```

Hit for real on 2026-09-08: `llamacpp` pinned
`external/cpu_config_to_march_converter` at a commit never pushed to
`RD-SW/cpu_config_to_march_converter`. No clean clone anywhere -- not the image
build, not a customer -- could build the engine. Fixed by re-pinning to the
remote's `master`.

Checking a pin: `git ls-remote` is NOT the test. It lists only ref tips, so a
pin on a ref's ancestor looks missing when it is fine. Use a real fetch:

```sh
git init -q /tmp/probe && git -C /tmp/probe fetch -q --depth 1 <url> <sha>
```

Relevant to the release gate ([[gitea-issue-tracker]] issue 23, "a real image
build"): the gate catches this class only because it clones from the remote.
The same applies to `hybrid_qemu` and `hybrid_sim`. Note the three repos do not
share a branch name -- engine `llamacpp`, QEMU `andesim`.
