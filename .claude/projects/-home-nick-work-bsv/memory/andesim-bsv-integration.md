---
name: andesim-bsv-integration
description: "Plan, decisions and current state for adding AndeSim (/home/nick/work/andesim) to BSV"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1332e306-a76b-4a5d-b698-8760eb9c4da4
  modified: 2026-09-09T06:45:37.062Z
---

AndeSim (`/home/nick/work/andesim`, repo `nick/hybrid_sim`) is being added to BSV. Decisions and state as of 2026-09-09:

## Decisions
- **Branch, not main.** Reaffirmed 2026-09-09 ("先不要merge to main. 我們開new branch"). Both forks go to the official RD-SW repos as an `andesim` branch, NOT merged upstream: `nick/hybrid_qemu@andesim` → `RD-SW/qemu@andesim` (**DONE**, `714c703a75e03d3f3c3747d199a6947a650097a3`); `nick/hybrid_vsim@llamacpp` → `RD-SW/vsim@andesim`. Precedent: `RD-SW/copilot` already has 3 entries with 3 refs in `pkgs/andes/repositories.nix`, and `RD-SW/qemu` already carries 50 branches including `nick-dev`.

## qemu leg: done
`RD-SW/qemu@andesim` = the 5 AndeSim commits (`hw/riscv/andes_ae350.c` +460, `include/hw/riscv/andes_ae350.h` +1) rebased onto the `andes-v5-v10.2` tip `8c371d29bc`. The rebase was **clean — no conflicts** (an earlier guess that `0ff2bfb792 #260 external IDLM` would conflict was wrong). `git range-diff` shows 4 of 5 patches byte-identical; only the L2C-seed commit changed, and only in context lines, because #260 wrapped the following subport loop in `if (!bs->soc.use_external_idlm)`. Verified by building both the rebased branch and the upstream tip and running the new upstream suite `tests/andes` (`make`, qtest + tcg groups, `CROSS_CC=/usr/bin/riscv64-elf-gcc` auto-detected): all PASS on both. Local branch `andesim-rebase` in `/home/nick/work/qemu_andesim` (remote `rdsw` added there).

Not cleaned up before the push, optional later force-push on this fresh branch: no `Signed-off-by` trailers (all 13 upstream commits have them) and the last commit's subject still ends in the TDD marker `(behavioral)`. `scripts/checkpatch.pl` on the 5 commits: 1 clean, 3 with 2 warnings, and the HTIF-syscall commit with 12 mechanical errors (9 × trailing statement on one line, 3 × `%#` printf flag) — these only matter if the work is ever proposed into `andes-v5-v10.2`.
- **No `reports/` entry.** AndeSim is an engineering version and vsim has too many versions, so no CI build, no cache, no regression protection — accepted knowingly. `bsv check` still catches eval/naming errors for every package. Interim option: `POST /api/jobs` on the CI service builds any target on demand.
- **`--enable-plugins` went into the shared `andes.qemu`**, not a variant. Cost accepted: `andes.qemu` drvPath changed, so CI recompiles it and dependents lose cache. Shipped as `RD-SW/bsv` PR #253 (commit `e006380`, head `nick/bsv:qemu-enable-plugins`), open since 2026-09-09 with body, `Kind/Enhancement`, and cmchen requested as reviewer.
- **PR flow: fork.** Matches team norm — every recent merged PR came from a personal fork and `cmchen` merged it after one approval, so do not self-merge even though `main` allows it.

## Gitea facts that gate the work
`RD-SW/andesim_abi` is **public since 2026-09-09** and verified anonymously readable, so the vsim leg is unblocked. `RD-SW/qemu` and `RD-SW/vsim` are public too; `nick/hybrid_qemu` and `nick/hybrid_vsim` are **not**, so BSV can never fetch the forks directly — BSV's `builders/fetch-git@v0` sets `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null` and has no credential.

`RD-SW/bsv` main is protected: nick has `push: true, admin: false`, `user_can_push: false`, `user_can_merge: true`, `required_approvals: 0`, `enable_status_check: false`. A fork PR's Actions run starts as `status: waiting` ("Blocked by required conditions") and only a maintainer's "Approve and run" in the web UI releases it — there is no API route for it (POST .../actions/runs/<id>/approve returns 404).

## Shape of the work
AndeSim splits into 4 BSV packages across 2 hosts: the C++20 CMake driver and the qemu_plugin on `x86_64-linux-gnu`; `runtime/` and `runtime/linux/vlinux.elf` on host `nds64le-elf-newlib-v5d` (model: `pkgs/andes/libnn`, which also shows how to pass a git rev in `env` since `fetchGit` strips `.git`). The driver's `config.env` becomes a wrapper script with store paths, following `pkgs/runners/`.

The fork's `config.yaml` engine trimming and `tools/` deletions exist only to shrink the container image; in BSV that is `-DVSIM_CPUS=ax46mpv_fpga_l3`, so those source changes are never needed. `vsim` still needs the shared-file refactor (`mk-vsim.nix`) for that flag; qemu no longer does.

**Why:** the fork lived under a personal gitea account (no backup, no access control) — the real current risk; upstreaming vsim is a 1–2 week job that engineering-version status does not justify.

**How to apply:** follow the `copilot` variant pattern (thin `default.nix` over a shared `mk-*.nix`). Refactors go in as structural commits proven by unchanged `nix eval --raw '<attr>.drvPath'`. To probe QEMU plugin support, run `qemu-system-riscv64 -plugin /nonexistent` — `--help` lists `-plugin` either way, so only the run-time message distinguishes them.
