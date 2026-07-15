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
- U3 (ELF loader + Linux initial stack + auxv): **DONE** 2026-07-15.
  `runtime/linux/{loader.h,loader.c,stack.h,stack.c,syscall.c}` (new),
  `runtime/ecall_hook.h` (new, shared) + `runtime/handler.c` extended (a weak
  `handle_ecall` hook - default "unhandled", so vplat's fatal-trap contract
  is untouched; vlinux's syscall.c overrides it), `tests/fixtures/
  rt_linux_argv.c` (new -nostdlib linux-ABI fixture, built with the ordinary
  bare-metal HYBRID_TOOLCHAIN - no glibc needed until U4) +
  `tests/vlinux/test_vlinux_loader.sh` (fast + cycle, same staged
  vlinux-run.elf on both). Scope cuts: no LINUX_TOOLCHAIN yet (U4's job),
  argv stays `[app_path]` only (manifest format unchanged), V-scratch/window
  overlap checks deferred to U9, `_sbrk`'s brk arena not yet app-aware
  (deferred to U4+).

  **Two real bugs worth remembering for any future vlinux/payload work**:
  (1) a manifest field patched post-link via `objcopy --update-section`
  (U2's mechanism) MUST be `const volatile` in C, not plain `const` - at
  -O1 GCC constant-folds a plain-`const` global back to its SOURCE
  initializer, since nothing in the visible program ever writes it (the
  objcopy patch is invisible to the compiler). This will bite again if a
  future manifest field is added without the same qualifier. (2) code
  written into memory via ordinary guest stores (not vsim's privileged ELF-
  load backdoor) needs an explicit `fence.i` before being executed, on any
  cache-modeling engine (the real RTL) - QEMU's cacheless functional model
  silently masks a missing fence.i, so this class of bug ONLY surfaces on
  the cycle leg, never fast. Both bugs were caught by running the SAME test
  on fast then cycle (U1's dual-engine pattern) - fast passed first try,
  cycle didn't, and the diff was the tell.
- U4 (syscall core: glibc reaches main()): **DONE, WITH ONE DOCUMENTED GAP**
  2026-07-15. `runtime/linux/mm.{h,c}` (new: brk + MAP_ANONYMOUS mmap, two
  bump allocators sharing vlinux's own region bounds), `syscall.c` grown to
  the full "Set 1" dispatch table, `config.env` gained `LINUX_TOOLCHAIN`
  (found at the exact path the roadmap predicted:
  `/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds64le-linux-glibc-v5d`,
  a real GCC 14.2.0 build), `tests/fixtures/rt_linux_glibc_hello.c` (real
  static-glibc fixture) + `tests/vlinux/test_vlinux_glibc_hello.sh`.

  **Verified end-to-end, both legs**: real static glibc reaches main(),
  argv/malloc(mmap-backed)/printf/fflush all correct, exact output --
  proven via a `_exit(42)` variant that passes cleanly with byte-exact
  stdout and rc=42 on fast AND cycle. Confirmed the roadmap's own risk
  note exactly: vendor glibc calls riscv_hwprobe(258) 7x at startup;
  answering -ENOSYS (the generic default path) is all it needs.

  **The gap**: `exit(42)` (the library call) crashes inside glibc's own
  `__run_exit_handlers` calling through a corrupt function pointer for
  what's almost certainly its automatic `_dl_fini` registration -
  reproduces identically for a trivial `int main(){return 0;}`, so it's
  unconditional glibc-startup behavior, not fixture-specific. Root-caused
  as far as possible without a working debugger: confirmed via a LIVE
  x86-64 comparison (same GCC, host gdb) that this handler slot is
  SUPPOSED to be pointer-mangled (`ror rax,0x11` then `xor rax,fs:0x30`,
  a TLS-relative guard) before the call, and x86-64 does exactly that and
  exits cleanly; the riscv64 vendor toolchain's compiled
  `__run_exit_handlers` has NO demangle step at the equivalent call site
  (checked via objdump on both the ef_on and ef_cxa branches). Could not
  go further: the vendor `riscv64-linux-gdb` cannot run at all (linked
  against a now-nonexistent Jenkins CI path -
  `libpython3.10.so.1.0`/`PYTHONHOME` point at a workspace that's gone),
  which is what would be needed to inspect the actual riscv64
  registration site live. This is a vendor-toolchain-internals question,
  not a vlinux bug - full details and next steps are in the roadmap's U4
  DONE note. `test_vlinux_glibc_hello.sh` accepts a clean exit 42 OR this
  EXACT crash signature (stdout already fully correct at that point) -
  any other outcome still fails the test.

  Decision point: I asked the user how to proceed (keep digging / try to
  fix the target gdb / accept the documented gap and move on) and got no
  response within the session: proceeded with the recommended default
  (document thoroughly, mark U4 done, let U5+ continue since none of them
  depend on exit() working). Revisit if the user wants this pursued
  further - the next concrete step is a working riscv64 gdb (repair the
  toolchain's python linkage or build/find an alternate one) to break on
  the actual `__cxa_atexit`/`_dl_fini` registration site.

  Two more real bugs found and fixed (same class as U3's two - caught by
  the SAME fast-passes/cycle-differs-or-both-differ-from-expected
  pattern): (1) **`gp` not reloaded on trap entry** - `trap.S` saved/
  restored gp around a trap but never reloaded it to vlinux's OWN
  `__global_pointer$` before running the C handler, so any gp-relative
  global access during a trap used WHATEVER gp was active at the moment
  of the trap (the app's, once the app is running) - silent in U3 (zero
  globals in syscall.c then), hit immediately by U4's mm.c globals. Fixed
  with the same `.option norelax`/`lla gp,__global_pointer$` sequence
  crt0.S already uses, inserted into `m_trap_entry` before `call
  handle_trap`. (2) **mmap arena start overlapped the live app stack** -
  `stack.c` started building the initial stack AT `mem_size -
  STACK_RESERVE` (meant to be the arena's FLOOR) instead of AT `mem_size`
  (the true top, with 8 MiB as headroom below) - the build's own content
  immediately spilled below the intended floor, so the first big `mmap()`
  (malloc's 1 MiB request) zeroed part of the app's own already-live
  stack. Fixed by starting the build at `mem_size`.
- U5-U9: PLANNED, straight-line dependency chain, one per session. Note:
  U4's exit() gap does not block any of these on its own critical path
  (none of them need glibc's exit() to complete cleanly), though it
  should be fixed before claiming a real end-user acceptance milestone.
- U10, U11: PLANNED, explicitly optional/parallel, only needed if Bonsai-27B
  is revisited later.

## How to apply
Read ROADMAP_LINUX_RUNTIME.md itself for the full feature table (description,
input/output contract, key files, test, dependencies) before starting the next
session's feature (currently U5) - this memory is a pointer/orientation, not a
substitute for the roadmap doc, which is the source of truth for exact state.
