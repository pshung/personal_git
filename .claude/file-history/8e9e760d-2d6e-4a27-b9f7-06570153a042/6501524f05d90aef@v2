# hybrid_sim structural redesign: pull the driver out of the submodules

## Context

The workspace `/home/nick/work/hybrid_sim/` pins two submodules on branch `hybrid`:

- `hybrid_qemu/` — QEMU 9.2.0 + Andes vendor patches. **Audited:** 404 commits ahead of upstream `v9.2.0`, zero of which mention `hybrid`, `0x7C0`, `handoff`, `vsim`, or co-sim. The branch name is just a pin marker; the QEMU fork is effectively pure.
- `hybrid_vsim/` — vsim cycle-accurate simulator. Currently carries a sprawl of hybrid co-sim assets: a wire-format ABI (`hybrid/include/hybrid/*.h`), the QEMU TCG plugin (`hybrid/qemu_plugin/`), bare-metal RV64 fixtures (`hybrid/test/`), the e2e shell drivers (`tests/hybrid/*.sh`), AND deeply integrated C++ glue (`src/hybrid/*.hpp`).

Today the top-level repo is just `build.sh` + `README.md` + `CLAUDE.md` + `.gitmodules`. There is no top-level CMake project, no top-level `tests/`, and no top-level `include/`. Everything driver-flavored lives one level deep, inside vsim.

The intent of this redesign: make each submodule's responsibility legible at a glance.
- `hybrid_qemu/` should look like "an Andes QEMU fork" — touched.
- `hybrid_vsim/` should look like "the cycle-accurate simulator, with one optional integration adapter (`src/hybrid/`)" — not "the simulator + the entire hybrid driver."
- `hybrid_sim/` becomes the home of "the hybrid co-sim driver": the wire ABI, the QEMU-side adapter, the fixtures that exercise both halves, and the orchestration that runs the round-trip.

User decisions locked: (1) extract **wire artifacts only**, leave `src/hybrid/*.hpp` inside vsim because each header includes Simulator/Platform/JTAG/SystemC types and decoupling them would force a vsim refactor; (2) make `hybrid_sim/` a **real CMake project** (top-level `CMakeLists.txt`) — `build.sh` becomes a convenience wrapper. `hybrid_qemu/` is **untouched**.

## Final target layout

```
hybrid_sim/
├── CMakeLists.txt                  NEW: project(hybrid_sim); add_subdirectory(hybrid_vsim) + plugin/fixtures/e2e
├── build.sh                        EDITED: thin wrapper around cmake/ctest + standalone QEMU configure
├── README.md, CLAUDE.md            EDITED: path references updated
├── cmake/
│   ├── HybridPlugin.cmake          NEW: ExternalProject for libhybrid_handoff.so via existing Makefile
│   ├── HybridFixtures.cmake        NEW: custom_command driving fixtures/Makefile
│   └── HybridE2E.cmake             NEW: foreach add_test() over tests/rt_*.sh
├── include/hybrid/                 MOVED from hybrid_vsim/hybrid/include/hybrid/
│   ├── state_abi.h
│   ├── state_abi_check.h
│   ├── insn_match.h
│   └── reg_names.h
├── qemu_plugin/                    MOVED from hybrid_vsim/hybrid/qemu_plugin/
│   ├── Makefile                    UNCHANGED (-I../include resolves to sibling include/)
│   └── hybrid_handoff.c
├── fixtures/                       MOVED from hybrid_vsim/hybrid/test/ (rename: test -> fixtures)
│   ├── Makefile, *.S, *.ld, semihost_exit.inc
├── tests/                          MOVED *.sh + qemu_silent_stub.py from hybrid_vsim/tests/hybrid/
│   ├── roundtrip_e2e.sh, rt_corrupt_state.sh, rt_gdbstub_timeout.sh,
│   │   rt_no_qemu_binary.sh, rt_shared_mem.sh, qemu_silent_stub.py
├── hybrid_qemu/                    UNCHANGED submodule
└── hybrid_vsim/                    SLIMMED submodule:
    ├── src/hybrid/*.hpp                          STAYS (vsim-internal C++ glue)
    ├── tests/hybrid/*.test.cpp + dmi_smoke.cpp +
    │   handoff_smoke.cpp + insn_encoders.hpp +
    │   recording_bus.hpp                         STAYS (link vsim libs)
    ├── cmake/HybridConfig.cmake                  SLIMMED: unit tests only; gated on HYBRID_DRIVER_DIR
    └── hybrid/                                   REMOVED entirely
```

## Coupling contract

A single CMake cache variable connects vsim to the driver: `HYBRID_DRIVER_DIR`. When `hybrid_sim/CMakeLists.txt` does `add_subdirectory(hybrid_vsim)`, it sets `HYBRID_DRIVER_DIR=${CMAKE_SOURCE_DIR}` first. `hybrid_vsim/cmake/HybridConfig.cmake` reads that variable and uses `${HYBRID_DRIVER_DIR}/include` as the include path for hybrid unit tests; if unset (standalone vsim clone), the affected `vsim_add_test()` calls are gated behind `if(HYBRID_DRIVER_DIR)` and skipped silently. Standalone vsim still configures and builds; only the hybrid unit tests are unavailable in that mode.

Wire ABI itself (`hybrid_state_v1`, `HYBRID_STATE_VERSION`, `static_assert` offsets) is **bit-for-bit unchanged**. This restructure is path moves only.

## File-by-file action list

| PATH | ACTION | NEW PATH | NOTES |
|------|--------|----------|-------|
| `hybrid_vsim/hybrid/include/hybrid/{state_abi,state_abi_check,insn_match,reg_names}.h` | MOVE | `hybrid_sim/include/hybrid/` | canonical wire-ABI; one source of truth |
| `hybrid_vsim/hybrid/qemu_plugin/{hybrid_handoff.c,Makefile}` | MOVE | `hybrid_sim/qemu_plugin/` | Makefile `-I../include` resolves to `hybrid_sim/include/` — no Makefile edit |
| `hybrid_vsim/hybrid/test/*` (.S, .ld, .inc, Makefile) | MOVE | `hybrid_sim/fixtures/` | rename dir for clarity |
| `hybrid_vsim/tests/hybrid/{roundtrip_e2e,rt_corrupt_state,rt_gdbstub_timeout,rt_no_qemu_binary,rt_shared_mem}.sh` | MOVE+EDIT | `hybrid_sim/tests/` | edit `REPO_ROOT=$SCRIPT_DIR/../..` → `REPO_ROOT=$SCRIPT_DIR/..`; replace `$REPO_ROOT/hybrid/qemu_plugin/` → `$REPO_ROOT/qemu_plugin/`; `$REPO_ROOT/hybrid/test/` → `$REPO_ROOT/fixtures/`; `$REPO_ROOT/build/sim_*` → `$REPO_ROOT/hybrid_vsim/build/sim_*` (or `$REPO_ROOT/build/hybrid_vsim/sim_*` if top-level cmake nests it) |
| `hybrid_vsim/tests/hybrid/qemu_silent_stub.py` | MOVE | `hybrid_sim/tests/` | helper for rt_gdbstub_timeout |
| `hybrid_vsim/cmake/HybridConfig.cmake` | EDIT (slim) | (same) | (a) replace 9 `${CMAKE_SOURCE_DIR}/hybrid/include` → `${HYBRID_DRIVER_DIR}/include`; (b) wrap each affected `vsim_add_test` block in `if(HYBRID_DRIVER_DIR)`; (c) **delete** lines 91-151 (the e2e foreach + tier-2 + negative-test foreach) — moved to `hybrid_sim/cmake/HybridE2E.cmake` |
| `hybrid_vsim/CMakeLists.txt` (line ~455 area, `vsim_add_cpu_executable`) | EDIT | (same) | the `${CMAKE_SOURCE_DIR}/hybrid/include` reference becomes `${HYBRID_DRIVER_DIR}/include`, gated `if(HYBRID_DRIVER_DIR)` |
| `hybrid_vsim/CMakeLists.txt` (top) | EDIT | (same) | add `set(HYBRID_DRIVER_DIR "" CACHE PATH "Path to the hybrid_sim driver workspace")` near other cache vars |
| `hybrid_vsim/hybrid/scripts/test_dm_coverage.tcl` | MOVE | `hybrid_vsim/scripts/dm_coverage.tcl` | human-run only; vsim-runtime debug tool, stays in vsim |
| `hybrid_vsim/hybrid/` directory | DELETE (after parent imports) | — | sequenced: parent commits-in first, vsim deletes second |
| `hybrid_sim/CMakeLists.txt` | CREATE | (new) | `project(hybrid_sim)`, `set(HYBRID_DRIVER_DIR "${CMAKE_SOURCE_DIR}")`, `set(VSIM_QEMU_ROOT "${CMAKE_SOURCE_DIR}/hybrid_qemu" CACHE ... FORCE)`, `set(VSIM_ENABLE_HYBRID ON CACHE ... FORCE)`, `add_subdirectory(hybrid_vsim)`, `enable_testing()`, `include(cmake/HybridPlugin.cmake)`, `include(cmake/HybridFixtures.cmake)`, `include(cmake/HybridE2E.cmake)` |
| `hybrid_sim/cmake/HybridPlugin.cmake` | CREATE | (new) | `ExternalProject_Add(hybrid_handoff_plugin SOURCE_DIR ${CMAKE_SOURCE_DIR}/qemu_plugin BUILD_IN_SOURCE 1 CONFIGURE_COMMAND "" BUILD_COMMAND make QEMU_ROOT=${CMAKE_SOURCE_DIR}/hybrid_qemu INSTALL_COMMAND "")`; output is `${CMAKE_SOURCE_DIR}/qemu_plugin/libhybrid_handoff.so` |
| `hybrid_sim/cmake/HybridFixtures.cmake` | CREATE | (new) | similar ExternalProject driving `make -C ${CMAKE_SOURCE_DIR}/fixtures` |
| `hybrid_sim/cmake/HybridE2E.cmake` | CREATE | (new) | the foreach over `VSIM_RT_FIXTURES`, the tier-2 `test_e2e_rt_shared_mem`, and the negative-test foreach — verbatim from the old vsim block, but bash invocations now reference `${CMAKE_SOURCE_DIR}/tests/<name>.sh` and ELFs at `${CMAKE_SOURCE_DIR}/fixtures/<name>.elf` |
| `hybrid_sim/build.sh` | EDIT | (same) | thin wrapper: `qemu` → existing autotools/meson sequence (QEMU not under CMake); `configure` → `cmake -S "$ROOT" -B "$ROOT/build" -GNinja`; `vsim`/`plugin`/`fixtures` → `cmake --build "$ROOT/build" --target {vsim,hybrid_handoff_plugin,hybrid_fixtures}`; `test` → `ctest --test-dir "$ROOT/build" -L hybrid-e2e --output-on-failure`; `all` → `qemu` then full `cmake --build` |
| `hybrid_sim/README.md` | EDIT | (same) | Outputs section: `hybrid_sim/build/hybrid_vsim/sim_*` (or wherever the nested vsim build lands), `hybrid_sim/qemu_plugin/libhybrid_handoff.so` |
| `hybrid_sim/CLAUDE.md` | EDIT | (same) | Architecture section: paths under `hybrid_sim/include/`, `hybrid_sim/qemu_plugin/`, `hybrid_sim/fixtures/`, `hybrid_sim/tests/`. The "Critical files" hybrid_vsim references stay. |
| `hybrid_sim/.gitmodules` | UNCHANGED | — | both submodules still pinned to `hybrid` branch |

## Migration commits

Submodule first, then superproject. Each commit independently green.

In **`hybrid_vsim`** (one feature branch off `hybrid`):

1. `structural: introduce HYBRID_DRIVER_DIR cache var; gate hybrid unit-test includes behind it.` Replace 9 `${CMAKE_SOURCE_DIR}/hybrid/include` → `${HYBRID_DRIVER_DIR}/include` with default `${CMAKE_SOURCE_DIR}` so existing in-tree resolution still works. Wrap affected `vsim_add_test()` calls in `if(HYBRID_DRIVER_DIR)`. **Verify:** `cmake -S . -B build && cmake --build build && ctest --test-dir build` — green identically to before; `cmake -S . -B build_off -DVSIM_ENABLE_HYBRID=OFF -DHYBRID_DRIVER_DIR=` succeeds without errors.

2. `structural: parameterize e2e shell paths via HYBRID_DRIVER_TESTS_DIR / _FIXTURES_DIR / _PLUGIN_SO.` Defaults pointing at the existing in-tree paths so behavior unchanged. **Verify:** `./build.sh test` from parent passes.

3. `structural: remove hybrid/ subtree; move test_dm_coverage.tcl to scripts/.` Done in lockstep with parent's commit-A. Removes vsim's copy of bucket-A files. **Verify:** parent must already host the moved files (parent commit-A merged first); `(cd hybrid_vsim && cmake -S . -B build && cmake --build build)` succeeds because HYBRID_DRIVER_DIR now resolves to the parent's `include/`.

In **`hybrid_sim`** (parent superproject):

A. `structural: import hybrid driver assets from hybrid_vsim.` Add `include/hybrid/`, `qemu_plugin/`, `fixtures/`, `tests/`. Add top-level `CMakeLists.txt` + `cmake/Hybrid{Plugin,Fixtures,E2E}.cmake`. Update `build.sh` to drive cmake/ctest. Update README + CLAUDE. **Verify:** `./build.sh clean && ./build.sh && ./build.sh test` green. Parent now has both the moved files AND vsim's old copy (vsim commit-3 not merged yet) — both must produce the same hashes. `diff -r hybrid_sim/include/hybrid hybrid_sim/hybrid_vsim/hybrid/include/hybrid` empty.

B. `structural: bump hybrid_vsim submodule pointer to commit 3 (post-removal).` Atomic: parent now has only one source of truth. **Verify:** `git submodule update --init --recursive` on a fresh clone, then `./build.sh && ./build.sh test` green. `find hybrid_vsim/hybrid -type f` empty (or directory absent).

C. (optional) `behavioral: prune stale path references in vsim docs (hybrid_plan.md, hybrid_vsim.md, test_plan.md).` Cosmetic doc sweep — ~30 stale strings. Not load-bearing.

Order discipline: vsim commits 1-2 land first → parent commits A → vsim commit 3 → parent commit B. Between commits A and 3, parent's worktree contains both copies (working state); after commit B, only one copy exists.

## Verification ladder

Each level requires the previous; all run from clean state.

1. `./build.sh clean && ./build.sh qemu` — QEMU still builds (untouched, sanity).
2. `./build.sh configure` — top-level cmake configures; `add_subdirectory(hybrid_vsim)` succeeds; HYBRID_DRIVER_DIR forwarded to vsim.
3. `cmake --build build --target vsim` — vsim links; `${HYBRID_DRIVER_DIR}/include` resolves.
4. `cmake --build build --target hybrid_handoff_plugin` — plugin builds; `-I../include` resolves to `hybrid_sim/include/` because plugin/include are siblings.
5. `cmake --build build --target hybrid_fixtures` — bare-metal RV64 ELFs build.
6. `ctest --test-dir build --output-on-failure` — vsim hybrid unit tests + e2e fixtures all PASS or SKIP (77), never FAIL.
7. `ctest --test-dir build -L hybrid-e2e --output-on-failure` — e2e label group only; nine `test_e2e_rt_*` cases all PASS.
8. **Standalone vsim sanity:** `cmake -S hybrid_vsim -B /tmp/standalone -DVSIM_ENABLE_HYBRID=OFF && cmake --build /tmp/standalone -j` — succeeds; non-hybrid unit tests pass; hybrid unit tests skip cleanly.
9. **Drift detection:** `grep -rn "${CMAKE_SOURCE_DIR}/hybrid/" hybrid_vsim/` — zero hits. `grep -rn "hybrid/qemu_plugin\|hybrid/test/" hybrid_sim/build.sh hybrid_sim/CLAUDE.md hybrid_sim/README.md` — zero hits.
10. **Submodule cleanliness:** `git -C hybrid_vsim status` clean; `git -C hybrid_qemu status` clean; both pinned to `hybrid` branch tip.
11. **Single source of truth:** `find hybrid_sim/hybrid_vsim/hybrid -type f` empty (or directory absent).

## Critical files

To create:
- `/home/nick/work/hybrid_sim/CMakeLists.txt`
- `/home/nick/work/hybrid_sim/cmake/HybridPlugin.cmake`
- `/home/nick/work/hybrid_sim/cmake/HybridFixtures.cmake`
- `/home/nick/work/hybrid_sim/cmake/HybridE2E.cmake`

To edit:
- `/home/nick/work/hybrid_sim/build.sh`
- `/home/nick/work/hybrid_sim/README.md`, `CLAUDE.md`
- `/home/nick/work/hybrid_sim/hybrid_vsim/CMakeLists.txt` (cache-var declaration + the `${CMAKE_SOURCE_DIR}/hybrid/include` site near `vsim_add_cpu_executable`)
- `/home/nick/work/hybrid_sim/hybrid_vsim/cmake/HybridConfig.cmake` (slim)
- five `hybrid_vsim/tests/hybrid/*.sh` scripts (after they move to `hybrid_sim/tests/`)

To move (with git history preserved via `git mv` from inside the submodule's worktree, then re-staged in parent):
- `hybrid_vsim/hybrid/include/hybrid/*.h` → `hybrid_sim/include/hybrid/`
- `hybrid_vsim/hybrid/qemu_plugin/*` → `hybrid_sim/qemu_plugin/`
- `hybrid_vsim/hybrid/test/*` → `hybrid_sim/fixtures/`
- `hybrid_vsim/tests/hybrid/*.sh`, `qemu_silent_stub.py` → `hybrid_sim/tests/`

To delete:
- `hybrid_vsim/hybrid/` (entire directory) after the parent imports land.

## Existing utilities to reuse (no rewrite)

- `hybrid_vsim/hybrid/qemu_plugin/Makefile` — already standalone; only deps are `QEMU_ROOT` + glib + `../include/hybrid/*.h`. The new `cmake/HybridPlugin.cmake` is a thin `ExternalProject_Add` wrapper around it.
- `hybrid_vsim/hybrid/test/Makefile` — already standalone; toolchain + .S/.ld only. The new `cmake/HybridFixtures.cmake` is a thin wrapper around it.
- `hybrid_vsim/tests/hybrid/roundtrip_e2e.sh` — `REPO_ROOT=$SCRIPT_DIR/../..` already self-locating; relocation only requires editing the `..` count and the `hybrid/...` path strings inside.
- `hybrid_vsim/cmake/HybridConfig.cmake` — the unit-test block (lines 10-89) stays mostly verbatim; only the include-path expression and the `if(HYBRID_DRIVER_DIR)` gate change.

## Risks and mitigations

- **Standalone vsim clone fails to configure when hybrid unit tests reference missing `${HYBRID_DRIVER_DIR}/include`.** *Mitigation:* gate every affected `vsim_add_test` and `target_include_directories` call with `if(HYBRID_DRIVER_DIR)`; document in `hybrid_vsim/CLAUDE.md` that hybrid unit tests require the parent workspace.
- **Atomicity gap between vsim commit-3 (deletes files) and parent commit-A (imports files).** *Mitigation:* sequence as A → 3 → B. Between A and 3, both copies coexist (working state, just slightly redundant). Parent commit-A's `build.sh test` references the new locations and ignores the still-present old copies. Vsim commit-3 deletes the old copies. Parent commit-B updates the submodule pointer.
- **`build.sh test` contract changes shape (now drives ctest from `hybrid_sim/build/` instead of `hybrid_vsim/build/`).** *Mitigation:* `build.sh` keeps the same subcommand surface (`./build.sh test`, `./build.sh clean`, etc.) — only its internals change. CLAUDE.md updated. Anyone who hardcoded `cd hybrid_vsim/build && ctest` in CI must update; document in commit message.
- **vsim `vsim_add_cpu_executable` macro consumers (e.g., `dmi_smoke.cpp`, `handoff_smoke.cpp`) break if line 455 of `CMakeLists.txt` is gated on `HYBRID_DRIVER_DIR` and a non-hybrid CPU executable build needs the include path.** *Mitigation:* read the macro before editing; only gate the path addition if it is hybrid-specific. If the include is unconditionally needed by every cpu executable (even non-hybrid ones), the gate must be on `VSIM_ENABLE_HYBRID` instead, and the include path supplied unconditionally with a fallback to a stub header. Verify by `grep -n vsim_add_cpu_executable hybrid_vsim/CMakeLists.txt` and reading the macro body.
- **CTest e2e jobs in HybridE2E.cmake hardcode bash commands that previously ran from `hybrid_vsim/build/`'s cwd. Their `../tests/hybrid/X.sh` relative paths break.** *Mitigation:* the new HybridE2E.cmake uses absolute `${CMAKE_SOURCE_DIR}/tests/X.sh`. Verify by `ctest -V -R test_e2e_rt_all_gprs` and grepping the bash invocation for the absolute path.

## Out of scope

- `hybrid_qemu/` — fully untouched. Audit confirmed zero hybrid-driver code.
- `hybrid_vsim/src/hybrid/*.hpp` (13 headers) — vsim-internal C++ glue, deeply integrated with Simulator/Platform/JTAG/SystemC. Stays.
- `hybrid_vsim/tests/hybrid/*.test.cpp` (13 unit tests) + `dmi_smoke.cpp` + `handoff_smoke.cpp` + helper `.hpp` files — link `${VSIM_LINK_LIBS}`, registered via `vsim_add_test`. Stays.
- The wire ABI itself (struct layout, magic, version) — bit-for-bit unchanged.
- `--shared-mem-path`, `EXIT_HANDOFF_TO_QEMU=200`, `csrwi 0x7C0` magic — semantics unchanged.
- Future top-level cmake-native QEMU build (e.g., `add_subdirectory(hybrid_qemu)` via ExternalProject for QEMU's autotools/meson system). Possible but out of scope; QEMU stays under `build.sh qemu`.
