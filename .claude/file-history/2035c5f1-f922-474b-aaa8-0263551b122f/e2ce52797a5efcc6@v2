---
name: pipe-swallows-build-exit-code
description: "Piping a build to tail/head swallows its exit code; use pipefail or no pipe, and verify the log for errors before trusting \"exit 0\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2035c5f1-f922-474b-aaa8-0263551b122f
---

`bash build_vsim.sh 2>&1 | tail -5` returns tail's exit code (0), not the
build's. Two vsim rebuilds in one session reported "completed exit 0" while
ninja had actually stopped on a compile error -- the stale binaries then sent
debugging in circles for ~30 minutes.

**Why:** a pipeline's exit code is the LAST command's. `tail` always exits 0,
so any `build | tail` looks successful.

**How to apply:**
- When piping a build (especially `run_in_background` where only the exit code
  comes back), prefix `set -o pipefail`, or don't pipe at all and read the
  output file afterward.
- On any "successful" build, if downstream behavior looks stale (old binary
  semantics, missing symbols/strings), grep the build log for
  `error|build stopped` BEFORE debugging the code. Check `.ninja_log` /
  object-file mtimes to confirm the target actually recompiled.
- This applies to the vsim container build (`build_vsim.sh`, [[andes-engine-config-source]]
  relates: engines are rebuilt per config) and any long build piped for brevity.
