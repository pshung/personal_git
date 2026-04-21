# Plan: Make `/optimize` target-agnostic (config-driven, per-VPU)

## Context

The current `/optimize` skill at `.claude/skills/optimize/SKILL.md` is hardwired to AX45MPV at VLEN=1024. Target-specific knowledge (VLEN, L2 size, uarch, toolchain path, FPGA host:port, build flags, intrinsic API) is baked into SKILL.md prose AND into `qemu-validate/*.sh` as literal strings. Supporting a second VPU configuration today means forking the skill.

The `libnn-optimizer` skill (`~/personal_git/.claude/skills/libnn-optimizer/SKILL.md`) already solved the same shape of problem for an adjacent project: a user-owned `config.toml`, a per-target Verilog `.inc` file that encodes hardware capabilities, and a `validate_config.py` fail-fast gate. We adopt that pattern and make `validate` a first-class FSM state, not a hidden preamble.

User constraints:
- Do not symlink or invoke scripts from `agentic_libnn_opt/` or any external repo. **Copy** the ones we want; the skill must be self-contained.
- **Zero hardcoding** in the final state. Every path, flag, VLEN, CPU name, host:port must come from config.

Outcome: pointing `/optimize` at a new VPU config = (1) drop an `.inc`, (2) add a `references/uarch/<soc>.md` if the uarch family is new, (3) edit one `config.toml` line. No SKILL.md edits, no script edits.

---

## Target directory layout

```
.claude/skills/optimize/
  SKILL.md                            # target-agnostic FSM only
  config.toml                         # user-owned single source of truth
  config.example.toml                 # template committed to repo
  fpga_config/
    ax45mpv_v1024_8mb.inc             # copied from agentic_libnn_opt/opt/fpga_config/
    # future: ax45mpv_v512_4mb.inc, nx27v_v512_2mb.inc, ...
  script/
    parse_config.sh                   # copy, parameterize
    validate_config.py                # copy, extend
    rebuild_single.sh                 # copy, fully parameterize
    run_qemu_test.sh                  # copy, parameterize
    run_fpga_test.sh                  # copy, parameterize
    run_vsim_kernel.sh                # copy from libnn_0421/qemu-validate/, parameterize
    run_vsim_profile.sh               # copy, parameterize
    build_libnn.sh                    # copy, parameterize (initial full build)
    state_update.py                   # new: atomic state.json writer
    hash_config.py                    # new: compute config+inc hashes for cache
  references/
    uarch/
      andes_45_series.md              # pipeline stages, stall taxonomy, latency table
      # future: andes_27_series.md, ...
    intrinsic_api/
      nds_vec_macros.md               # the NDS_VEC_* rules currently buried in SKILL.md
      # future: riscv_intrinsics.md for targets with ENA_VEC_INTRINSIC=on
  state.json                          # FSM state + cached target_features
```

Principle: everything the skill reads or runs lives under `.claude/skills/optimize/`. The only things outside are (a) the libnn source tree (path given in config), (b) the toolchain (path in config), (c) the FPGA board (host:port in config).

---

## Config schema (`config.toml`)

Every knob from the audit becomes a config key. Nothing is hardcoded in scripts.

```toml
[repo]
libnn_root = "/home/nick/work/libnn_0421"    # absolute; scripts derive everything from here
state_file = ".claude/skills/optimize/state.json"  # relative to libnn_root

[toolchain]
bin_dir = "/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin"
prefix  = "riscv64-elf-"

[target]
cpu            = "AX45MPV"
fpga_config    = "fpga_config/ax45mpv_v1024_8mb.inc"    # relative to skill dir
uarch_ref      = "references/uarch/andes_45_series.md"
intrinsic_api  = "references/intrinsic_api/nds_vec_macros.md"

# CFLAGS assembled from three sources (order preserved):
# 1. [target.cflags_base]  - from build.sh per-CPU block
# 2. [target.cflags_perf]  - extra flags for FPGA perf build (PF_COUNTER, etc.)
# 3. [target.cflags_verify] - extra flags for QEMU correctness build
[target.cflags_base]
flags = [
  "-O3", "-ffunction-sections", "-fdata-sections", "-Wall", "-Werror",
  "-mtune=andes-45-series", "-fno-strict-aliasing",
  "-mext-vector", "-DENA_VEC_ISA",
  "-DMAX_VLEN=1024", "-DNDS_VEC_RVV_VERSION=1000",
  "-DENA_NDS_V5_VEC_DOT_PROD",
  "-fno-tree-slp-vectorize", "-fno-tree-vectorize",
]

[target.cflags_perf]
flags = ["-DPF_COUNTER", "-DENA_TEST_PERF", "-DENA_MEASURE_PERF=1",
         "-DENA_RUN_TWICE", "-DENA_CACHEABLE_ENV_SETUP"]

[target.cflags_verify]
flags = ["-DENA_FAST_ALGO", "-DENA_DUMP_GOLDEN=0", "-DENA_MEASURE_PERF=0",
         "-mext-vector=zve64d"]

[target.active_defines]
# Macros considered "active" for this build - used by analyze step to ignore dead #ifdef blocks
defined    = ["ENA_VEC_ISA", "ENA_TILING", "ENA_FAST_ALGO",
              "ENA_NDS_V5_VEC_DOT_PROD"]
undefined  = ["ENA_VEC_INTRINSIC", "ENA_VEC_ISA_ZVQMAC"]
rvv_version = 1000

[qemu]
binary  = "/local/nick/qemu_v5/build/qemu-system-riscv64"
machine = "andes_ae350"
cpu     = "andes-ax45mpv,vext_spec=v1.0,vlen=1024"
config  = "project/ax45mpv/qemu_cfg/zve64d/ADP-AE350-AX45MPV-1C_dw0_mw1.cfg"  # relative to libnn_root
vlen    = 1024
timeout = 300

[vsim]
binary  = "/local/nick/vsim-workspace/vsim"
vlen    = 512                                 # pipeline patterns identical; just fewer elements
target  = "ax45mpv_premium"
log_cycles_default = 2000

[fpga]
host    = "sw-boards.andestech.com"
port    = 1119
timeout = 300
linker_script   = "project/ax45mpv/ae350-xip_hvm.ld"           # relative to libnn_root
sim_wrapper     = "project/ax45mpv/riscv64-sim-wrapper-on-board"
reset_flag_file = "project/ax45mpv/First_Reset_done"

[limits]
max_rounds = 5
validate_cache_hours = 24    # skip re-validate if config+inc unchanged and fresh

[state]
# target_features populated by validate step from parsed .inc; read-only from scripts' POV
```

Rule: SKILL.md never names any of these values literally. It references `<config:[section].<key>>` and the script resolves.

---

## FSM: explicit `validate` state

```
idle ──(function arg)──> validate ──(pass)──> select ──> analyze ──> implement
                          │   ^
                          │   └─(fail: stays here; user fixes config; re-invoke resumes)
                          └─(pass, cache fresh)─> select directly on subsequent runs
                                                    │
                                                    v
         analyze ──> implement ──> verify ──> measure ──> [profile] ──> learn ──┐
           ^                                                                      │
           └────────────────────────(loop)────────────────────────────────────────┘
```

### State contract for `validate`

- **Entry**: from `idle` when user invokes `/optimize <function>` or `/optimize validate`.
- **Cache skip**: if `state.validated_at` exists AND `sha256(config.toml) == state.config_hash` AND `sha256(<fpga_config>) == state.inc_hash` AND `now - validated_at < config.limits.validate_cache_hours`, skip directly to `select`. `/optimize validate --force` bypasses cache.
- **Work**: run `script/validate_config.py`. On pass, populate `state.target_features` (parsed `.inc`), write `config_hash`, `inc_hash`, `validated_at`.
- **Pass**: -> `select`.
- **Fail**: stay in `validate`. Print actionable error from validator. Exit. User fixes config, re-invokes; the same state.json resumes from `validate`.
- **Force-only mode**: `/optimize validate` alone is a legitimate terminal run - validates, populates cache, exits to `idle` (not `select`).

### Other state changes that fall out of this refactor

- **select** drops its "first-time full build" responsibility? No - keep it. But it now reads `target_features` from state instead of parsing `.inc` itself. It uses `config.scripts.build_libnn` (call by name) instead of a literal path.
- **analyze** proposer subagent receives `target_features`, `uarch_ref` doc contents, `intrinsic_api` doc contents, `active_defines` list as structured input. All the "Key defines active for AX45MPV" prose in SKILL.md (lines 130-138) moves into `config.toml` under `[target.active_defines]`.
- **implement** subagent reads `intrinsic_api` doc. The `NDS_VEC_*` hard rule in SKILL.md (lines 228-237, 569-571) moves into `references/intrinsic_api/nds_vec_macros.md`.
- **verify** constructs gcc command from `config.toolchain.bin_dir` + `config.target.cflags_base` + `config.target.cflags_verify`, not a literal block.
- **measure** calls `script/run_fpga_test.sh <func>`; that script reads host/port/flags from config.
- **profile** reads `config.vsim.*`; vsim VLEN no longer literal `512`.

---

## Execution phases (Tidy First, commit-disciplined)

Each phase is one commit. Phases marked **[S]** are structural-only (no behavior change); **[B]** behavioral (one semantic change at a time).

### Phase 1 [S]: Scaffolding

**Goal**: skill directory has the target layout, but no behavior changes yet. SKILL.md still drives old flow.

- `mkdir` the directories: `config.toml`, `config.example.toml`, `fpga_config/`, `script/`, `references/uarch/`, `references/intrinsic_api/`
- Copy `ax45mpv_v1024_8mb_config.inc` from `/home/nick/work/agentic_libnn_opt/opt/fpga_config/` -> `fpga_config/ax45mpv_v1024_8mb.inc`
- Copy these scripts from `/home/nick/work/agentic_libnn_opt/opt/script/` (user says: copy, don't link):
  - `parse_config.sh`, `validate_config.py`, `run_qemu_test.sh`, `run_fpga_test.sh`, `rebuild_single.sh`
- Copy these scripts from `/home/nick/work/libnn_0421/qemu-validate/` (they are closer to what `/optimize` currently uses):
  - `run_vsim_kernel.sh`, `run_vsim_profile.sh`, `build_libnn.sh`
- Create stubs for new scripts: `state_update.py`, `hash_config.py`
- Write `config.example.toml` with full schema, comments explaining each key
- Write `config.toml` populated with the current AX45MPV/VLEN=1024 values (transcribed from the audit, not inferred)
- Extract the current "Key defines active for AX45MPV" block (SKILL.md lines 130-138) into `references/uarch/andes_45_series.md` + `config.toml [target.active_defines]`. Verbatim, no rewording yet.
- Extract the current "NDS_VEC_* macros ONLY" rule (SKILL.md lines 228-237, 569-571) into `references/intrinsic_api/nds_vec_macros.md`. Verbatim.

**Verification**: `diff` shows only new files; SKILL.md unchanged. `config.toml` parses with `python3 -c 'import tomllib; tomllib.load(open("config.toml","rb"))'`. No runtime changes - SKILL.md still uses old `/home/nick/work/libnn/qemu-validate/` paths.

**Critical files**:
- NEW: `.claude/skills/optimize/config.toml`
- NEW: `.claude/skills/optimize/config.example.toml`
- NEW: `.claude/skills/optimize/fpga_config/ax45mpv_v1024_8mb.inc`
- NEW: `.claude/skills/optimize/script/*.sh` (copied)
- NEW: `.claude/skills/optimize/script/*.py` (copied)
- NEW: `.claude/skills/optimize/references/uarch/andes_45_series.md`
- NEW: `.claude/skills/optimize/references/intrinsic_api/nds_vec_macros.md`

---

### Phase 2 [S]: Parameterize copied scripts (de-hardcode)

**Goal**: every copied script reads exclusively from `config.toml` (via `parse_config.sh`) and from CLI args. Zero literal paths, flags, hosts, ports, VLENs, CPU names, or toolchain prefixes remain.

For each script under `script/`, apply the same template:

1. First line after shebang: `source "$(dirname "$0")/parse_config.sh" --config "${OPT_CONFIG:-$(dirname "$0")/../config.toml}"`
2. Every `/local/nick/...` literal -> `${CFG_TOOLCHAIN_BIN}` / `${CFG_QEMU_BIN}` / `${CFG_VSIM_BIN}`
3. Every `sw-boards.andestech.com` / `1119` literal -> `${CFG_FPGA_HOST}` / `${CFG_FPGA_PORT}`
4. Every `AX45MPV` / `ax45mpv` literal -> `${CFG_CPU}` (lowercase derived)
5. Every `1024` / `512` VLEN literal -> `${CFG_QEMU_VLEN}` / `${CFG_VSIM_VLEN}`
6. Every `-mtune=andes-45-series` / `-mext-vector=zve64d` / `-DMAX_VLEN=...` / `-DNDS_VEC_RVV_VERSION=1000` -> `${CFG_CFLAGS_BASE}` / `${CFG_CFLAGS_PERF}` / `${CFG_CFLAGS_VERIFY}` (space-joined arrays from TOML)
7. Every `/home/nick/work/libnn*/` repo-root reference -> `${CFG_LIBNN_ROOT}`
8. Every QEMU config path, linker script path, GDB wrapper path -> `${CFG_QEMU_CONFIG}` / `${CFG_FPGA_LD_SCRIPT}` / `${CFG_FPGA_SIM_WRAPPER}`
9. Every state-file path -> `${CFG_STATE_FILE}`

**Extend `parse_config.sh`** to export the full new key set (current version only exports 8 keys; we need ~25). Parse list-valued TOML (`flags = [...]`) into space-joined strings.

**Extend `validate_config.py`** for two things:
- Add step 8: verify vsim binary + target + log output plumbing (current validator doesn't know about vsim).
- Emit `target_features` JSON to stdout when called with `--emit-features`; this becomes the input for state population.

**Write `hash_config.py`**: given `config.toml` path, output `{config_hash, inc_hash}` JSON. Used by the FSM to decide cache skip.

**Write `state_update.py`**: atomic state.json writer. Takes `--set key=value` pairs or `--merge <json>`. Replaces the current 20-line inline Python in SKILL.md (lines 501-522). Handles the `step_started` / `prev_step_started` / duration bookkeeping that's currently duplicated.

**Verification per script**:
- Run `grep -rE '/local/nick|/home/nick|sw-boards|andes-45-series|ax45mpv|AX45MPV|MAX_VLEN=|NDS_VEC_RVV_VERSION|mext-vector=zve|-DENA_NDS' script/` -> zero matches.
- Run `bash script/validate_config.py` end-to-end against the phase-1 `config.toml` -> all 8 steps pass (7 original + vsim).
- Run `bash script/rebuild_single.sh Source/ActivationFunctions/riscv_nn_relu_s8.c` -> rebuilds `libnn.a`, produces same byte-identical `.o` as current `qemu-validate/rebuild_single.sh` (modulo compile timestamps). `cmp` on the `.o` files.

**Critical files**:
- MODIFY (post-copy): every script under `.claude/skills/optimize/script/`

---

### Phase 3 [B]: Rewrite SKILL.md around config-driven FSM + new `validate` state

**Goal**: SKILL.md is target-agnostic, references `<config:...>` instead of literal values, and has the explicit `validate` state.

Edits to SKILL.md:

1. **Frontmatter** (lines 1-7):
   - `description`: drop "on AX45MPV (VLEN=1024)"; replace with "for any RISC-V VPU configured in `config.toml`; validates config, parses FPGA .inc for hardware features, then runs the optimization loop."
   - `argument-hint`: `[function_name|validate|status|reset] [--target <profile>] [--level algorithm|uarch]`

2. **Replace the FSM diagram** (lines 27-50) with the one in this plan's FSM section.

3. **New section: `## State: validate`** (insert between `## State: idle` and `## State: select`):
   ```
   Verify the configured target is reachable before doing any optimization work.

   1. Read config path (default `.claude/skills/optimize/config.toml`).
   2. Compute config+inc hashes via `script/hash_config.py`. If state.validated_at is
      within config.limits.validate_cache_hours AND both hashes match state's cached
      values, skip to `select`.
   3. Otherwise run `script/validate_config.py`. It executes:
      Step 1: load config.toml, check all required sections/keys
      Step 2: toolchain bin_dir + gcc + target flags supported
      Step 3: compile hello world with [target.cflags_base]
      Step 4: run hello on QEMU via strace, check semihosting output
      Step 5: parse [target].fpga_config .inc, extract target_features dict
      Step 6: TCP connect [fpga].host:[fpga].port
      Step 7: compile + run hello on FPGA board via GDB wrapper
      Step 8: vsim binary runs, emits pipeline log on a 10-instruction test
   4. On pass: write target_features + hashes + timestamp to state.json; transition -> select.
   5. On fail: stay in validate, print the failing step and remediation hint.

   If user invoked `/optimize validate` alone, exit to idle after pass (do not continue).
   ```

4. **Rewrite `select` step** (lines 80-112): drop the literal `/home/nick/work/libnn/qemu-validate/build_libnn.sh` reference and the literal `run_fpga_test.sh` reference. Replace with `script/build_libnn.sh` and `script/run_fpga_test.sh` (skill-local). Drop literal `t_<test>_perf.objdump` path - reference `<config:[repo].work_dir>/t_<test>_perf.objdump`. Note that `target_features` is now available from state; proposer step can use L2_kb etc.

5. **Rewrite `analyze` step** (lines 114-214):
   - Delete the "Key defines active for AX45MPV" block (lines 130-138). Replace with: "The active defines list is in `config.toml [target.active_defines]`. The proposer subagent receives this list + the `target_features` dict + the `uarch_ref` doc."
   - In the proposer subagent prompt (lines 544-551), inject `target_features`, contents of `config.[target].uarch_ref`, contents of `config.[target].intrinsic_api` as structured context. Drop the pipeline-stage mnemonic ("VQ->VD->VC->VW") from SKILL.md prose - it lives in `references/uarch/andes_45_series.md` now.

6. **Rewrite `implement` step** (lines 217-240):
   - Delete the "NDS_VEC_* macros ONLY" block (lines 228-237). Replace with: "Use the intrinsic API defined by `config.[target].intrinsic_api`. The implement subagent must read that doc before writing vector code."
   - In the implement subagent prompt (lines 567-572), inject intrinsic_api doc content.

7. **Rewrite `verify` step** (lines 244-285):
   - Delete the literal 10-line gcc invocation (lines 258-271). Replace with: `bash script/compile_test.sh <test_name>`. Write a new helper `script/compile_test.sh` that assembles the gcc command from config values.
   - Keep the qemu-runner subagent call - its prompt parameterized via config.

8. **Rewrite `measure` step** (lines 288-310): path to script changes; parsing unchanged.

9. **Rewrite `profile` step** (lines 314-434):
   - `script/run_vsim_kernel.sh` path (skill-local).
   - Delete the literal `vsim uses VLEN=512` note (line 432); add a parenthetical "(vsim VLEN from config.vsim.vlen; pipeline patterns are uarch-invariant)".
   - Pipeline stage taxonomy (lines 418-428) moves to `references/uarch/andes_45_series.md`; SKILL.md says "read the uarch_ref doc for pipeline stall taxonomy."

10. **Rewrite `learn` step** (lines 438-461): wiki path `docs/wiki/` - check if it's under libnn_root (yes per audit) or skill-local. Keep under `config.[repo].libnn_root + /docs/wiki/`.

11. **Rewrite state update block** (lines 500-522): replace the inline Python with `bash script/state_update.py --set step=<new> --append-history`.

12. **Rewrite state file format** (lines 465-498): add new fields `validated_at`, `config_hash`, `inc_hash`, `target_features`.

13. **Rewrite "Subagent Dispatch" table** (lines 530-539): add row for `validate`. Update references to qemu-validate paths.

14. **Rewrite "Rules" section** (lines 583-599):
    - Rule 8 "Target VLEN=1024" -> "Target = `config.qemu.vlen`; never regress on the primary config."
    - Rule 12 "Use rebuild_single.sh" -> "Use `script/rebuild_single.sh`."
    - Rule 15 "Scripts are single source of truth" -> "Scripts under `.claude/skills/optimize/script/` are single source of truth for builds and tests. Never construct gcc/QEMU/GDB commands manually; never invoke scripts outside this skill."

**Verification**: run `grep -E '/local/nick|/home/nick/work/libnn/qemu-validate|sw-boards|AX45MPV|VLEN=1024|NDS_VEC_RVV_VERSION=1000|mtune=andes-45' SKILL.md` -> zero matches. Run `/optimize validate` -> passes. Run `/optimize relu_s8` from idle -> state advances `idle -> validate -> select -> analyze -> ...` with no literal paths in state.json.

**Critical files**:
- MODIFY: `.claude/skills/optimize/SKILL.md` (large rewrite)
- NEW: `.claude/skills/optimize/script/compile_test.sh` (extracted from the verify block)

---

### Phase 4 [B]: Prove portability with a second target profile

**Goal**: verify the abstraction holds. Any gaps in the schema surface here and get fixed.

- Obtain or construct a second `.inc` (e.g., `ax45mpv_v512_4mb.inc` - same uarch, different VLEN + L2) or `nx27v_v512.inc` if available. Drop in `fpga_config/`.
- Create `config.secondary.toml` pointing at the new `.inc`, with `qemu.vlen` / `vsim.vlen` / `[target.cflags_base]` adjusted (build.sh audit showed NX27V drops `-mtune=andes-45-series` for example).
- Run `/optimize validate --config config.secondary.toml`. If any step fails because a value was still baked somewhere, fix and re-verify.
- Run one full round on one simple function (e.g., `relu_s8`) against the secondary target in QEMU-only mode. Confirm `state.json` picks up the new `target_features` and produces a correct build.

**Exit criterion**: `/optimize relu_s8 --config config.secondary.toml` reaches `measure` successfully (or cleanly exits at `validate` if FPGA not available for that target) without any SKILL.md or script edits between phase-3 completion and this run.

**Critical files**:
- NEW: `.claude/skills/optimize/fpga_config/<second_target>.inc`
- NEW: `.claude/skills/optimize/config.secondary.toml`
- Possibly: `.claude/skills/optimize/references/uarch/<new_family>.md` if the second target is a different microarchitecture family.

---

### Phase 5 [S]: Documentation sweep

- Update the skill's top-of-file description to reflect multi-target support.
- Add a `README.md` in `.claude/skills/optimize/` (ONE file) showing: layout, how to add a new target in <15 minutes, example of `config.toml` diff for VLEN swap vs CPU swap.
- Remove any now-orphaned files in `/home/nick/work/libnn_0421/qemu-validate/` IF AND ONLY IF confirmed unused (grep the rest of the repo). User keeps ownership of that decision; default is to leave them.

---

## What we deliberately do NOT do

- **Do not symlink or source from external repos.** Every script under `.claude/skills/optimize/script/` is a local copy. Future upstream changes in `agentic_libnn_opt` do not leak in automatically - that is intentional isolation per user's explicit instruction.
- **Do not invent uarch data.** If the VQ/VD/VC/VW stage model applies only to andes-45-series, it stays in `references/uarch/andes_45_series.md`. Adding a new family means writing a new doc - we do not fake pipeline stages for a target we haven't profiled.
- **Do not make `measure` pluggable across {FPGA, vsim, QEMU-icount}.** Current scope assumes FPGA ground truth. A future extension can add a `[measure].backend = "fpga|vsim|qemu"` key; out of scope here.
- **Do not tackle `analyze`-level cache-aware tile-size reasoning.** The `target_features` dict makes L2 size available to the proposer, but turning that into a cache-aware tiling sub-procedure is a separate project; out of scope.

---

## End-to-end verification

After phase 3, run this exact sequence to confirm the refactor is correct:

1. `bash .claude/skills/optimize/script/validate_config.py` -> all 8 steps `[OK]`.
2. `cat .claude/skills/optimize/state.json` -> contains `target_features` with `vlen: 1024`, `l2_kb: 8192`, `rvv_support: true`, etc.
3. `/optimize validate --force` -> re-runs all 8 steps, updates `validated_at`.
4. `/optimize relu_s8` -> state transitions through `validate` (cached, skipped) -> `select` -> `analyze` -> ... One full round completes; `state.round` = 1.
5. `grep -rE '/local/nick|/home/nick/work/libnn/qemu-validate|sw-boards|AX45MPV|VLEN=1024|mtune=andes-45|NDS_VEC_RVV_VERSION=1000|MAX_VLEN=1024' SKILL.md script/` -> zero matches. This is the definitive "zero hardcoding" check.
6. `/optimize status` -> shows state, target_features, validated_at, round history.
7. Edit `config.toml` to change `[qemu].vlen = 512`. Run `/optimize relu_s8` again -> re-enters `validate` because inc_hash is fine but config_hash changed; `target_features.vlen` updates.

After phase 4:

8. `/optimize validate --config config.secondary.toml` -> all 8 steps `[OK]` against the new target.

---

## Assumptions surfaced (flag before executing)

1. **Single libnn_root per skill invocation.** Config has exactly one `[repo].libnn_root`. Multi-repo tuning would need re-invoking the skill from a different repo.
2. **TOML arrays for CFLAGS.** Storing `flags = [...]` as TOML arrays rather than a single string makes per-flag edits/diffs cleaner. `parse_config.sh` joins them with spaces.
3. **State file stays outside `.claude/skills/optimize/` but under `libnn_root/.claude/skills/optimize/state.json`** - matches current convention at `/home/nick/work/libnn/.claude/opt-state.json`. Alternative: keep state co-located with skill (under `.claude/skills/optimize/state.json`); plan assumes the latter since the skill is now self-contained.
4. **`validate` cache TTL** defaults to 24h. User can set to 0 to force every invocation, or 168h (1 week) if config is truly static.
5. **The existing `/home/nick/work/libnn_0421/qemu-validate/` directory** is left untouched by this refactor. If the user wants to delete it after migration, that is a follow-up.
