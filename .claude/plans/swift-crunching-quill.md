# Plan: add `validate` state + route `optimize` skill through config.toml

## Context

The `optimize` skill currently drives scripts at `qemu-validate/` with hardcoded
toolchain paths, CPU flags (`ax45mpv`, `andes-45-series`, `-DMAX_VLEN=1024`),
QEMU binary location, and FPGA host. Retargeting to a different VPU or
toolchain requires editing multiple scripts.

The user has already built parameterized replacements under
`.claude/skills/optimize/` (confirmed by reading the files):

- `config.toml` — full schema: `[repo] [toolchain] [target] [qemu] [vsim] [fpga] [limits]`, including `[target.cflags_base/perf/verify]` and `[target.active_defines]`.
- `script/parse_config.sh` — sourced by every script, exports `CFG_*` vars (`CFG_CC`, `CFG_CFLAGS_BASE`, `CFG_QEMU_BIN`, etc.) and resolves relative paths against `libnn_root` / skill dir.
- `script/rebuild_single.sh`, `run_qemu_test.sh`, `run_fpga_test.sh`, `build_libnn.sh` — all parameterized through `parse_config.sh`. No hardcoded paths or flags remain.
- `script/validate_config.py` — 7-step fail-fast check (config load, toolchain, hello-world compile, QEMU run, FPGA .inc parse, FPGA TCP, FPGA GDB run).
- `fpga_config/ax45mpv_v1024_8mb.inc` + `ax45mpv_v512_512kb.inc` — hardware profiles.

**The gap is in SKILL.md**: it still points at `qemu-validate/*.sh` (the hardcoded legacy set) and has no `validate` state. Two extra fixes fall out of this migration:

- My earlier `-E` preprocess addition went into `qemu-validate/rebuild_single.sh` (legacy). It needs to be ported to `.claude/skills/optimize/script/rebuild_single.sh` instead.
- `validate_config.py` line 55-61 requires keys `[limits].max_iterations` / `min_improvement_pct` (the libnn-optimizer schema), but the new `config.toml` uses `max_rounds` / `validate_cache_hours`. The validator will always fail on the current config until this is fixed.

## Desired outcome

- User retargets by editing `config.toml` only. Zero edits to SKILL.md or scripts.
- `/optimize validate` — standalone command that runs `validate_config.py`.
- `/optimize <fn>` — runs `validate` first; if cache is fresh (`validate_cache_hours`), skip; otherwise full 7-step check. Proceed to `select` only on PASS.
- All script references in SKILL.md use `${SKILL_DIR}/script/<name>.sh` where `SKILL_DIR=${LIB_ROOT}/.claude/skills/optimize`. No `qemu-validate/` paths remain in the skill's hot path.

## Changes

### 1. Fix `validate_config.py` schema mismatch

**File:** `.claude/skills/optimize/script/validate_config.py:55-61`

Change the `required` dict to match `config.toml`:
- `[limits]` keys: `max_rounds`, `validate_cache_hours` (drop `max_iterations`, `min_improvement_pct`).
- Add `[repo]` section requirement: `libnn_root`.
- Add `[target]` keys: `uarch_ref`, `intrinsic_api` (already in config.toml).
- Add `[vsim]` as optional (skill doesn't use it, but config declares it).

### 2. Port `-E` mode to the parameterized `rebuild_single.sh`

**File:** `.claude/skills/optimize/script/rebuild_single.sh`

Add a `-E` flag the same way I did in `qemu-validate/rebuild_single.sh`:
- `rebuild_single.sh -E <src.c>` → emit `${CFG_WORK_DIR}/<basename>.i` using the same `CFG_CFLAGS_BASE` and `CFG_CC`.
- Swap `-c` for `-E -P` in the compile command; skip the archive + objdump steps in `-E` mode.
- Skip the `libnn.a` / `lib_objs/` prerequisite check in `-E` mode (consistent with legacy).

### 3. Revert the `-E` addition from `qemu-validate/rebuild_single.sh`

The legacy script is being phased out of the skill's workflow. Remove the `-E` branch I added so legacy behavior is unchanged and only the parameterized script carries the new feature.

### 4. Add `validate` state to SKILL.md FSM

**File:** `.claude/skills/optimize/SKILL.md`

FSM update (around the diagram at top):
```
idle → validate → select → analyze → implement → verify → measure → learn
         |
         └→ idle (validation failed)
```

Add a `## State: validate` section after `idle`:

- Runs `python3 ${SKILL_DIR}/script/validate_config.py`.
- On PASS: write `validated_at` timestamp to state, transition → `select`.
- On FAIL: report the failing step + guidance, transition → `idle`. Do not proceed.
- Cache: if `state.validated_at` is within `[limits].validate_cache_hours` AND `config.toml` + `.inc` file mtimes are older than `validated_at`, skip re-validation. Otherwise force a run.

`idle` routing:
- `/optimize validate` → `validate`
- `/optimize <fn>` → `validate` first (with cache check), then `select` on PASS

### 5. Repoint every script reference in SKILL.md

Replace `qemu-validate/<script>.sh` with `.claude/skills/optimize/script/<script>.sh` throughout:
- Build Scripts Reference table (top of SKILL.md)
- `select` state step 5 (`build_libnn.sh`), step 6 (`run_fpga_test.sh`), step 7 (`rebuild_single.sh -E`)
- `analyze` state (the `-E` call in round=1 step 1 and round>1 step 1)
- `implement` subagent constraints
- `verify` state (`rebuild_single.sh`, `run_qemu_test.sh`)
- `measure` state (`run_fpga_test.sh`)

Also add a `SKILL_DIR` shell-variable convention at the top of "Build Scripts Reference" so each bash block reads:
```bash
LIB_ROOT=$(git rev-parse --show-toplevel)
SKILL_DIR="${LIB_ROOT}/.claude/skills/optimize"
```

### 6. Update "Quick reference of known-active defines" section

The `[target.active_defines]` section in `config.toml` is now authoritative. The manual list in SKILL.md (currently lines 130-137) should say: "See `[target.active_defines]` in config.toml (`CFG_DEFINES_DEFINED` / `CFG_DEFINES_UNDEFINED` after sourcing `parse_config.sh`). The `.i` file is still the ultimate ground truth."

### 7. Update state.json schema

Add two fields:
- `"validated_at": ""` — ISO timestamp of last successful validation
- `"config_toml_mtime": 0` — mtime of `config.toml` at validation time (used by cache check)

## Critical files

- `.claude/skills/optimize/SKILL.md` — FSM addition + script path rewrites (most work)
- `.claude/skills/optimize/script/validate_config.py` — schema dict fix
- `.claude/skills/optimize/script/rebuild_single.sh` — add `-E` mode
- `qemu-validate/rebuild_single.sh` — revert my `-E` addition

Not touched: `config.toml` (already correct), `parse_config.sh` (already correct), `run_qemu_test.sh` / `run_fpga_test.sh` / `build_libnn.sh` under `.claude/skills/optimize/script/` (already parameterized).

## Verification

After changes:
1. `python3 .claude/skills/optimize/script/validate_config.py` — Steps 1-5 pass on the current machine (Steps 6-7 may fail if FPGA board is unreachable from the sandbox; that's expected).
2. `.claude/skills/optimize/script/rebuild_single.sh -E Source/ActivationFunctions/riscv_nn_relu_s8.c` — produces a `.i` under `CFG_WORK_DIR` with only the active `#ifdef` branches.
3. Grep SKILL.md for `qemu-validate/` — should return zero hits in the hot-loop sections (the known-failure note in the CLAUDE.md context is a different reference and stays out of this skill).
4. Run `/optimize validate` mentally-walk the flow: validate runs, writes timestamp, exits idle on FAIL, transitions to select on PASS.
