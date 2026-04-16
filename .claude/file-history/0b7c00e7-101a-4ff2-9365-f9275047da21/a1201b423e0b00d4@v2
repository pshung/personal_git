---
name: fpga-bench
description: "FPGA benchmarking for libnn on Andes AX45MPV. Use when collecting, comparing, or analyzing cycle counts from FPGA board runs. Triggers on benchmark, performance comparison, cycle count, FPGA test results, perf regression, or performance.csv analysis."
---

# FPGA Benchmarking for libnn

Record, compare, and analyze cycle-accurate performance data from FPGA board runs of libnn on AX45MPV.

## Data Location

All benchmark runs are stored under `build_perf_ax45mpv/` with timestamped directories:
```
build_perf_ax45mpv/test_sh_<YYYYMMDDHHMMSS>/
  performance.csv    # group, function, inst, cycle
  parameter.csv      # group, function, test parameters
  accuracy_fail_list # functions that failed accuracy check
  diff_log           # count of failures
  log/               # per-function logs
  adx/               # compiled test binaries
  lib_dir/           # library used for this run
  objdump/           # disassembly of test binaries
```

## Running a Benchmark

```bash
cd /home/nick/work/libnn/build_perf_ax45mpv
export PATH="/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin:/home/nick/work/libnn:$PATH"
export MYPC=sw-boards.andestech.com
export MYPORT=1116
rm -f /home/nick/work/libnn/project/ax45mpv/First_Reset_done
../test.sh "" riscv64-elf-gcc \
  /home/nick/work/libnn/project/ax45mpv/riscv64-sim-wrapper-on-board \
  BOARD BS3 \
  "-mtune=andes-45-series -mext-vector -DNDS_VEC_RVV_VERSION=1000 \
   -DENA_RUN_TWICE -DENA_CACHEABLE_ENV_SETUP -lnn_v -mzfh \
   -DENA_TEST_PERF -DENA_DUMP_PARAMETERS"
```

Key flags:
- `-DENA_TEST_PERF` — enables cycle counter readout
- `-DENA_DUMP_PARAMETERS` — dumps test parameters to parameter.csv
- `-DENA_RUN_TWICE` — runs function twice (warm cache on second run, which is measured)
- `BOARD` mode uses GDB/ICEman to run on real FPGA hardware

Always rebuild the library first with `build.sh AX45MPV` using the same toolchain.

## Comparing Runs

Use the bundled comparison script:

```bash
python3 scripts/compare_perf.py <baseline.csv> <new.csv> [options]
```

Common workflows:

```bash
# Full comparison table
python3 scripts/compare_perf.py old/performance.csv new/performance.csv

# Per-group summary (activation, convolution, etc.)
python3 scripts/compare_perf.py old/performance.csv new/performance.csv --summary

# Show only regressions > 5%
python3 scripts/compare_perf.py old/performance.csv new/performance.csv --regression --threshold 5

# Top 10 biggest cycle improvements in convolution
python3 scripts/compare_perf.py old/performance.csv new/performance.csv --improvement --group convolution --top 10

# CSV output for further analysis
python3 scripts/compare_perf.py old/performance.csv new/performance.csv --csv > comparison.csv
```

## Performance CSV Format

```
group, function, inst, cycle
activation,relu_s8,316,3085,
convolution,conv_1x1_HWC_s8_s8_s8_sym_bias_fast_any,475701,628155,
```

- `group` — function category (activation, basic, concatenation, convolution, fully_connected, pooling, softmax, nn_support, util)
- `function` — function name (without `riscv_nn_` prefix)
- `inst` — instruction count (from hardware counter)
- `cycle` — cycle count (from hardware counter, warm cache)
- `x` — function not supported or failed to run

## Interpreting Results

- Cycle counts are from the **second run** (warm cache) when `-DENA_RUN_TWICE` is used
- Functions in `accuracy_fail_list` ran but produced wrong output — their cycle data may still be valid if they appear in performance.csv
- Functions with `x,x` in performance.csv failed to execute (e.g., s4 quantization not yet supported)
- Compare cycles, not instructions — instruction count changes with code but cycles reflect actual hardware performance
- IPC (inst/cycle) < 1.0 is typical for memory-bound functions; IPC > 1.0 indicates good instruction-level parallelism
