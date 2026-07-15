# Port demos from vsim-demo-new into andesim-demo

## Context

The old suite `/local/nick/vsim-demo-new` has 17 demos. The task: study which ones are worth moving into `/home/nick/work/andesim-demo` (the andesim driver demo repo: one ELF, three modes - fast/QEMU, cycle/vsim, hybrid).

Study result (verified against sources, engine cfgs, runtime, and vsim platform code):

| vsim-demo-new demo | Verdict | Evidence |
|---|---|---|
| hello, coremark, dhrystone, rvv, syscall | already covered | direct equivalents in SUBDIRS |
| lm_test, hvm_test | already covered | lm/lm_slave/lm_dma + hvm_slave/hvm_dma use real transports, not the sim-control backdoor (0xe0080000 = 0xabcdeX) |
| hybrid, savable_feat | covered by design | the repo's hybrid mode + `verify` demo ARE the save/restore story; driver has no --save/--resume |
| **atomic-test** | **PORT NOW** | rv64gc baseline; no infra gap; nothing in andesim-demo tests LR/SC/AMO |
| **negative_test** | **PORT NOW** | andesim runtime handler.c already prints `[ERROR] ... mcause` and `_exit(mcause)`; only a check.sh is missing |
| cpp | TODO (runtime gap) | `andesim/runtime/crt0.S` calls `init_mtvec` directly and never walks `.init_array`; C++ static ctors will not run; `andesim.specs` has no C++ libs |
| smp-test | BLOCKED | all registered engines have `NDS_NHART=1`; mp2 cfgs exist (`ax45mpv_mp2`, `ax66_mp2`, NHART=2) but no engine is built/registered; runtime `CRT0_MULTIPLE_HARTS=0`; driver has no multi-hart handoff |
| platform pit/plic/aia | BLOCKED | `vsim_andesim/src/platform/` models only UART/SMU/SimControl - no PLIC/PLMT/PIT; QEMU ae350 has them, so cycle/hybrid legs are impossible until the vsim platform grows them |
| ace, ace-rvv | NOT PORTABLE | need COPILOT toolflow + csim lib (`libaceasim.a`) baked into the simulator build; QEMU cannot execute ACE custom instructions, so fast mode, hybrid staging, and the --verify oracle all break |
| acervv46quad | NOT PORTABLE | sources missing (only a Makefile referencing absent files + a private GEN_API tool) |

Deliverable: two new demos (`demo/atomic`, `demo/trap`), ROADMAP entries for the study outcome, README sections + matrix rows, engine sweep of the new demos reported per CLAUDE.md rule.

## Feature 1: demo/atomic (from atomic-test)

New files: `demo/atomic/main.c`, `demo/atomic/Makefile`.
Edits: top `Makefile` (SUBDIRS + `atomic-%:` forwarding rule), `README.md` (section + matrix row), `ROADMAP.md` (entry, state DONE when merged).

Design - port the 4 tests, with one deliberate change:
- T1: LR/SC pair succeeds (sc=0) and commits the value. (as source)
- T2 REDESIGNED: source T2 breaks the reservation with a same-hart store; the ISA only guarantees SC failure for other-hart writes, so QEMU (value-compare cmpxchg) and RTL (monitor) could legitimately diverge. Replace with the architecturally-guaranteed case: LR, SC (succeeds and consumes the reservation), second SC to the same address MUST fail and MUST NOT write ("executing an SC invalidates any reservation held by this hart"). State this in a comment.
- T3: amoswap.w returns old value, writes new. (as source)
- T4: 5x amoadd.w +7 on 100 == 135. (as source)

andesim conventions:
- Tests live in a `noinline` non-static `atomic_kernel()` between `andesim_ROI_begin()/end()` (include `<andesim/ROI.h>`); `.globl atomic_kernel_roi_end` label right after the call for `--pc-end` (copy the `demo/hello` / `demo/rvv` shape).
- `shared` is `static volatile uint32_t` in .bss (DDR at 0x100000+, crosses the hybrid handoff via the shared mmap). All LR/SC pairs are entirely inside the ROI - a reservation is microarchitectural and cannot cross the QEMU->vsim handoff; say so in a comment.
- Pass signal: print `ATOMIC_OK` inside the ROI only if all 4 pass; return 0/1 from main.
- Makefile: copy `demo/hello/Makefile`; `CFLAGS` default from Make.var (rv64gc includes A); targets `atomic-fast`, `atomic-cycle`, `atomic-hybrid-marker`, `atomic-hybrid-pc`; `run:` runs all four.
- No engine gating needed (A-extension + baseline on all three engines).

TDD: RED = `make check-atomic` before the demo exists fails; GREEN = implement until `make check-atomic` passes on the default engine.

## Feature 2: demo/trap (from negative_test)

New files: `demo/trap/main.c`, `demo/trap/Makefile`, `demo/trap/check.sh`.
Edits: top `Makefile` (SUBDIRS + `trap-%:` rule), `README.md`, `ROADMAP.md`.

Design - "a faulting guest must fail loudly on every engine":
- main.c: print a banner, then execute the illegal instruction from the source demo (`.insn r 0x7f, 0, 0, x0, x0, x0`); fall back to `unimp` if engines disagree on mcause. Expected: runtime `handler.c` prints `[ERROR] Trap occurred! ... mcause: 0x2` and `_exit(2)`; the driver exit code becomes 2.
- Modes: fast + cycle only. Hybrid's pass signal is a printed marker and this demo's whole point is the exit-code contract; note that in the README section.
- `run:` target inverts (`!` prefix) so a correct fault reads as success, mirroring the source demo's expected-fail logic.
- check.sh (copy the assert helper from `demo/memsize/check.sh`): fast leg and cycle leg each assert rc==2 AND stderr matches `Trap occurred`. Loud failure if the guest does NOT trap (rc 0) or the cause differs.

TDD: RED = write check.sh + Makefile first, run `make check-trap`, watch it fail (no main.c); GREEN = add main.c.

## Feature 3: docs - ROADMAP + README study record

- ROADMAP.md: add entries `atomic` (DONE), `trap` (DONE), `cpp` (TODO - names the crt0 `.init_array` gap and specs work in the andesim repo), `smp` (BLOCKED - no registered NHART>1 engine; mp2 cfgs exist; CRT0_MULTIPLE_HARTS; driver handoff), `irq` (BLOCKED - vsim platform has no PLIC/PLMT). Each entry: Key files, Pass condition, Deps, blocking layer - same shape as existing entries.
- README.md: short sections for atomic + trap (what each proves), matrix rows for both.
- Record the not-portable rationale (ace*, savable_feat) in one short ROADMAP note so the study is not re-done later.

## Verification

1. Per demo during development: `make check-atomic`, `make check-trap` on the default engine.
2. Targeted engine sweep: for each of `vsim:ax45mpv_premium`, `vsim:ax46mpv_advanced`, `vsim:ax66_makatau` run `make check ENGINE=<e> SUBDIRS="demo/atomic demo/trap"`.
3. Report the demo x engine PASS/FAIL/SKIP table per CLAUDE.md rule (expected: all 6 cells PASS - no LM/HVM/VLEN gate applies); name the blocking layer for any surprise.
4. `git status` clean of stray artifacts; `.elf`/`.dump` checked in like other demos.

## Commits (repo discipline: behavioral vs structural, one logical unit each)

1. `feat(atomic): LR/SC + AMO contract demo ... (behavioral)` - demo/atomic + top Makefile wiring + its README/ROADMAP lines.
2. `feat(trap): expected-fail illegal-instruction demo ... (behavioral)` - demo/trap + wiring + docs lines.
3. `docs: port study of vsim-demo-new - cpp/smp/irq entries, non-port rationale (structural)`.

## Out of scope (recorded, not implemented)

- cpp port (needs andesim runtime crt0/specs work - separate repo, future session).
- smp, irq demos (blocked on engine/platform infra as above).
- ace family, savable_feat (not portable; rationale in ROADMAP note).
