# Code/Test/Doc Inconsistency Review

## Context

The user asked to review all code, test cases, and documents for inconsistency and legacy code. The repo is mid-completion of F14 (`./hsim estimate --icount 0` = drain at program exit): the F14 ROADMAP entry says "done" but the implementing changes are still uncommitted across 6 modified files + 2 untracked test files. Three stray test artifacts (`gemm.c`, `gemm.elf`, `hello.c`) also sit at the repo root.

This review pulls together findings from three parallel audits (hsim+docs, source code, tests) plus targeted file verification. Issues fall into 4 buckets ordered by cost/value.

---

## Bucket A - Quick doc/cleanup wins (low cost)

| # | File | Issue | Fix |
|---|------|-------|-----|
| A1 | `docs/USER_GUIDE.md:1` | First line is `[#](#) Hybrid Simulator User Guide` (broken markdown link instead of `#` heading) | Replace with `# Hybrid Simulator User Guide` |
| A2 | `CLAUDE.md:24` | `./hsim run <elf> --mode csr\|pc` - missing `icount\|slice` modes (code has 4) | Update to `--mode csr\|pc\|icount\|slice` |
| A3 | `docs/USER_GUIDE.md:61` | Cheat-sheet row says `--mode csr\|pc [-v]` - same omission | Update to `--mode csr\|pc\|icount\|slice [-v]` |
| A4 | `gemm.elf` (repo root) | 56KB untracked binary build artifact | Delete + add `*.elf` rule to `.gitignore` at repo root scope |
| A5 | `hello.c` (repo root) | Untracked, malformed (`int int main(...)`) - junk stub | Delete |
| A6 | `gemm.c` (repo root) | Untracked, referenced in F14 ROADMAP as narrative-only motivation. Builds with host gcc, not a RV fixture. | Delete (per user). |

**Verification:** `git status` clean after; `grep --mode CLAUDE.md docs/USER_GUIDE.md hsim` agrees across all 4 modes.

---

## Bucket B - F14 completion (close out in-flight feature)

The F14 ROADMAP at `driver_ROADMAP.md:498-545` lists 7 done criteria. The implementing changes are uncommitted:

```
M  docs/USER_GUIDE.md           - adds section 4.6.5 (estimate --icount 0)
M  driver_ROADMAP.md            - adds F14 entry, marked done
M  hsim                         - cmd_estimate F14 path + _run_drain_at_exit_profile
M  qemu_plugin/hybrid_handoff.c - drain_at_exit mode + on_count_tick + atexit cb
                                  + on_handoff refactored to drain_state_to_file
M  tests/fixtures/Makefile      - adds no_trigger_exit to RT_C_FIXTURES
?? tests/fixtures/no_trigger_exit.c       - new fixture, naturally exits
?? tests/hsim/test_hsim_estimate_drain_at_exit.sh - new RED test
```

**Per project TDD.md**: split structural from behavioral. Suggested commit order (mirrors F11/F12/F13 pattern in `git log`):

1. **structural #1**: factor `on_handoff` body into `drain_state_to_file` helper (plugin only, no behavior change). Verify all e2e tests still pass.
2. **behavioral #1 (RED)**: add `tests/fixtures/no_trigger_exit.c` + Makefile entry + RED test `tests/hsim/test_hsim_estimate_drain_at_exit.sh`. Confirm test FAILS for the expected reason (no F14 logic yet).
3. **behavioral #2 (GREEN)**: add plugin `drain_at_exit_mode` + atexit cb + insn counter; change hsim `cmd_estimate` default `--icount 0` + helper. Test goes green.
4. **structural #2**: USER_GUIDE.md section 4.6.5 + ROADMAP F14 entry.

**Open sub-items inside F14:**
- B7 `docs/USER_GUIDE.md` plugin-args table at section 2.3 (lines ~315-323) does NOT list `drain_at_exit=1`. Add row: `| drain_at_exit=1 | F14: drain on program exit; overrides minstret with plugin per-insn counter |`.
- B8 Register `tests/hsim/test_hsim_estimate_drain_at_exit.sh` in a CI harness. Currently `scripts/run_e2e.sh` does not run anything under `tests/hsim/`. Either:
  - add a `tests/hsim/run_all.sh` wrapper to be invoked by `./hsim test`, OR
  - document as manual-only and note in the ROADMAP F14 done criteria.
- B9 Consider renaming fixture to `rt_c_no_trigger_exit` for consistency with the `rt_c_*` family (all other C-level fixtures follow this prefix). The Makefile `RT_C_FIXTURES` currently lumps it in without the prefix.

---

## Bucket C - Architectural doc gaps (CLAUDE.md)

These are real design choices that need a single-line note so a future maintainer doesn't think they're bugs.

| # | Topic | Where to document |
|---|-------|-------------------|
| C1 | QEMU plugin drains 11 M-mode CSRs (mepc, mcause, mtval, mscratch, medeleg, mideleg, mip, mie, satp, mcycle, minstret). ResumeDriver restores only 4 (mstatus, mtvec, mcycle, minstret). The other 7 are restored via QEMU2's gdbstub. Intentional - vsim phase doesn't execute trap-taking code - but invisible. | Add to CLAUDE.md "Three-Phase Handoff" section: a one-line note "Trap CSRs (mepc/mcause/mtval/mscratch/medeleg/mideleg/mip/mie/satp) are restored only on QEMU2 via gdbstub; vsim phase is assumed trap-free." |
| C2 | PMP CSRs drained by QEMU1, restored by QEMU2 gdbstub. vsim StateDrain/ResumeDriver ignore PMP entirely. | Same section, one sentence: "PMP (64 pmpaddr + 16 pmpcfg) is also QEMU2-only." |
| C3 | `include/hybrid/state_abi.h` doesn't document wire-format endianness. Native LE assumed. | One comment line above struct definition: "Multi-byte fields are little-endian (native on RV64 + x86-64 host)." |

---

## Bucket D - Test coverage gaps

| # | File | Status |
|---|------|--------|
| D1 | `verilator/tests/hybrid/program_buffer.test.cpp` | Exists but NOT registered in `verilator/cmake/HybridConfig.cmake`. Add to the doctest registration block alongside `csr_trigger.test.cpp`, `icount_trigger.test.cpp`, etc. |
| D2 | `verilator/src/hybrid/exit_codes.hpp` | Pure constants header. No tests needed. |
| D3 | `verilator/src/hybrid/dmi_poll.hpp` | No `*.test.cpp`. Decide: test directly, or accept it as covered by `resume_driver.test.cpp` / `state_drain.test.cpp` callers. |
| D4 | `verilator/src/hybrid/gdbstub_session.hpp` | Tested indirectly via `gdbstub_client.test.cpp` + `RecordingSession` in `qemu_handback.test.cpp`. Acceptable. |
| D5 | `verilator/src/hybrid/systemc_dmi_bus.hpp` | SystemC-coupled; can only test in integration. Acceptable. |

---

## Bucket E - Items I deliberately did NOT flag

For transparency, items the audit raised that I'm leaving alone:

- `volatile drained_already` in plugin: POSIX atexit runs after threads join, fine.
- `fprintf(stderr, ...)` in plugin/handback: informational, useful in test logs.
- Stale "unused insn" comment in `csr_trigger.hpp:62`: confirmed `insn` IS unused by callers; comment is correct.
- No `TODO`/`FIXME`/`HACK` markers anywhere in `qemu_plugin/`, `verilator/src/hybrid/`, `scripts/`, or `hsim`. Clean.

---

## Confirmed scope and execution order

User confirmed: address all four buckets (A, B, C, D); delete `gemm.c` along with `gemm.elf` and `hello.c`.

Execution order: A -> B -> C -> D. Rationale:
- A is independent and quickly checkpoints the repo to a clean baseline before bigger work.
- B is the largest unit and lands the in-flight F14 feature with proper TDD commit split.
- C is a single CLAUDE.md edit that follows B (so the new F14 plugin internals are also covered if relevant).
- D is the final CTest registration commit.

**Commit plan (chronological):**

1. structural: A1+A2+A3 (3 doc fixes - 1 commit)
2. structural: A4+A5+A6 (delete gemm.elf + hello.c + gemm.c - 1 commit)
3. structural: B step 1 - factor `on_handoff` -> `drain_state_to_file` helper in plugin (no behavior change). Run e2e.
4. behavioral: B step 2 - RED test: add `tests/fixtures/no_trigger_exit.c` + Makefile entry + `tests/hsim/test_hsim_estimate_drain_at_exit.sh`. Confirm RED.
5. behavioral: B step 3 - GREEN: plugin drain_at_exit mode + hsim cmd_estimate default change + helper. Test goes green.
6. structural: B step 4 - USER_GUIDE.md section 4.6.5 + ROADMAP F14 entry + drain_at_exit plugin-args row (B7).
7. structural: B step 5 - register the new shell test in CI (B8) AND consider rename to `rt_c_no_trigger_exit` (B9) if user agrees; otherwise leave naming.
8. structural: C1+C2+C3 - 3 CLAUDE.md/state_abi.h doc notes (1 commit).
9. structural: D1 - register `program_buffer.test.cpp` in HybridConfig.cmake.

Each commit message prefix: `structural:` or `behavioral:` per project TDD.md.

## Critical files referenced

- `/home/nick/work/hybrid_sim/hsim` (driver)
- `/home/nick/work/hybrid_sim/qemu_plugin/hybrid_handoff.c` (plugin)
- `/home/nick/work/hybrid_sim/docs/USER_GUIDE.md`
- `/home/nick/work/hybrid_sim/CLAUDE.md`
- `/home/nick/work/hybrid_sim/driver_ROADMAP.md`
- `/home/nick/work/hybrid_sim/tests/fixtures/Makefile`
- `/home/nick/work/hybrid_sim/tests/fixtures/no_trigger_exit.c`
- `/home/nick/work/hybrid_sim/tests/hsim/test_hsim_estimate_drain_at_exit.sh`
- `/home/nick/work/hybrid_sim/verilator/cmake/HybridConfig.cmake`
- `/home/nick/work/hybrid_sim/include/hybrid/state_abi.h`

## Verification

- `git status` clean (no untracked files in repo root, all M files committed).
- `git log --oneline -10` shows 4 F14 commits (2 structural, 2 behavioral) per TDD order.
- `./hsim test --filter no_trigger_exit` and `./hsim estimate tests/fixtures/no_trigger_exit.elf --slice 1000 --max-k 2` both pass.
- `JOBS=8 MODE=both bash scripts/run_e2e.sh` still 45 PASS / 0 FAIL.
- `bash tests/hsim/test_hsim_estimate_drain_at_exit.sh` passes.
- `grep -n "csr|pc[^|]" CLAUDE.md docs/USER_GUIDE.md` returns nothing outside intentional historical references.
