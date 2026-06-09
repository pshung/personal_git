# F9 - `run --model hybrid` (csr | pc | icount triggers)

## Context

F9 is the next ROADMAP feature (F0-F8 done). Today `andes-sim run --model hybrid`
prints `not yet implemented`. The goal: orchestrate a real QEMU1 -> vsim handoff
for the three kernel/window triggers and print the cycle figure - matching the
Python golden `hsim`'s numbers, and replacing its `tests/e2e.sh` delegation.

Good news: **F6 already does the hard part.** `run_plan` (driver/run_plan.cpp)
spawns `[qemu fast-leg -> vsim accurate-leg]`, threads the drained
`hybrid_state_v1`, and reads each leg's `mcycle`. `plan_itest.cpp` proves the
**csr** trigger runs end-to-end and `vsim_mcycle > qemu_mcycle`. So F9 is mostly:
teach the plan the **pc** and **icount** trigger args, port the ELF symbol
lookup, add the CLI flags, and wire `cmd_run` to build+run the plan and print.

Golden behavior I verified directly (real `hsim`, not the hallucinated `hsim.py`):
- QEMU leg (all triggers): `-object memory-backend-file...` + `-plugin {plugin},outfile={state},<trig>`, exits 200. (`hsim:725-755`, `e2e.sh:111-118`)
- vsim leg: `{elf} --resume-from-qemu {in} --handoff-out {out} --shared-mem-{path,size,base} <trig>`, exits 200. (`e2e.sh:134-142`)
- Trigger args: **csr** none; **pc** plugin `,enter_pc=0x<start>` + vsim `--hybrid-exit-pc 0x<end>`; **icount** plugin `,icount=<N>` + vsim `--hybrid-icount <M>`. (`e2e.sh:85-89`, `hsim:275,361`)
- Cycle line: `[<label> window_cycles] <V-Q>  (vsim mcycle=<V> - qemu mcycle=<Q>)`. (`hsim:465`)
- pc boundary = symbol name or `0x` addr, resolved against the ELF symtab. (`tests/lib/roi.sh:15-21`)
- Defaults: qemu-icount 10000, vsim-icount 5000, mmap 128 MiB. (`hsim:1304-1342`)

## Core architecture (the one new idea: trigger -> per-leg argv)

Everything else reuses F6. A trigger contributes args to each leg, **chosen by
the leg's role**:

```
                fast-leg (qemu)                    accurate-leg (vsim)
  csr      (nothing)                          (nothing)
  pc       ,enter_pc=0x<start>  (plugin tok)  --hybrid-exit-pc 0x<end>  (extra tokens)
  icount   ,icount=<N>          (plugin tok)  --hybrid-icount <M>       (extra tokens)
```

Two mechanisms, because QEMU plugin args MUST be a comma-suffix inside the one
`-plugin` token, while vsim args are normal separate tokens:
- **qemu**: a `{trigger}` placeholder folded into the plugin token; the framework
  fills it with the comma-suffix (or `""`).
- **vsim**: extra tokens appended after the filled template.

New pure helper `leg_trigger_args(Trigger, role) -> {plugin_suffix, extra[]}` in
`run_plan.{hpp,cpp}`. `plan_argvs` calls it per step: sets `ctx["trigger"] =
plugin_suffix`, then appends `extra[]` after `build_argv`.

**Why framework-side, not in `--describe`:** the engine contract lists trigger
*names* only (`triggers: [...]`); the canonical flag spellings are framework
knowledge - the same ones the Python golden hardcodes. A per-trigger argv
template in `--describe` is a later purist extension, not F9.

User-forwarded vsim extras (`--vsim-warmup-icount`, later `--kanata`) are NOT
trigger args: add a `Step.extra_args` field, appended last by `plan_argvs`.

## Increments (strict TDD: one failing test -> minimal code -> next)

**1. ELF symbol resolver** - new `driver/elf_syms.{hpp,cpp}` + `elf_syms_test.cpp`.
   `resolve_pc(elf, boundary, &err) -> bare-hex string`. `0x<h>`/`0X<h>` -> `<h>`
   verbatim; else read the ELF `.symtab` directly via `<elf.h>` (`Elf64_Ehdr/Shdr/Sym`,
   find `SHT_SYMTAB` + its strtab, match name -> `st_value`); unknown symbol ->
   `""` + err. Port of `tests/lib/roi.sh:resolve_pc`, but reading the symtab in
   C++ (no `nm` shell-out), per the ROADMAP. RED: 0x passthrough, a known symbol
   from a built fixture, unknown-symbol error.

**2. Trigger -> argv** - extend `plan_argvs` + `plan_test.cpp`. Add
   `leg_trigger_args`; change the builtin_qemu fast-leg plugin token
   `"{plugin},outfile={state_out}"` -> `"...{state_out}{trigger}"`
   (`engine_registry.cpp:46`); append `Step.extra_args`. RED in plan_test: pc step
   -> qemu argv has `enter_pc=0x..`, vsim argv has `--hybrid-exit-pc 0x..`; icount
   similar; **csr unchanged** (plan_itest stays green).

**3. CLI flags** - extend `Cli` + `parse_cli` + `cli_test.cpp`. Add string fields
   `pc_start, pc_end, qemu_icount, vsim_icount, mmap_size, vsim_warmup_icount`
   (empty = default; reuse the `match_opt` table in `cli.cpp:57-63`).

**4. `cmd_run` hybrid arm** - `driver/cmd_run.cpp` + a pure unit test + an
   acceptance script.
   - 4a (pure, in `run_test.cpp`): `hybrid_trigger(cli, elf, &err) -> Trigger`
     - csr `{}`; pc resolves start/end via `resolve_pc` and stores `enter_pc`/
       `exit_pc` (with `0x`); icount applies the 10000/5000 defaults. RED first.
   - 4b (wire `run_hybrid`): validate one ELF (reuse `check_one_elf`), default
     `--trigger` to `csr`, require `--pc-start`/`--pc-end` for pc; discover
     engines, `resolve_accurate_engine` (reuse, `engine_registry.hpp:42`); build
     the 2-step `Plan` (mmap via `parse_size`, default 128 MiB); set accurate-leg
     `extra_args` for warmup; `run_plan`; on success print a short banner + the
     `window_cycles` line + `PASS`, on failure print the error and return 1.
   - Acceptance `tests/andes_sim/test_andes_sim_f9.sh`: run csr / pc / icount on
     fixtures, assert the `window_cycles` line and a positive number; pc with a
     **symbol** AND a **0x** boundary. **Parity:** for each, also run
     `./hsim run --mode <m> ...`, extract the integer from
     `] <N>  (vsim mcycle=`, assert equal to andes-sim's.

**5. (stretch, only if 1-4 land clean) `--kanata`/`--objdump` forward** - same
   `Step.extra_args` path: csr/pc only, `--objdump` requires `--kanata`, emit
   `--kanata <f> --kanata-roi [--objdump <f>]` (`e2e.sh:102-107`). Visualization
   only, not in the done-when - deferred if the session is full.

## Key files

| File | Change |
|------|--------|
| `driver/elf_syms.{hpp,cpp}` | NEW - symtab symbol/0x resolver |
| `driver/elf_syms_test.cpp` | NEW - unit test |
| `driver/run_plan.{hpp,cpp}` | `leg_trigger_args`; `plan_argvs` applies trigger + `extra_args` |
| `driver/plan.hpp` | `Step.extra_args` field |
| `driver/engine_registry.cpp` | fast-leg plugin token gains `{trigger}` |
| `driver/cli.{hpp,cpp}` | new hybrid flags |
| `driver/cmd_run.cpp` | `run_hybrid` + `hybrid_trigger` |
| `driver/CMakeLists.txt` | add `elf_syms.cpp` to `andes-sim`; new `elf-syms-test`; add `elf_syms.cpp` to run-test target |
| `driver/{plan,cli,run}_test.cpp` | new cases |
| `tests/andes_sim/test_andes_sim_f9.sh` | NEW - acceptance + parity |
| `driver/ROADMAP.md` | F9 State -> DONE |

## Reuse (no reinvention)
`run_plan`/`plan_argvs`/`build_argv` (F6), `resolve_accurate_engine` +
`builtin_qemu` (engine_registry.hpp), `parse_size` (shm.hpp), `check_one_elf`
(cmd_run.cpp), `read_state_file` (state.hpp), `match_opt` (cli.cpp).

## Verification
- Build: `bash scripts/build_driver.sh`
- Unit: `./build/andes-sim-elf-syms-test && ./build/andes-sim-plan-test && ./build/andes-sim-cli-test && ./build/andes-sim-run-test` (all print `... OK`)
- Integration (real qemu+vsim): `./build/andes-sim-plan-itest` (csr still green)
- Acceptance + parity: `bash tests/andes_sim/test_andes_sim_f9.sh`
- Manual smoke:
  `./build/andes-sim run --model hybrid --trigger csr tests/fixtures/handoff_roundtrip.elf`
  `./build/andes-sim run --model hybrid --trigger icount tests/fixtures/icount_spin.elf`

## Notes / one deliberate divergence
- **icount keeps `--shared-mem-*`** (the Python inline path omits them). One
  vsim template serves all triggers; the shared mmap is harmless for asm icount
  fixtures (CLAUDE.md already says asm fixtures use it anyway). The acceptance
  test's icount parity check confirms the cycle number is unchanged; if it
  diverges I'll add a no-mem variant, but I expect a tight loop's mcycle to be
  identical.
- csr/pc output changes from e2e.sh's full log to the one-line window-cycles
  figure (ROADMAP-sanctioned; the number is unchanged).
- No per-leg `--` passthrough and no QEMU2 (both out of scope by design).
