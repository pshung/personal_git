# andes-sim release surface: hide "verilator", split release vs dev commands

## Context

`andes-sim` is the release product, but `--help` today exposes implementation
detail and unfinished work. Looking at `./build/andes-sim --help` the user (PM)
asked for four things:

1. Hide the word **verilator** from users (it shows in the `--help` tagline, the
   `--engine` example, `list models`, and the whole `list engines` TYPE column +
   ids like `verilator:ax45mpv_premium`).
2. Don't output **unfinished** features (`estimate`, `cluster`, `profile`, and
   the like).
3. **Separate** release features from development features.
4. The release product **shouldn't include `build` and `test`**.

Today the command table (`driver/main.cpp:35-46`) lists all 10 commands and the
help printer shows every one. Engine identity ("verilator") comes from the vsim
binary's `--describe` JSON; the driver passes it through verbatim. Selection
keys off `kind=="cycle-accurate"`, never the `type` string (`engine_registry.hpp:45`),
so relabeling the engine is safe.

Outcome: a clean release surface (`run`, `list`) that never says "verilator",
with `build`/`test`/`doctor` reachable to developers via an env var, and the
half-built ROADMAP commands hidden until they land.

## Decisions (locked)

- Replace "verilator" with **`vsim`** everywhere on the surface: TYPE column
  `vsim`, ids `vsim:ax45mpv_premium`, `--engine vsim:ax45mpv_premium`.
- Scrub **everywhere incl. ids** (one normalization point at discovery flips
  list / `--engine` / errors / banner together).
- Reveal dev commands via **`ANDES_SIM_DEV=1`** (release `--help` stays clean +
  one hint line; the env var adds a "developer commands" section).

**Inference to confirm at approval:** `doctor` -> **dev tier** (not release). Its
content is entirely build/setup (submodules, toolchain, `./hsim build`) and it is
the only Release command that would still print real `verilator/` paths
(`cmd_doctor.cpp:60,110`) which cannot be renamed. So Release = `run` + `list`.

## Command tiers (the one new idea)

Add `enum class Tier { Release, Dev, Hidden }` + a field on `Subcommand`
(`main.cpp:28-31`). `print_usage` shows Release; appends a Dev section only when
`ANDES_SIM_DEV` is set; Hidden is never listed. Dispatch is unchanged, so the
command surface stays stable (matches the file's stated F0 design intent).

| Tier | Commands | `--help` behavior |
|------|----------|-------------------|
| Release | `run`, `list` | always listed |
| Dev | `build`, `test`, `doctor` | listed only under `ANDES_SIM_DEV=1` |
| Hidden | `profile`, `cluster`, `archive`, `replay`, `estimate` | never listed; explicit invocation still hits the existing "not yet implemented" stub |

Not in dev mode, the release help ends with one hint line:
`(set ANDES_SIM_DEV=1 to show developer commands)`.

## Change A - hide "verilator" -> "vsim"

**Single normalization point.** Add an inline helper in
`driver/engine_registry.hpp` (mirroring the existing inline `resolve_accurate_engine`):

```cpp
inline void normalize_engine_label(EngineDescriptor& d) {
  // The vsim binary self-reports the third-party simulator name; the product
  // surface speaks "vsim". One translation point so every downstream consumer
  // (list / --engine / errors / banner) sees the product id.
  if (d.type == "verilator") d.type = "vsim";
  if (d.id.rfind("verilator:", 0) == 0) d.id = "vsim:" + d.id.substr(10);
}
```

Call it in `engine_registry.cpp` `scan_dir`, right after `describe_one` succeeds
and **before** the `seen.insert(d.id)` dedup, so dedup and everything downstream
key on the product id. `builtin_qemu` ("qemu"/"qemu") is unaffected.

**Static prose** (the non-discovery sites):
- `main.cpp:56` tagline -> drop "Verilator" (e.g. "Multi-engine driver for the
  Andes simulators (QEMU + vsim).").
- `main.cpp:73` `--engine` example -> `vsim:ax45mpv_premium`.
- `models.hpp:23,25,26` (the `list models` ENGINES/NOTES cells) -> `vsim`.

**Load-bearing test filter:** `plan_itest.cpp:36` filters discovered engines by
`e.type == "verilator"` -> change to `"vsim"` (discovered engines are now vsim).

Leave: in-source code comments, and every **real filesystem path** (`verilator/build`,
`verilator/CMakeLists.txt`, `VSIM_VERILATOR_EXECUTABLE`) - those name the on-disk
submodule / the actual tool, not the product engine label.

## Change B - release/dev tiers

In `driver/main.cpp` only:
- `Subcommand` gains `Tier tier;`; tag each entry per the table above.
- `print_usage`: iterate Release entries; if `ANDES_SIM_DEV` is set (a small
  `is_dev_mode()` = `getenv("ANDES_SIM_DEV")` non-empty), print a
  `developer commands:` section of Dev entries; else print the hint line.
- Dispatch (`main.cpp:116-119`) unchanged. `build`/`doctor` still run; `test` +
  the Hidden five still fall through to "not yet implemented".

## Tests (strict TDD: RED first, then implement)

**1. Normalization (unit) - extend `driver/run_test.cpp`** (already includes
   `engine_registry.hpp`; no new target, no CMake change):
   - RED: assert `normalize_engine_label` maps `{type:"verilator",
     id:"verilator:ax45mpv_premium"}` -> `{vsim, vsim:ax45mpv_premium}`; leaves
     `qemu`/`qemu` and a non-verilator type (`alioth:x`) untouched. Fails to
     compile until the helper exists.
   - GREEN: add the inline helper; wire the `scan_dir` call.

**2. Release surface (acceptance) - new
   `tests/andes_sim/test_andes_sim_release_surface.sh`** (shell, guarded like the
   other `tests/andes_sim/*` scripts, sources `tests/lib/log.sh`):
   - RED (run against the current binary first to show it fails):
     - `--help`: matches `run`,`list`; does NOT match
       `build|test|doctor|profile|cluster|archive|replay|estimate`; does NOT
       match `-i verilator`; matches the dev hint.
     - `ANDES_SIM_DEV=1 --help`: matches `build`,`test`,`doctor`; still no
       `verilator`; still no `profile|cluster|...`.
     - `run --help`: matches `vsim:`, not `verilator:`.
     - `list models`: no `verilator`, has `vsim`.
     - `list engines` via a fake `ANDES_SIM_ENGINES_DIR` engine that
       self-describes `"type":"verilator"` (reuse the `mkengine` pattern from
       `test_andes_sim_f8.sh`): output shows `vsim:`, never `verilator` -> proves
       the normalization end to end, deterministically, no real sim_* needed.
   - GREEN: implement A + B, rebuild, rerun -> all green.

**3. Update existing tests to the vsim contract** (the id contract changed; tests
   that encode the old label move with it):
   - Must change (discovery renames them, else they break): `test_andes_sim_f2.sh`,
     `test_andes_sim_f3.sh`, `test_andes_sim_f8.sh` (fake-engine ids + the
     `'no engine ...'` / `'multiple cycle-accurate ...'` greps), and the
     `ENG=` var in `test_andes_sim_f9.sh`.
   - Consistency (still pass, but should not show a stale label): the
     `--engine verilator:*` / id literals in `cli_test.cpp`, `run_test.cpp`,
     `plan_test.cpp`, `test_andes_sim_f7.sh`, and `json_test.cpp`'s sample
     descriptor.
   - Leave real-path refs (`verilator/build/sim_*`, `verilator/CMakeLists.txt`).

## Docs

`docs/USER_GUIDE.md`: update the **CLI-surface** references only - the command
listing, any `--engine`/engine-id example, and the `list engines` sample output
-> `vsim`. Leave the build/setup sections that legitimately discuss Verilator the
tool and the `verilator/` submodule path (lines ~87,114,177,231,285,297,303,309).

## Key files

| File | Change |
|------|--------|
| `driver/engine_registry.hpp` | NEW inline `normalize_engine_label` |
| `driver/engine_registry.cpp` | call it in `scan_dir` before dedup |
| `driver/main.cpp` | `Tier` enum + field; tier-filtered `print_usage` + dev reveal; tagline/`--engine` prose |
| `driver/models.hpp` | `list models` cells -> `vsim` |
| `driver/run_test.cpp` | RED: normalize unit cases (+ id-literal consistency) |
| `driver/plan_itest.cpp` | `type=="vsim"` filter |
| `tests/andes_sim/test_andes_sim_release_surface.sh` | NEW acceptance |
| `tests/andes_sim/test_andes_sim_f{2,3,8,9,7}.sh` | ids/greps -> `vsim` |
| `driver/{cli,plan,json}_test.cpp` | id-literal consistency |
| `docs/USER_GUIDE.md` | CLI-surface refs -> `vsim` |

## Reuse
`resolve_accurate_engine` inline pattern (model for the new inline helper),
`mkengine` fake-engine pattern (`test_andes_sim_f8.sh`), `expect`/`fail`/`ok`
(`tests/lib/log.sh`), `discover_engines`/`scan_dir` (the single seam).

## Verification
- Build: `bash scripts/build_driver.sh`
- Unit (RED then GREEN): `./build/driver/andes-sim-run-test`
- Acceptance: `bash tests/andes_sim/test_andes_sim_release_surface.sh`
- Regression (vsim contract): `bash tests/andes_sim/test_andes_sim_f2.sh`,
  `...f3.sh`, `...f8.sh`; and the full driver unit set
  (`for t in cli plan json run elf-syms hybrid; do ./build/driver/andes-sim-$t-test; done`)
- Manual smoke:
  `./build/andes-sim --help`  (only run/list + hint),
  `ANDES_SIM_DEV=1 ./build/andes-sim --help`  (adds build/test/doctor),
  `./build/andes-sim list engines`  (vsim: ids, no "verilator")

## Commit split (when you later ask to commit)
Two behavioral units, each with its tests: (1) verilator->vsim rename +
normalization; (2) release/dev tiering. The `Tier` enum/field is introduced with
its tagging in unit (2) - no separate structural commit is warranted (it changes
output immediately).
