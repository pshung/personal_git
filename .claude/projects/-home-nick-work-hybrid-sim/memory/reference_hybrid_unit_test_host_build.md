---
name: reference-hybrid-unit-test-host-build
description: Fast host g++ build+run command for hybrid doctest unit tests (no container)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 170e2aea-625a-4764-89fa-e0722f44012b
---

The `verilator/tests/hybrid/*.test.cpp` doctest unit tests are header-only
(C++20 + ABI header) and run directly on the host - no podman/Verilator needed.
Build+run one with:

```sh
cd /home/nick/work/hybrid_sim
g++ -std=c++20 -I verilator/src -I verilator/tests/hybrid -I include \
    -I verilator/external/doctest/doctest \
    verilator/tests/hybrid/resume_driver.test.cpp -o /tmp/t && /tmp/t
```

`-I verilator/tests/hybrid` is only needed for tests that include the shared
`recording_bus.hpp` (e.g. state_drain). This is the fast RED/GREEN loop; the
canonical container/ctest path is only required for the e2e suite.

Exceptions that do NOT link on the host: `qemu_handback.test.cpp` (needs libfmt:
`undefined reference to fmt::v11::...`), and the SystemC-dependent ones
(`*_smoke.cpp`, `shared_mem_offset.test.cpp`). Skip those on host.

vsim rebuild after editing `src/hybrid/*.hpp` or `src/simulator.hpp`:
`bash scripts/build_vsim.sh` (podman; incremental, recompiles `main.cpp.o` only,
RTL is cached - ~30s). Then e2e: `JOBS=8 FILTER=rt_c_v bash scripts/run_e2e.sh`.
