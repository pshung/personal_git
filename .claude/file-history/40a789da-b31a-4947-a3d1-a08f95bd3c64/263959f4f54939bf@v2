---
name: run_e2e.sh JOBS cap for high-core-count machines
description: On 128-core hosts, default_jobs() returns 128 which saturates vsim and causes timeouts
type: feedback
originSessionId: 40a789da-b31a-4947-a3d1-a08f95bd3c64
---
Always run `JOBS=8 bash run_e2e.sh` (or similar low value) on this machine. The `default_jobs()` function computes `min(nproc, /dev/shm_free_MB/256)`. On this 128-core host with ~257GB /dev/shm, it returns 128. Running 128 simultaneous Verilator/SystemC vsim instances saturates all cores and causes the 60s timeout to fire on most tests.

**Why:** First e2e run with `JOBS=128` showed only 2/36 passing with widespread `rc=124` (timeout). `JOBS=8` gives 36/36 PASS.

**How to apply:** Always cap JOBS when running `run_e2e.sh` directly. The CLAUDE.md documents this. `JOBS=8` is a safe default for this machine.
