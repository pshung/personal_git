---
name: andesim-fastsim-build-recipe
description: Where the AndeSim-on-FastSim build recipe and environment live (PORTING.md, container, scratchpad builds that do not persist)
metadata:
  type: reference
---

The recipe (shared C++20 SystemC 3.0.1 + CCI, FastSim against them, vsim
modules told which SystemC, LD_PRELOAD of the engine) is in
`/home/nick/work/fastsim_v3/andesim/PORTING.md` (branch `andesim`).

Environment used on 2026-09-11:
- vsim modules build in podman `localhost/andescycle-dev:v0.16-17-g03dfe23`
  (host GCC 16 cannot compile vendored scc/LIEF): mounts `-v <vsim>:/work`
  `-v <fastsim_v3>:/fastsim` `-v <scratch>:/sp`; configure with
  `-DFASTSIM_DIR=/fastsim -DFASTSIM_LUA_INCLUDE=/sp/luainc
  -DFASTSIM_SYSTEMC_LIB=/sp/sc-shared/lib/libsystemc.so
  -DFASTSIM_CCI_LIB=/sp/cci-shared/lib/libcci.so`.
- The shared SystemC/CCI, the FastSim build (`fsbuild/multi_arch_toplevel`,
  modules in `fsbuild/install/lib`) and Lua headers lived in that session's
  scratchpad under /tmp -- NOT persistent. A new session must rebuild them
  per PORTING.md before running the demos.
- Host unit tests: `cmake --build <vsim>/build-utest --target check` (GCC 16).
- Test/demo env vars: FASTSIM_BIN, FASTSIM_MODULE_DIR, VSIM_CORE_SO (no .so),
  LD_LIBRARY_PATH (shared SystemC/CCI); fixtures in
  `/home/nick/work/andesim/tests/fixtures` (old repo, read-only).

Related: [[andesim-vsimcore-only-no-standalone]].
