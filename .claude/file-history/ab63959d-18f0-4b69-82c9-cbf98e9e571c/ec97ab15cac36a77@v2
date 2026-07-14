# Plan: `andesim profile` command (fold build/hotloops in, rename to hotIterationLoop)

## Context

`build/hotloops` is today a SEPARATE executable (`driver/hotloops.cpp`, CMake target
`hotloops` at driver/CMakeLists.txt:69). It launches QEMU with the TCG plugin
`qemu_plugin/libhotloops.so`, finds hot loops (backward TB edges), and prints a
report whose `measure: --pc-start .. --pc-end ..` lines feed hybrid runs.

Problems this change fixes:
- The tool hardcodes the QEMU shape (`-cpu andes-ax45mpv,vext_spec=v1.0,vlen=1024`,
  own QEMU lookup that ignores `$VSIM_QEMU`). The profile should run with the SAME
  QEMU config as the engine you will measure on (cpu model, vlen, readconfig) --
  vlen changes loop trip counts, so a wrong vlen gives wrong hot-loop ranking.
- It is an extra binary next to `./andesim`; the user wants one entry point.

Deliverable: a new `andesim profile` subcommand that (like hybrid) picks a vsim
engine and passes that engine's QEMU cfg to the QEMU launch; delete `build/hotloops`;
rename the feature `hotloops -> hotIterationLoop`.

## Decisions (user picked / defaults used when user was away - veto here if wrong)

1. Naming: literal `hotIterationLoop` everywhere:
   `qemu_plugin/hotIterationLoop.c`, `libhotIterationLoop.so`,
   report title `# HotIterationLoop Report`, log prefix `hotIterationLoop:`.
2. CLI keeps only the report flags (see below). QEMU-shape flags are dropped
   (`--qemu --plugin --machine --cpu --qemu-config --arch --cwd --qemu-arg`):
   engine + config.env decide those; extra QEMU args go after `--`.
3. `docs/hotloops.md` is rewritten as `docs/profile.md`.
4. The TCG plugin stays a `.so` (QEMU requires it); only the driver-side
   standalone binary is deleted.
5. Old tool ignored QEMU's exit code. New: hard error if the spawn fails;
   warn (log_line) if guest rc != 0, but still produce the report.

## New CLI surface

```
andesim profile [--engine <id>] [--mem-size <spec>]
                [--limit N] [--min-iters N]
                [--raw] [--llm|--no-llm] [--optimize-rvv|--no-optimize-rvv]
                [--no-source] [--objdump <bin>] [--addr2line <bin>]
                [--dry-run] [--log-level N] [--log-file F]
                <ELF> [-- <extra qemu args>]
```

- Engine pick = exactly hybrid's: `discover_engines()` +
  `resolve_accurate_engine()` (engine_registry.hpp:77-119). No `--engine` ->
  the sole cycle-accurate engine; zero or many -> the same errors hybrid gives.
- QEMU cfg = probe `<engine> --print-qemu-config` via `run_process`, then
  `stage_qemu_cfg()` (workdir/qemu.cfg -> `-readconfig`) and
  `qemu_cpu_from_cfg()` -> `-cpu <model>,vlen=<synced_vlen(engine.vlen)>`.
  All three helpers already exported in run_plan.hpp:73-85; same direct-call
  pattern as cmd_run.cpp:479-487 (--print-memmap branch).
  Probe failure -> tolerant fallback (default cpu) + a WARN log (hybrid is
  silent; for profile the engine cfg is the whole point).
- QEMU binary from the registry path (`builtin_qemu_arch(xlen)`,
  engine_registry.cpp:76-84: `$VSIM_QEMU` -> config.env `QEMU_BIN_DIR` ->
  build/qemu). Fixes the old tool's narrower lookup.
- Arch from the ELF header (port `detect_arch`, hotloops.cpp:160-170); reject
  ELF/engine xlen mismatch like hybrid does.
- QEMU argv shape (mirrors old tool + engine cfg):
  `<qemu> -plugin <so>,limit=N,min_iters=M -d plugin -D <workdir>/plugin.log
   -M andes_ae350 -cpu <model>,vlen=<V> -nographic -semihosting -bios <elf>
   [-m <mem-size>] [-readconfig <workdir>/qemu.cfg] [passthrough...]`
- profile rejects run-only flags if set: `--mode --trigger --pc-start --pc-end
  --verify --kanata --gdb --print-memmap`.

## Files

New:
- `driver/profile.hpp/.cpp` - pure, unit-testable logic ported from
  hotloops.cpp (printf -> returned std::string):
  `parse_plugin_log(text) -> vector<LoopEdge>`, `parse_disasm(text)`,
  `is_rvv(mn)`, `filter_loops(rows, min_iters, rvv_only, disasm, limit)`,
  `build_loops(rows, limit)` (nesting), `render_llm(...) -> string`,
  `render_table(...) -> string`, `profile_qemu_argv(...) -> vector<string>`.
  Symbol/source lookups are precomputed by the caller and passed in as plain
  data so renders stay pure.
- `driver/cmd_profile.cpp` - IO orchestration: validate flags -> arch detect ->
  engine resolve -> probe/stage cfg -> argv -> spawn QEMU (a primitive that
  RETURNS rc and shows guest output, e.g. run_line_filtered; check
  process.cpp:153-159 first - exec_passthrough may replace the process) ->
  `--raw` dump -> objdump/addr2line (keep old lookup chain: flag ->
  $HYBRID_TOOLCHAIN -> generic) -> report to stdout.
- `driver/profile_test.cpp` - unit tests (test_check.hpp convention).
- `tests/andes_sim/test_andes_sim_profile.sh` - contract test with fake
  engines (ANDESIM_ENGINES_DIR, mkengine pattern from test_andes_sim_f8.sh:
  scripts answering `--describe` JSON and `--print-qemu-config`):
  no-engine error, ambiguous error, `--engine` pick, `--dry-run` argv asserts
  (-plugin ...,limit=,min_iters=, -readconfig, -cpu ...,vlen=512, -bios).

Modified:
- `driver/cli.cpp` (+`cli.hpp`): `is_subcommand` += "profile" (cli.cpp:30);
  new fields+flags: limit ("50"), min_iters ("1"), raw, llm (default true),
  optimize_rvv (default true), no_source, addr2line. `--objdump` already exists.
- `driver/main.cpp`: fwd decl + dispatch (:18-20, :196-198), kProfileOpts +
  `print_profile_block`, hook into print_usage/print_subcommand_help.
- `driver/CMakeLists.txt`: add profile.cpp/cmd_profile.cpp to andesim; add
  andesim-profile-test; DELETE the `hotloops` target (:68-73).
- `qemu_plugin/`: git mv hotloops.c -> hotIterationLoop.c; Makefile rules ->
  libhotIterationLoop.so; "hotloops:" prefixes -> "hotIterationLoop:".
- `scripts/build_qemu_plugin.sh`: comment/usage strings.
- `tests/plugin/test_plugin_hotloops_measure.sh` -> git mv
  test_plugin_hotIterationLoop_measure.sh; rewrite to call
  `./andesim profile --min-iters 10 <elf>` with a fake engine dir (real QEMU,
  vlen=512 via fake describe) - keeps the nm/objdump oracle asserts on the
  `measure:` line.

Deleted:
- `driver/hotloops.cpp` (fully replaced; no legacy patching).

Docs (simple English):
- git mv `docs/hotloops.md` -> `docs/profile.md`; rewrite around
  `andesim profile`; fix stale `pc_range:` examples (code emits `function:` +
  `measure:` today).
- `docs/USER_GUIDE.md`: new top-level section after current sec 5 (renumber
  6-9); update refs at :216 :221 :644 :664.
- `README.md:45` + `CLAUDE.md:59` build-output bullets (new .so name; drop
  build/hotloops).
- NOT renamed: docs/MRD.md:213 ("hot loop" prose, unrelated).

## Commit sequence (Tidy First; each runs scripts/build_driver.sh + unit tests)

- C1 (structural): extract pure logic into driver/profile.{hpp,cpp} + RED
  profile_test.cpp first (parse_plugin_log on canned log text, filter/RVV,
  build_loops nesting incl. parent=smallest enclosing range, render smoke,
  argv builder), then port code until GREEN. hotloops.cpp untouched (one-commit
  transitional duplication, deleted in C3).
- C2 (behavioral): the profile subcommand. RED: cli_test.cpp cases
  (subcommand=="profile", new flags, bool pairs) -> GREEN cli.cpp; RED argv/
  validation unit cases -> GREEN cmd_profile.cpp + main.cpp + CMake; contract
  test test_andes_sim_profile.sh (fake engines + --dry-run). Still uses the
  OLD .so name here.
- C3 (behavioral): delete build/hotloops. Remove driver/hotloops.cpp + CMake
  target; port the tests/plugin measure test to `./andesim profile` (this
  script is the failing-then-passing test for the fold).
- C4 (structural): the rename. git mv plugin source + test file, Makefile,
  prefix strings, plugin-path constant in cmd_profile, build script comments.
  Rebuild plugin + rerun measure test before/after.
- C5 (docs): docs/profile.md, USER_GUIDE.md, README.md, CLAUDE.md.

## Verification

1. `bash scripts/build_driver.sh` then run `build/driver/andesim-cli-test`,
   `build/driver/andesim-profile-test` (and the rest of andesim-*-test).
2. `make -C qemu_plugin` -> libhotIterationLoop.so exists; old name gone.
3. `bash tests/andes_sim/test_andes_sim_profile.sh` (fake-engine contract).
4. `bash tests/plugin/test_plugin_hotIterationLoop_measure.sh` (real QEMU +
   vplat RVV fixture; oracle-checked measure window).
5. Real run: `./andesim profile --min-iters 10 <rvv fixture elf>` with the
   real engine (ax45mpv_premium): report shows `[hottest]`, `measure:` line;
   `--dry-run` shows the full argv incl. -readconfig and -cpu ...,vlen=512.
6. `bash scripts/test_all.sh` (unit + contract phases; e2e unaffected but run).

## Risks / notes

- exec_passthrough may be a true exec (process.cpp:153-155) - if so use
  run_line_filtered or fork+wait for the QEMU spawn.
- check_one_elf / elf_engine_arch_error are static in cmd_run.cpp - hoist to a
  small shared header (tiny structural pre-step inside C2) instead of copying.
- Cli parse is global: new flags are syntactically visible to run/list; only
  profile validates them (matches existing convention).
- Fake-engine --print-qemu-config output must be a valid -readconfig file;
  copy the format from a real engine probe when writing the test.
- The e2e/hybrid path never loads this plugin (only libhybrid_handoff.so), so
  the rename cannot break run/hybrid; setup.sh builds both .so via `make all`
  with no name reference.
- Untracked in-flight assets in .claude/worktrees/f6-last-mile (scripts/
  hotloops.sh, extra plugin tests) are OUT of scope - not touched.
