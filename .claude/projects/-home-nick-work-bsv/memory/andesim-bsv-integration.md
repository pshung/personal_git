---
name: andesim-bsv-integration
description: "Plan and constraints for adding AndeSim (/home/nick/work/andesim) to BSV — branch strategy, no report entry, engineering version"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1332e306-a76b-4a5d-b698-8760eb9c4da4
  modified: 2026-09-09T05:50:02.802Z
---

AndeSim (`/home/nick/work/andesim`, repo `nick/hybrid_sim`) is being added to BSV. Decisions made 2026-09-09:

- **Branch, not main.** Both forks move to the official RD-SW repos as an `andesim` branch, NOT merged into main: `nick/hybrid_qemu@andesim` → `RD-SW/qemu@andesim`, `nick/hybrid_vsim@llamacpp` → `RD-SW/vsim@andesim`. Precedent in BSV: `RD-SW/copilot` already has 3 entries with 3 refs in `pkgs/andes/repositories.nix`.
- **No `reports/` entry for now.** AndeSim is an engineering version, and vsim has too many versions to force upstream. So no CI build, no cache, no regression protection — accepted knowingly. `bsv check` still catches eval/naming errors for every package, including non-report ones.
- `andesim_abi` must move from `nick/` to `RD-SW/` before the vsim branch push (a submodule url under a personal account blocks it).
- AndeSim splits into 4 BSV packages across 2 hosts: driver + qemu_plugin on `x86_64-linux-gnu`; `runtime/` and `runtime/linux/vlinux.elf` on host `nds64le-elf-newlib-v5d` (model: `pkgs/andes/libnn`).
- The `config.yaml` engine trimming and `tools/` deletions on the fork exist only to shrink the container image. In BSV that becomes `-DVSIM_CPUS=ax46mpv_fpga_l3`, so those source changes are never needed.
- BSV's shared `andes.qemu` needs no change: `--enable-plugins` goes only on the andesim variant.

**Why:** the fork lives under a personal gitea account (no backup, no access control), which is the real current risk; upstreaming vsim is a 1–2 week job that the engineering-version status does not justify yet.

**How to apply:** follow the `copilot` variant pattern — extract a shared `mk-qemu.nix` / `mk-vsim.nix` and keep `default.nix` as a thin wrapper. Refactor first as a structural commit, proven by unchanged `drvPath`.
