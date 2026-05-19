# F14 - `./hsim estimate` --icount 0 (drain at program exit)

## Context

Today `./hsim estimate <elf>` requires `--icount N` (default 10000). The user must
pick N = total insns of the program to get a correct `estimated_cycles`. For
typical workloads (e.g. user's `gemm.c`) the user does not know N upfront.
We want `./hsim estimate gemm.elf` to "just work" with no `--icount` flag.

The fix: when `--icount 0` (new default), QEMU runs the workload to its
natural exit (semihosting EXIT), the plugin drains state at exit time, and
hsim reads the retired-insn count from the drained state to use as `N_total`
in the SimPoint aggregation formula.

Plan agent flagged that QEMU's `mcycle`/`minstret` on system-mode may return
`cpu_get_host_ticks()` (wall-clock host ticks) rather than retired-insn count.
To avoid relying on QEMU PMU semantics, the plugin will maintain its own
plugin-side counter via a per-insn exec callback and write that into the
drained state file's `minstret` slot.

## Design

### Plugin changes (`qemu_plugin/hybrid_handoff.c`)

New mode `drain_at_exit=1`:

1. New static state at top of file:
   - `static int drain_at_exit_mode;`
   - `static volatile int drained_already;`
   - `static uint64_t atexit_insn_count;`

2. Parse `drain_at_exit=1` in `qemu_plugin_install` (alongside other args).

3. In `vcpu_tb_trans` insn loop, when `drain_at_exit_mode`, register a
   per-insn exec cb `on_count_tick` (NO_REGS) that increments
   `atexit_insn_count`. Registered last (BBV, slice-consume, icount, etc.
   run first if co-firing).

4. In `on_handoff`, set `drained_already = 1` at the top before any work
   (so the atexit guard works).

5. Factor `on_handoff`'s drain body into `drain_state_to_file(s_overrides...)`
   so atexit path can reuse it. Trigger path keeps `exit(200)` at end;
   atexit path calls `fflush(stderr); _exit(200);` (POSIX-safe inside atexit
   chain).

6. New `on_atexit(qemu_plugin_id_t id, void *udata)`:
   - If `drained_already` or `!drain_at_exit_mode`, return.
   - Use a synthetic `HandoffSite { kind=HYBRID_HANDOFF_ENTER, vaddr=0, size=0 }`
     so the existing PC compute path returns 0 (positive marker: atexit-drained).
   - Drain state. Override `s.minstret = atexit_insn_count;` (plugin counter,
     not QEMU PMU).
   - `_exit(200)`.

7. In `qemu_plugin_install`, when `drain_at_exit_mode`:
   `qemu_plugin_register_atexit_cb(id, on_atexit, NULL);`

### hsim changes (`hsim`)

1. `cmd_estimate`'s `--icount` default: `10000` -> `0`.
2. Help text update: "total retired insns for profile pass (default: 0
   means run to program exit and read minstret from drained state)".
3. New helper `_run_estimate_profile_pass(elf, bbv, slice, icount, mmap_size, artifacts) -> (rc, n_total)`:
   - When `icount > 0`: existing path (call `cmd_profile` via Namespace, return
     `(rc, icount)`).
   - When `icount == 0`: inline profile-pass argv with plugin extras
     `bbv_out=<path>, slice=N, drain_at_exit=1` (no `icount=`). Run QEMU,
     check rc=200. Read `minstret` from the state file via
     `orchestrator.abi.HybridStateV1.from_buffer_copy(...)`. Return
     `(0, minstret)`.
4. `cmd_estimate`: replace direct `cmd_profile` call with the helper; use
   returned `n_total` (not `args.icount`) in the formula.

### Fixture (`tests/fixtures/no_trigger_exit.c`) + Makefile entry

```c
#include <stdio.h>
int main(void) {
    long acc = 0;
    for (long i = 0; i < 2000; i++) acc += i * 3 + 7;
    printf("acc=%ld\n", acc);
    return 0;
}
```

No `csrwi 0x7C0,*` anywhere. Linked against vsim-demo C runtime crt0/libgloss_vh.
Loop is large enough that profile pass at `slice=1000` produces >= 4 BBV rows
(needed for `--max-k 2`).

### Test (`tests/hsim/test_hsim_estimate_drain_at_exit.sh`)

RED-test assertions (encoded from plan-agent watchout list):

1. `riscv64-unknown-elf-objdump -d no_trigger_exit.elf | grep -c 'csrwi.*0x7c0'` == 0.
2. `./hsim estimate --help` mentions "run to program exit" or "0 = ..." for `--icount`.
3. `./hsim estimate tests/fixtures/no_trigger_exit.elf --slice 1000 --max-k 2` exits 0.
4. Output contains `estimated_cycles=<int>` with int > 0.
5. Output contains >= 1 `delta_mcycle=<int>` row with each > 0.
6. Output mentions a non-zero N (e.g. parses `N=<int>` and asserts > 0).
7. Per-phase weighted_CPI is sensible (positive, < 100).

### Docs

1. `docs/USER_GUIDE.md`: in the estimate section, add a line about
   `--icount 0` default and the run-to-exit semantics.
2. `driver_ROADMAP.md`: append F14 entry with status `in-progress` -> `done`.

## Files to modify

- `qemu_plugin/hybrid_handoff.c` -- plugin atexit drain + counter
- `hsim` -- cmd_estimate default + new helper
- `tests/fixtures/no_trigger_exit.c` -- NEW fixture
- `tests/fixtures/Makefile` -- add fixture target
- `tests/hsim/test_hsim_estimate_drain_at_exit.sh` -- NEW RED test
- `docs/USER_GUIDE.md` -- estimate section
- `driver_ROADMAP.md` -- F14 entry

## Reused helpers

- `_qemu_drain_argv(qemu, elf, plugin, shm, size, state, plugin_extras=...)` at
  `hsim:682` -- already supports arbitrary plugin extras tuple; just pass
  `drain_at_exit=1` instead of `icount=N`.
- `orchestrator.abi.HybridStateV1` at `tools/orchestrator/abi.py` -- already
  exposes a `ctypes` layout with `minstret` field; reused for reading.
- `_load_hsim_shm().allocate(...)` -- shared mmap allocation, unchanged.
- `_PROFILE_TIMEOUT_S = 30` at `hsim:665` -- profile timeout, may need to
  raise for natural-exit runs of large programs (defer until needed).

## TDD order (commits)

1. **structural**: factor `on_handoff` drain body into `drain_state_to_file()`
   helper. No behavior change. Run existing test suite to verify.
2. **behavioral**: plugin `drain_at_exit=1` mode + atexit cb + insn counter.
   hsim `cmd_estimate` default 0 + new helper. Fixture + RED test. Docs.

Rebuild plugin: `make -C qemu_plugin QEMU_ROOT=./QEMU`.
Rebuild fixture: `make -C tests/fixtures no_trigger_exit.elf`.

## Verification

End-to-end:

```sh
# Plugin + fixture rebuild
make -C qemu_plugin QEMU_ROOT=./QEMU
make -C tests/fixtures no_trigger_exit.elf

# RED test (new)
bash tests/hsim/test_hsim_estimate_drain_at_exit.sh

# Regression: existing estimate test still works
bash tests/hsim/test_hsim_estimate.sh

# Manual smoke: user's gemm.elf with no --icount
./hsim estimate gemm.elf --slice 5000 --max-k 4
# Expect: estimated_cycles=<int> reflecting the FULL program, not 10000 insns.

# Full e2e regression (per driver_ROADMAP.md global invariant)
JOBS=8 MODE=both bash scripts/run_e2e.sh   # still 45 PASS / 0 FAIL
```

Watch-out items the test must assert:
- objdump confirms no `csrwi 0x7c0` in fixture
- exit code 0 from `./hsim estimate`
- output has `estimated_cycles=<int>` line
- output has at least one `delta_mcycle=<int>` row with > 0
