---
name: andesim-linux-runtime-roadmap
description: State and primary target of ROADMAP_LINUX_RUNTIME.md (vlinux proxy-kernel effort to run static-glibc llama.cpp on andesim).
metadata: 
  node_type: memory
  type: project
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

`/home/nick/work/andesim/ROADMAP_LINUX_RUNTIME.md` tracks building `vlinux`
(a new M-mode proxy kernel, `runtime/linux/`, pattern: riscv-pk) so a static
glibc RISC-V binary can run unmodified on all 3 andesim modes (fast/cycle/hybrid),
with hybrid producing a cycle-accurate measurement of ONE kernel iteration.

Primary target as of 2026-07-15: `llama-completion` (llama.cpp's text-gen CLI)
generating text from `Bonsai-4B-Q1_0.gguf` (572 MB, fits the 2 GiB DRAM window
directly). This replaced the original target (`llama-bench` + `Bonsai-27B-Q1_0.gguf`,
3.8 GB) per the user's explicit pivot ("goal revised to run llama-completion
Bonsai-4B model"). See [[llama-cpp-riscv-checkout]] for the supporting
cross-build/model facts this pivot is grounded in.

**Why the pivot**: llama-completion produces visible, checkable generated text
(a real demo) instead of a benchmark table, and Bonsai-4B sidesteps the 2 GiB
DRAM ceiling entirely, so the two features that existed only to work around
that ceiling for 27B (U10: DRAM window >= 6 GB, U11: GGUF layer-slice script)
are no longer on the critical path - they're kept in the roadmap as an
explicitly optional 27B stretch-goal track, not deleted.

## Feature state (one feature per session, per CLAUDE.md)
- U0 (extract `runtime/htif_client.{c,h}` out of `vplat_syscalls.c`, structural
  no-behavior-change refactor so vplat and vlinux share the HTIF window client):
  **DONE** 2026-07-15. All 12 `tests/vplat/*.sh` green before and after.
- U1 (vlinux skeleton: boot, banner, manifest reader): **DONE** 2026-07-15.
  `runtime/linux/{manifest.h,main.c,vlinux.ld,Makefile}` +
  `tests/vlinux/test_vlinux_boot.sh` + `scripts/build_all.sh` `vlinux` target.
  Key design call: no new crt.S - `runtime/crt0.S` (shared with vplat) is
  link-address-agnostic (PC-relative + linker-provided `_stack` symbol), so
  vlinux.ld just retargets it to base 0x0200_0000 with zero new asm. Confirmed
  by research that QEMU's `-bios` (MROM trampoline) and vsim's direct
  `reset_vector` pin both boot from the ELF's own e_entry - no boot stub
  needed. Test runs vlinux.elf as a plain standalone ELF (no --runtime flag
  yet, that's U2).
- U2 (driver `--runtime linux` plumbing): **DONE** 2026-07-15.
  `driver/{manifest.hpp,manifest.cpp,tempdir.hpp,tempdir.cpp}` (new),
  `--runtime` added to `Cli` (cli.hpp/cli.cpp), `run_fast`/`run_standalone`
  wiring in cmd_run.cpp, `tests/andes_sim/test_andes_sim_runtime_linux.sh`,
  docs/USER_GUIDE.md 5.12. `andesim run --mode fast --runtime linux app.elf`
  stages a private `vlinux-run.elf` copy (objcopy --update-section .manifest=
  with app path + mem_size) and boots THAT via -bios instead of the app
  directly. Three scope cuts, each documented in the roadmap's U2 DONE note:
  (1) **fast-only** - cycle/hybrid REJECT `--runtime` with a clear error
  (hybrid wiring is U9; nothing on the critical path before U9 needs it, per
  the roadmap's own Order line); (2) **argv/envp deferred to U3** - `--
  <args...>` parses (matches the roadmap's example invocation) but is
  warned-and-dropped, not forwarded to QEMU's CLI (would be misparsed as
  engine flags) and not yet written into the manifest - no wire format was
  invented without U3's loader to validate it against; (3) **staged
  vlinux-run.elf is not cleaned up** - fast's exec_passthrough execve()s and
  never returns, so the per-run temp workdir leaks (small, few MB, same
  tradeoff class as run_plan.cpp's repro bundles - not pruned, no test
  demands it yet). Also: `--mem-size` defaults to 1G under `--runtime linux`;
  the standalone fast leg's CPU is pinned to `andes-ax45mpv,vlen=512`
  (engine-synced) instead of the ax46 vplat default.
- U3-U9: PLANNED, straight-line dependency chain, one per session.
- U10, U11: PLANNED, explicitly optional/parallel, only needed if Bonsai-27B
  is revisited later.

## How to apply
Read ROADMAP_LINUX_RUNTIME.md itself for the full feature table (description,
input/output contract, key files, test, dependencies) before starting the next
session's feature (currently U3) - this memory is a pointer/orientation, not a
substitute for the roadmap doc, which is the source of truth for exact state.
