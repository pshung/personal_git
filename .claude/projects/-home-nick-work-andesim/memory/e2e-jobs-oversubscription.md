---
name: e2e-jobs-oversubscription
description: scripts/run_e2e.sh picks JOBS=nproc (128 here) and ~42/53 cases time out with rc 124; JOBS=8 gives 53/53.
metadata:
  type: project
---

On this 128-core host, `scripts/test_all.sh e2e` (and bare
`scripts/run_e2e.sh`) fails ~42 of 53 cases with `vsim expected exit 200
(drain), got 124` — 124 is `timeout`, not a hybrid bug. `default_jobs()`
caps JOBS by free /dev/shm (227 GB here, so no cap) and otherwise takes
`nproc`, i.e. 128 slots × 2 heavy processes each.

`JOBS=8 bash scripts/run_e2e.sh` → 53 passed, 0 failed. 8 is the cap
`andesim doctor` itself prints as "JOBS suggestion".

**Why:** a full-red e2e run looks like a real regression and invites a
hunt through the hybrid handoff. It is only oversubscription, and the
driver is not even in this path (`tests/e2e.sh` spawns qemu+vsim
directly — see [[log-first-debugging]]).

**How to apply:** always run the e2e phase as `JOBS=8`; treat a sweep of
rc-124 failures as a scheduling symptom before suspecting the code.
Observed 2026-09-09; the JOBS default itself is unfixed.
