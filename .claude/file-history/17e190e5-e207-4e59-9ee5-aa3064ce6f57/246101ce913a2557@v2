---
name: FPGA perf tests live in unit_performance, not unit_func
description: Perf measurement scripts must read Examples/unit_performance/t_pf_<name>.c; unit_func is correctness-only.
type: feedback
originSessionId: 17e190e5-e207-4e59-9ee5-aa3064ce6f57
---
For libnn FPGA cycle-count benchmarks, the test source is `Examples/unit_performance/t_pf_<function_name>.c` (note the `t_pf_` prefix). `Examples/unit_func/t_<name>.c` is the correctness test variant -- used by QEMU verify, not by FPGA perf.

**Why:** the two trees are separately maintained -- `unit_performance` wraps the call with `nds_pfcounter.h` and prints `The cycle count is N` / `The inst count is N`, which `run_fpga_test.sh` greps. `unit_func` is the accuracy-only test against pre-baked golden data. Confusing them silently degrades perf measurement (or the test fails to compile because `PF_COUNTER` paths aren't there).

**How to apply:** when wiring any FPGA perf flow (`run_fpga_test.sh`, `test_perf.sh`-style scripts, ad-hoc benchmark commands), point at `Examples/unit_performance/t_pf_<name>.c`. Keep QEMU correctness paths on `Examples/unit_func/t_<name>.c`. The optimize-skill `run_fpga_test.sh` was patched to this convention on 2026-05-04.
