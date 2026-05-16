# Hybrid Sim: gem5 CPU-Switch Parity - Design & ROADMAP

## Context

The spec at `specs/hybrid-sim-gem5-switch-parity.md` documents that the hybrid simulator (QEMU + vsim) implements only one of gem5's four CPU-switch mechanisms: the guest-driven CSR/PC trigger. Three more are missing:

- **Instruction-count switch** - third-party binaries cannot embed the magic CSR.
- **Phase-boundary switch (BBV/SimPoint)** - workload-phase entries cannot be detected.
- **Checkpoint replay** - state files are transient; no archive format exists.

A second mismatch: today's pipeline is linear and one-shot (QEMU1 -> vsim -> QEMU2 hardcoded in `hybrid_vsim/src/main.cpp:478-490`). SimPoint K=10 needs K independent (snapshot, replay) pairs.

**This session's output** (per user-confirmed scope): a design document + `ROADMAP.md` feature tracker. NO code is written in this session. Each ROADMAP feature is implemented in its own subsequent session per the user's "one feature per session" convention.

**Decisions confirmed by user before writing this plan:**
- Orchestrator language: Python with ctypes ABI binding.
- Multi-hart: out of scope for v1; plan-validation rejects `hart_id != 0`.
- Snapshot retention: manual (user manages `snap/` disk); no auto-pruning in v1.

## Core Architecture

Three layers. The redesign separates policy (trigger sources) from orchestration (spawn sequencing) from CPU processes (drain/restore). This is the precondition for adding triggers without forking the spawn path.

```
+------------------------------------------------------------+
| POLICY LAYER (trigger sources)                             |
|   CSR/PC trigger      - today, in plugin + vsim            |
|   icount trigger      - NEW, in plugin + vsim              |
|   BBV phase trigger   - NEW, in plugin (emit + consume)    |
|   checkpoint trigger  - NEW, orchestrator-only (load-time) |
+------------------------+-----------------------------------+
                         | "process exited with code 200"
                         v
+------------------------------------------------------------+
| ORCHESTRATOR (single owner; NEW Python package)            |
|   tools/orchestrator/                                      |
|     main.py        - session driver, queue of spawns       |
|     plan.py        - YAML plan grammar dataclass           |
|     mmap_owner.py  - holds /dev/shm fd for whole session   |
|     abi.py         - ctypes binding of state_abi.h         |
|     spawn.py       - QEMU/vsim subprocess factory          |
|     checkpoint.py  - snap/<N>/{state.bin,mem,meta.json}    |
|                                                            |
|   REPLACES: in-process spawn in main.cpp:478-490           |
|   REPLACES: bash logic in rt_shared_mem.sh                 |
+------------+-----------------------------+-----------------+
             | --state-in/out, --mem-path, --trigger-spec
             v                             v
   +----------------+              +-----------------+
   | QEMU process   |  state.bin   | vsim process    |
   | qemu_plugin/   |<------------>| src/hybrid/     |
   | hybrid_handoff |   V scratch  | handoff_ctrl    |
   +----------------+   (mmap)     +-----------------+
            \                              /
             \  /dev/shm guest-RAM mmap   /
              \ (orchestrator-owned fd)  /
               +------------------------+
```

**Architectural takeover point.** `hybrid_vsim/src/main.cpp:478-490` today reads the state file and directly invokes `hybrid::run_qemu_handback()` in-process. The redesign removes this block: vsim returns `kExitHandoffToQemu = 200` and exits. The external Python orchestrator catches code 200, validates the state file, and consults its plan for the next spawn. The C++ helpers in `qemu_handback.hpp` (gdbstub register-map discovery, P-packet apply_state) are repackaged as a small CLI helper `tools/hybrid_apply_state` that the orchestrator invokes - no rewrite of the well-tested gdbstub logic.

**Why three layers and not two.** Today the orchestrator is fused with the policy layer in two places: `qemu_handback.hpp` decides spawn shape, and the plugin both detects CSR firing and drains. Separation makes adding triggers additive: a new trigger only adds a *reason* to set `should_exit = true`; no new exit path, no new spawn path.

## Trigger Surface Contracts

All four triggers route through the same quiesce-handoff-resume protocol (spec section 3.4). They differ only in WHERE the `should_exit` flag gets set.

| Trigger | Owner | New CLI flags | ABI changes | Priority when co-firing |
|---|---|---|---|---|
| CSR / PC | QEMU plugin + vsim | none (existing) | none | **highest** |
| icount | QEMU plugin + vsim | plugin: `icount=N`; vsim: `--hybrid-icount N` | none | **lowest** |
| BBV phase | QEMU plugin only | profile: `bbv_out=PATH,slice=N`; consume: `slice_at=PATH` | none | **middle** |
| Checkpoint | orchestrator only | `orchestrator replay-checkpoint <dir>` | none | n/a (load-time) |

**Zero new ABI fields.** `include/hybrid/state_abi.h`'s 232 reserved bytes stay intact. New triggers do not need new fields - they reuse `minstret` (already drained) and the existing `flags`/`hart_id` fields.

**Priority resolution** (per spec section 5 row 1). When two trigger conditions match the same retired insn, the per-insn callback applies a fixed order: try CSR/PC first; if matched, drain and return. Else try BBV-phase; if matched, drain and return. Else increment icount and test. Only one trigger wins a single insn.

**Quiesce invariant.** Plugin still calls `on_handoff()` at `qemu_plugin/hybrid_handoff.c:187` and writes the state file via `write_state_atomic()` (temp+fsync+rename). vsim still routes through `Simulator::check_hybrid_handoff()` at `hybrid_vsim/src/simulator.hpp:452-489` which calls `HandoffController::on_retire()` at `hybrid_vsim/src/hybrid/handoff_controller.hpp:38`. The orchestrator does not learn WHY the process exited; only THAT it exited cleanly with a valid state file.

**Exit-code rebrand.** Plugin currently exits 0 on drain (`qemu_plugin/hybrid_handoff.c:261`). vsim already exits 200 (`hybrid_vsim/src/hybrid/exit_codes.hpp:7 kExitHandoffToQemu = 200`). Feature F1 makes the plugin match vsim: 200 = drained, 0 = workload completed.

## Orchestrator Design (Python + YAML)

**Package layout.** `tools/orchestrator/` ships with:
- `main.py` - CLI entry (`run`, `replay-checkpoint`, `dry-run`).
- `plan.py` - YAML parser + dataclass for `Session`, `Step`, `TriggerSpec`.
- `mmap_owner.py` - RAII wrapper around the `/dev/shm` mmap fd (created at session start via `tempfile.NamedTemporaryFile(dir='/dev/shm')` + `os.ftruncate`).
- `abi.py` - ctypes mirror of `hybrid_state_v1`; reads the layout-check macros emitted by `include/hybrid/state_abi_check.h` to assert field offsets match the live binary at import time.
- `spawn.py` - `subprocess.Popen` factory for QEMU and vsim, with a uniform `--state-in/--state-out/--mem-path/--trigger-spec` arg convention.
- `checkpoint.py` - archive write (`snap/N/{state.bin,mem,meta.json}`) + replay-load.

**Trigger-plan grammar (YAML).**

```yaml
session:
  mem_size: 134217728       # 128 MB, matches today's rt_shared_mem.sh
  mmap_path: null           # null => orchestrator mktemp -p /dev/shm
  elf: hybrid_vsim/hybrid/test/build/rt_c_v_regs.elf

steps:
  - model: qemu
    trigger: { kind: icount, n: 5000000000 }
    on_exit: { archive_as: "snap/0" }

  - model: vsim
    trigger: { kind: csr }
    on_exit: { archive_as: "snap/1" }

  - model: qemu
    trigger: { kind: end_of_program }
```

Each step becomes a `Spawn(model, trigger_spec, post_exit_actions)`. The orchestrator iterates spawns in order; after each exit, validates the state file (magic 0x42594841, version 1, exact size), optionally archives, and proceeds.

**CLI shortcuts** preserve today's ergonomics: `orchestrator run-fixture rt_c_v_regs --mode csr` is shorthand for a 3-step YAML (QEMU prefix -> vsim ROI -> QEMU2 finish).

## Checkpoint Archive Layout

```
snap/<N>/
  state.bin              # raw hybrid_state_v1 (magic 0x42594841)
  mem                    # /dev/shm mmap snapshot at checkpoint moment
  meta.json              # human-readable; describes the archive
```

`meta.json` schema:

```json
{
  "schema": 1,
  "abi_version": 1,
  "abi_magic": "0x42594841",
  "cpu_variant": "ax45mpv_premium",
  "flags": ["RV64", "FP", "V"],
  "vlen_bytes": 64,
  "mem_size": 134217728,
  "elf_path": "hybrid_vsim/hybrid/test/build/rt_c_v_regs.elf",
  "region_id": "simpoint_slice_3",
  "slice_index": 3,
  "captured_at": "2026-05-16T...",
  "source_step_index": 2
}
```

**Replay protocol.** `orchestrator replay-checkpoint <dir> --resume-with {qemu|vsim} [--until <trigger_spec>]`:
1. Validate `state.bin` and `meta.json`. Reject if `cpu_variant` or `vlen_bytes` mismatches the live binary (spec section 5 row 4).
2. Create new `/dev/shm` mmap; `cp --reflink=auto snap/<N>/mem <new_mmap>` (reflink on btrfs/xfs, falls back to sequential copy elsewhere).
3. Copy `state.bin` to working state-file path.
4. Spawn the chosen model with `--state-in` and the optional `--until` trigger-spec.

No CPU code change for checkpoint replay - the orchestrator hydrates inputs and spawns cold.

## N-Way Switching: Dissolve `qemu_handback`'s Spawn

The N=1 assumption lives at `hybrid_vsim/src/main.cpp:478-490`: when vsim's `run()` returns 200, main reads the state file and directly calls `hybrid::run_qemu_handback()`. This fuses the orchestrator into vsim's main and hardcodes "next process = QEMU2".

**The cutover** (executed as part of Feature F4): delete lines 478-490 of `main.cpp`. vsim just exits 200; main returns. The orchestrator (external) catches 200, decides the next spawn per its plan.

**What survives.** `qemu_handback.hpp`'s state-restore logic (`run_qemu_handback`'s body: `pick_free_port` at lines 41-63, `apply_state` P-packet sequence at lines 287-335, gdbstub register-map discovery, etc.) becomes a small CLI helper `tools/hybrid_apply_state` invoked by the orchestrator. ~200 lines of well-tested code are preserved, not rewritten.

**What dissolves.** The fork+exec wrapper, the `spawn_qemu` argv composition (line 373), and the implicit assumption that vsim spawns the next process all move into the Python orchestrator's `spawn.py`.

## Critical Files (read-only references for implementation sessions)

| File | Role | Lines of interest |
|---|---|---|
| `qemu_plugin/hybrid_handoff.c` | TCG plugin: trigger detect + drain | `:187` on_handoff, `:261` exit(0)->exit(200), `:264-300` vcpu_tb_trans, `:302-339` arg parser |
| `include/hybrid/state_abi.h` | Wire format (ABI-locked) | full file; 232 reserved bytes at end |
| `include/hybrid/insn_match.h` | csrwi 0x7C0 imm 0/1 matcher | full file |
| `hybrid_vsim/src/hybrid/handoff_controller.hpp` | Trigger dispatch | `:38` on_retire (template param trigger) |
| `hybrid_vsim/src/hybrid/csr_trigger.hpp` | Existing CSR trigger | `:34` class; duck-type ref for IcountTrigger |
| `hybrid_vsim/src/hybrid/qemu_handback.hpp` | In-process QEMU2 spawn (to dissolve) | `:41-63` pick_free_port, `:287-335` apply_state, `:364` run_qemu_handback, `:373` spawn_qemu |
| `hybrid_vsim/src/hybrid/exit_codes.hpp` | kExitHandoffToQemu = 200 | `:7` |
| `hybrid_vsim/src/simulator.hpp` | Per-commit hook | `:452-489` check_hybrid_handoff |
| `hybrid_vsim/src/main.cpp` | N=1 fusion site (to remove) | `:466-472` arg parsing, `:478-490` in-process QEMU2 spawn |
| `hybrid_vsim/tests/hybrid/rt_shared_mem.sh` | Bash harness (to be wrapped) | `:66` mmap mktemp, `:90-97` QEMU1, `:106-113` vsim |
| `hybrid_vsim/cmake/HybridConfig.cmake` | CTest registration | `:108-238` per-fixture |
| `docs/simpoint_transport_comparison.md` | Shared-mmap chosen | full file |
| `hybrid_plan.md` | Section 9 mmap alignment | `:462-590` |

## ROADMAP.md Content

The ROADMAP.md to be created at `/home/nick/work/hybrid_sim/ROADMAP.md` contains 11 features. The DAG below allows F5/F6/F7 to parallelize after the infrastructure layer (F1-F3) lands.

```
F1 (exit-code rebrand)      ----+
                                |
F2 (orchestrator skeleton)  ----+----> F4 (run today's CSR e2e via orchestrator)
                                |
F3 (ctypes ABI + validator) ----+
                                |
F5 (icount in plugin)       ----+----> F6 (vsim IcountTrigger)
                                |
                                +----> F7 (BBV emission plugin)
                                |
F8 (orchestrator N-way) <-------+----> F9 (checkpoint archive) -> F10 (checkpoint replay)
                                |
                                +----> F11 (BBV slice-consume trigger)
```

Each feature in the ROADMAP carries: name, description, status, key files, dependencies, TDD entry test. Status starts at `not-started`. See the verification section below for the exact ROADMAP.md content.

**Migration order (first 3 features to ship):**

- **F1 first**: structural-only, two-file change, unlocks "orchestrator distinguishes drain (200) from completion (0)" semantics. Every downstream feature reads the exit code.
- **F2 second**: pure new code under `tools/orchestrator/`, zero risk to existing path. Establishes the Python package + plan grammar + CI hook.
- **F3 third**: ABI binding is the load-bearing contract enforcement that gates every later feature.

After F1-F3 ship, F5/F6/F7 can be developed in parallel by different sessions because they touch independent files (plugin, vsim trigger, plugin BBV sub-module).

## Verification

This session is design-only; verification = the ROADMAP.md file exists at `/home/nick/work/hybrid_sim/ROADMAP.md` with the 11 features below, the DAG, and per-feature TDD RED entry tests.

**Per-feature verification** (recorded in ROADMAP, executed in subsequent sessions):

- F1: `./build_qemu.sh && ./build_vsim.sh && bash run_e2e.sh` - the plugin now exits 200 on drain; rt_shared_mem.sh asserts the new code.
- F2: `python -m pytest tools/orchestrator/tests/test_plan_parses.py` passes.
- F3: `python -m pytest tools/orchestrator/tests/test_abi_roundtrip.py` round-trips a C-emitted state.bin.
- F4: `ctest -R rt_c_v_regs--orchestrator` passes against today's behavior, verifying parity.
- F5: `qemu --plugin libhybrid_handoff.so,outfile=...,icount=100000` on a CSR-less fixture drains at exactly minstret=100000.
- F6: `ctest -R icount_trigger_unit` (doctest) drives N retires on a `RecordingBus`, drain fires at N.
- F7: A `.bb` file emitted with `slice=10000` has N rows matching the dynamic insn budget.
- F8: A 3-step YAML plan (QEMU -> vsim -> QEMU) round-trips correctly with valid state files at each boundary.
- F9: `snap/0/{state.bin,mem,meta.json}` exists post-spawn; `state.bin` byte-matches the in-flight file.
- F10: `replay-checkpoint snap/0 --resume-with vsim` runs and drains a state file whose GPRs match the archive.
- F11: A 3-slice list triggers exactly 3 drains at the expected dynamic insn counts.

**Final session verification:**
1. `ls /home/nick/work/hybrid_sim/ROADMAP.md` exists.
2. Open the file; confirm 11 features each have name, description, status=not-started, key files, dependencies, TDD test.
3. Confirm the DAG sketch matches the plan above (F1-F3 unblock F4-F11; F5/F6/F7 parallel; F8 unlocks F9->F10).
4. No code files are modified in this session.

## ROADMAP.md - Exact File Content to Write After Plan Approval

```markdown
# ROADMAP: gem5 CPU-Switch Parity

Tracks 11 independent features to extend hybrid_sim (QEMU + vsim) with the four
CPU-switch mechanisms from `specs/hybrid-sim-gem5-switch-parity.md`. One
session = one feature. Update status when starting (in-progress) and on
completion (done).

## Status Legend

- not-started: feature has not begun
- in-progress: currently being implemented in a session
- done: behavioural+structural commits landed and tests pass

## Dependency DAG

```
F1 ----+----> F4
F2 ----+
F3 ----+
F5 ----+----> F6
       +----> F7
       +----> F8 ----> F9 ----> F10
       +----> F11
```

## Features

### F1 - Rebrand plugin drain-exit code 0 -> 200

- Status: not-started
- Type: structural
- Description: Today `qemu_plugin/hybrid_handoff.c:261` exits 0 on drain;
  workload completion and drain are indistinguishable. vsim already exits
  200 (`hybrid_vsim/src/hybrid/exit_codes.hpp:7`). Bring the plugin in
  line. The orchestrator (F2+) relies on this distinction.
- Key files:
  - `qemu_plugin/hybrid_handoff.c:261`
  - `hybrid_vsim/tests/hybrid/rt_shared_mem.sh` (exit-code assertions)
  - `hybrid_vsim/tests/hybrid/roundtrip_e2e.sh`
- Dependencies: none
- TDD RED: a test in `tests/hybrid/test_plugin_drain_exit_code.sh` runs
  the plugin with a CSR fixture and asserts QEMU exits with code 200.
  Fails on today's 0.

### F2 - Orchestrator skeleton (Python package)

- Status: not-started
- Type: structural (new code)
- Description: Create `tools/orchestrator/` Python package. CLI parsing,
  plan loading from YAML, dry-run that prints the planned spawns. No real
  spawn yet.
- Key files:
  - `tools/orchestrator/__init__.py` (new)
  - `tools/orchestrator/main.py` (new)
  - `tools/orchestrator/plan.py` (new)
  - `tools/orchestrator/examples/csr_oneshot.yaml` (new)
- Dependencies: none
- TDD RED: `tools/orchestrator/tests/test_plan_parses.py` loads
  `examples/csr_oneshot.yaml` and asserts the resulting `Session` has
  three `Step` entries. Fails because no parser exists.

### F3 - ctypes ABI binding + state-file validator

- Status: not-started
- Type: structural (new code)
- Description: Mirror `include/hybrid/state_abi.h`'s `hybrid_state_v1` in
  Python via ctypes. Field-offset asserts at import time. Add
  `validate_state_file(path)` checking magic 0x42594841, version 1,
  exact `sizeof(hybrid_state_v1)` bytes. Wire into orchestrator as the
  post-spawn gate.
- Key files:
  - `tools/orchestrator/abi.py` (new)
  - `include/hybrid/state_abi.h` (read-only)
  - `include/hybrid/state_abi_check.h` (read-only; mirror its asserts)
- Dependencies: F2
- TDD RED: `tools/orchestrator/tests/test_abi_roundtrip.py` writes a known
  `hybrid_state_v1` struct from a small C harness, reads it in Python,
  asserts all fields (GPRs, FPRs, CSRs, V-state) match. Fails until
  ctypes layout matches C.

### F4 - Orchestrator runs today's CSR fixture end-to-end

- Status: not-started
- Type: behavioral
- Description: Replace one `rt_shared_mem.sh` invocation with
  `orchestrator run <yaml>` for `rt_c_v_regs`. Add the C++ helper
  `tools/hybrid_apply_state` extracted from `qemu_handback.hpp`'s
  state-restore body. Delete the in-process spawn at `main.cpp:478-490`;
  vsim returns 200 cleanly.
- Key files:
  - `tools/orchestrator/spawn.py` (new)
  - `tools/orchestrator/main.py`
  - `tools/hybrid_apply_state/` (new C++ CLI; lifts from
    `hybrid_vsim/src/hybrid/qemu_handback.hpp:287-335 apply_state`,
    `:41-63 pick_free_port`)
  - `hybrid_vsim/src/main.cpp:478-490` (delete)
  - `hybrid_vsim/cmake/HybridConfig.cmake:108-238` (add CTest variant)
- Dependencies: F1, F2, F3
- TDD RED: `ctest -R rt_c_v_regs--orchestrator` is registered but the
  orchestrator's spawn path is incomplete; test fails. Then asserts
  exit-code parity with `rt_c_v_regs--csr` (the bash-harness version).

### F5 - icount counter + trigger in QEMU plugin

- Status: not-started
- Type: behavioral
- Description: Add `uint64_t icount_retired` incremented in a per-insn
  callback registered alongside the CSR/PC matcher in
  `vcpu_tb_trans()`. New plugin arg `icount=N`. When
  `icount_retired >= icount_target`, set the should-exit flag and call
  `on_handoff` at the same insn boundary.
- Key files:
  - `qemu_plugin/hybrid_handoff.c:264-300` (`vcpu_tb_trans`)
  - `qemu_plugin/hybrid_handoff.c:302-339` (arg parser)
- Dependencies: F1
- TDD RED: `tests/hybrid/test_plugin_icount_trigger.sh` runs a fixture
  with `--plugin-args icount=100000` on a CSR-less binary; asserts the
  drained state file's `minstret >= 100000` and exit code is 200. Fails
  because the `icount=` arg is unknown.

### F6 - vsim IcountTrigger (sibling of CsrTrigger)

- Status: not-started
- Type: behavioral
- Description: New `hybrid_vsim/src/hybrid/icount_trigger.hpp` with the
  same duck-type surface as `CsrTrigger` (`lookup(pc) ->
  std::optional<hit>`, plus an `observe_commit()` that increments the
  per-hart counter). `HandoffController` is already template-parameterised
  on trigger type (`handoff_controller.hpp:38`). Add
  `--hybrid-icount N` to `main.cpp:466-472`. Multi-hart out of scope
  (plan-validation rejects `hart_id != 0`).
- Key files:
  - `hybrid_vsim/src/hybrid/icount_trigger.hpp` (new)
  - `hybrid_vsim/src/main.cpp:466-472`
  - `hybrid_vsim/src/simulator.hpp:223-253` (registration)
- Dependencies: none (parallel to F5)
- TDD RED: `hybrid_vsim/tests/hybrid/test_icount_trigger.cpp` (doctest)
  builds a `RecordingBus` + `IcountTrigger(N=100)`, drives 100 retire
  ticks, asserts `on_retire` returns a drained state at exactly the
  100th. Fails because the class does not exist.

### F7 - BBV emission plugin (profile mode)

- Status: not-started
- Type: behavioral
- Description: BBV emission as a second sub-mode of `hybrid_handoff`
  (not a separate plugin - keeps per-insn callback cost to one
  per insn). New plugin args `bbv_out=PATH,slice=N`. Emit one BBV row
  per `slice` dynamic insns into a SimPoint-readable `.bb` file.
- Key files:
  - `qemu_plugin/hybrid_handoff.c`
  - `qemu_plugin/bbv_emit.c` (new sub-module)
  - `qemu_plugin/Makefile`
- Dependencies: F5 (reuses the icount counter)
- TDD RED: `tests/hybrid/test_bbv_emit.sh` runs a fixture with
  `bbv_out=/tmp/x.bb,slice=10000`; asserts the file is SimPoint-format
  and has the correct number of slice rows for the binary's dynamic
  insn count.

### F8 - Orchestrator N-way switching with YAML plan grammar

- Status: not-started
- Type: behavioral
- Description: Parse the full `steps:` grammar. Implement the spawn
  loop: spawn, wait, validate state file, archive (no-op if no
  `archive_as`), advance. Pass `--state-in` from previous spawn's
  `--state-out`. Mmap fd held open across all spawns.
- Key files:
  - `tools/orchestrator/plan.py`
  - `tools/orchestrator/main.py`
  - `tools/orchestrator/spawn.py`
  - `tools/orchestrator/mmap_owner.py` (new)
- Dependencies: F4
- TDD RED: `tools/orchestrator/tests/test_two_step_session.py` runs a
  2-step plan (QEMU -> vsim -> QEMU) on `rt_c_v_regs`; asserts both
  intermediate state files validate. Fails until the loop exists.

### F9 - Checkpoint archive write

- Status: not-started
- Type: behavioral
- Description: When a step has `archive_as: snap/N`, after the spawn
  exits, copy `state.bin` and the mmap into `snap/N/`; write
  `meta.json`. Reflink-or-copy by filesystem probe (btrfs/xfs use
  `cp --reflink=always`; ext4 falls back to sequential `cp`).
- Key files:
  - `tools/orchestrator/checkpoint.py` (new)
  - `tools/orchestrator/main.py`
- Dependencies: F8
- TDD RED:
  `tools/orchestrator/tests/test_checkpoint_archive.py` runs a 1-step
  plan with `archive_as: snap/0`; asserts the three artefacts exist
  and `state.bin` byte-matches the in-flight one.

### F10 - Checkpoint replay (`replay-checkpoint <dir>`)

- Status: not-started
- Type: behavioral
- Description: New orchestrator entry point. Validates `meta.json`
  against the live binary's CPU variant and VLEN. Hydrates a new
  `/dev/shm` mmap from `snap/N/mem`. Copies `state.bin` to working
  path. Spawns the requested model. No plugin or vsim code change.
- Key files:
  - `tools/orchestrator/checkpoint.py`
  - `tools/orchestrator/main.py`
- Dependencies: F9
- TDD RED:
  `tools/orchestrator/tests/test_checkpoint_replay.py` writes a known
  archive (using F9), runs `replay-checkpoint snap/0 --resume-with
  vsim`; asserts the spawned vsim drains a state file whose GPRs
  match the archive.

### F11 - BBV slice-consume trigger

- Status: not-started
- Type: behavioral
- Description: Third sub-mode of `hybrid_handoff` (after CSR/PC,
  icount, BBV-emit): read a slice-index list, fire drain when the
  icount counter hits each slice index. Orchestrator chains N
  invocations through the plan grammar to produce K archived
  regions per SimPoint cluster.
- Key files:
  - `qemu_plugin/hybrid_handoff.c`
  - `qemu_plugin/bbv_emit.c`
  - `tools/orchestrator/plan.py` (new trigger kind `phase`)
- Dependencies: F5, F7, F8
- TDD RED: `tests/hybrid/test_plugin_phase_consume.sh` supplies a
  3-slice list; asserts the plugin drains at exactly the third slice
  (verified by the state file's `minstret`).
```

## Out of Scope (deferred)

- Multi-hart trigger support (per user decision; would be a follow-on
  feature wave). Plan-validation explicitly rejects `hart_id != 0` in F8.
- Snapshot auto-pruning (per user decision; manual disk management
  acceptable in v1).
- Guest-driven cancel (spec open question 5; defer indefinitely).
- KVM/HVF-accelerated QEMU (spec section 5 row 9; plugin API does not
  intercept).
- Cross-ISA switching (spec section 5 row 11; different design problem).

## Approval Required For

This plan covers (a) writing the design above and (b) creating
`/home/nick/work/hybrid_sim/ROADMAP.md` with the exact content shown
in the section above. No source code, build configs, or submodule
files are modified in this session.
