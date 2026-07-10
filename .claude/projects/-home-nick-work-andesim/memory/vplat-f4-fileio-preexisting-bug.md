---
name: vplat-f4-fileio-preexisting-bug
description: "tests/vplat/test_vplat_f4.sh fails on the fast engine (HTIF file-io readback mismatch (17)) - pre-existing product bug, not harness/legacy related"
metadata: 
  node_type: memory
  type: project
  originSessionId: 759352b2-0596-4c9a-97d6-1413f9278151
---

As of 2026-07-10, `tests/vplat/test_vplat_f4.sh` fails on the fast (QEMU) leg
with "FILEIO: readback mismatch (17)" while the cycle leg passes. Verified
pre-existing via `git stash` (fails identically on the untouched tree), so it
is a real HTIF file-io bug on the QEMU side, not caused by the 2026-07-10
legacy cleanup. Reported to the user; fix is still pending.
