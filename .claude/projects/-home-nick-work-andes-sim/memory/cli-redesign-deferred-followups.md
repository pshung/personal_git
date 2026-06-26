---
name: cli-redesign-deferred-followups
description: "Pre-existing bugs surfaced (not caused) during the 2026-06 CLI redesign, deferred by the user"
metadata: 
  node_type: memory
  type: project
  originSessionId: ae5483e5-a453-4fa7-9aee-2e7fac3a20e4
---

During the 2026-06-26 CLI-UX redesign (`--trigger` made required for hybrid,
clearer drain-miss error, `andesim --help` tree redesign, required-flag hints)
two PRE-EXISTING breakages were surfaced and deliberately deferred by the user
("leave for a separate pass"). Neither was caused by that change.

1. **3 stale-PC tutorial cells.** `docs/andes_sim_demo.ipynb` cell 21,
   `docs/andes_sim_gemm_tutorial.ipynb` cell 17, `docs/andes_sim_tutorial.ipynb`
   cell 25 are `--trigger pc` runs whose hardcoded enter/exit PC addresses are
   stale from the andes-sim->andesim rename/QEMU-bump rebuild, so they error
   (`plan step N: expected exit 200, got 0`, now reworded) instead of printing a
   cycle figure. Fix = objdump each fixture for the correct boundary PCs, update
   the cells, re-run. See [[notebook-refresh-recipe]].

2. **`tests/andes_sim/test_andes_sim_mmap2g.sh` fails with full toolchain.**
   `--mem-size 2G` is rejected because `max_program_mem_bytes()` = 2GiB minus
   the L26 V-scratch page (`driver/shm.cpp:93`), so 2G exceeds the cap; the test
   also writes at `0x7FFFF000`, which IS the scratch page now. Commit `1af22df`
   (L26 V-scratch reservation) post-dated `0c7a24b` (the 2G test). It only RUNS
   in a full-toolchain+`build/runtime` env (else it SKIPs via `exit 0`), so it
   is green in CI and only red locally. Fix = reconcile the 2G test with L26
   (write below the scratch page; pick a `--mem-size` <= the cap).

The CLI-redesign code itself (F1-F3) is fully validated: unit 9/9 + contract
release_surface/f7/f9/cosim/verify/cosim_refine/cosim_lockstep/trigger_gating/
memsize all pass.
