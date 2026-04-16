# Plan: KWS-DNN baseline on AX45MPV FPGA

## Context

User wants baseline FPGA cycle counts for the ML-KWS-for-MCU DNN model (the largest model suite in `Examples/`). Goal is to set up a reproducible build+profile flow mirroring the existing cifar10/gru ports under `Examples/ARM/arm_nn_examples/`, producing a `baseline.md` with total and per-layer inst/cycle numbers for future libnn RVV optimization work.

The DNN model is a 4-layer FC keyword-spotting net from the "Hello Edge" paper. CMSIS-NN calls used (`arm_fully_connected_q7`, `arm_relu_q7`, `arm_softmax_q7`) have byte-identical argument lists and semantics to libnn's shift-based `riscv_nn_fc_s8_s8_s8_sft_bias_fast` / `riscv_nn_relu_s8` / `riscv_nn_softmax_s8_fast`, so porting is a rename, not a signature rewrite.

## Target layout

Create `Examples/ARM/arm_nn_examples/kws_dnn/` following the cifar10 pattern:

```
kws_dnn/
  Makefile                     # clone of cifar10/Makefile
  nds_nn_examples_kws_dnn.c    # new standalone driver (no mbed)
  dnn_weights.h                # copied from Deployment/Source/NN/DNN/
  baseline.md                  # results (written after run)
```

## Driver source (`nds_nn_examples_kws_dnn.c`)

Replicates `Deployment/Source/NN/DNN/dnn.cpp` inference in plain C:

- Constants from `dnn.h`: `IN_DIM=250`, `OUT_DIM=12`, `IP1_OUT=IP2_OUT=IP3_OUT=144`, shifts (`IP1_BIAS_LSHIFT=1,IP1_OUT_RSHIFT=7`; `IP2 2/8`; `IP3 2/9`; `IP4 0/6`).
- Input: static MFCC buffer (250 int8). Use pre-computed MFCC from `Deployment/Examples/simple_test/wav_data.h` or zero-fill (baseline cycle count is data-independent for dense FC).
- Call sequence:
  1. `riscv_nn_fc_s8_s8_s8_sft_bias_fast(in, IP1_WT, 250, 144, 1, 7, IP1_BIAS, fc1_out, vec_buf)`
  2. `riscv_nn_relu_s8(fc1_out, 144)`
  3. FC 144->144 (IP2), ReLU
  4. FC 144->144 (IP3), ReLU
  5. FC 144->12 (IP4)
  6. `riscv_nn_softmax_s8_fast(fc4_out, 1, 12, out)`
- `vec_buf` q15 scratch sized `2 * max(in_dim)` = 500 q15 elements.

Perf instrumentation: wrap each layer with `startPFM()/stopPFM()` macros guarded by `-DPF_COUNTER`, matching cifar10's pattern (see `Examples/ARM/arm_nn_examples/cifar10/nds_nn_examples_cifar10.c` once the Makefile patches it).

## Makefile

Copy `Examples/ARM/arm_nn_examples/cifar10/Makefile` verbatim, change:
- `SRC_ORIG := nds_nn_examples_kws_dnn.c`
- `ELF := build/kws_dnn.elf` (and perf/layers variants)
- Drop the `maxpool` sed patch (no maxpool in DNN); keep the shim-header generation (needs `nds_nn_fully_connected.h`, `nds_nn_activation.h`, `nds_nn_softmax.h`).

Targets: `make` (QEMU build), `make run` (QEMU validation), `make perf` (FPGA total), `make perf-layers` (FPGA per-layer).

## Critical files to reference

- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/cifar10/Makefile` - template
- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/cifar10/nds_nn_examples_cifar10.c` - perf-counter instrumentation style
- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/cifar10/baseline.md` - output format
- `/home/nick/work/libnn/Examples/ML-KWS-for-MCU/Deployment/Source/NN/DNN/dnn.cpp` - layer sequence/shifts
- `/home/nick/work/libnn/Examples/ML-KWS-for-MCU/Deployment/Source/NN/DNN/dnn_weights.h` - 319KB weight arrays (copy as-is)
- `/home/nick/work/libnn/Include/riscv_nn_fully_connected.h:241` - `riscv_nn_fc_s8_s8_s8_sft_bias_fast` signature (matches arm_fully_connected_q7)

## Verification

1. Build libnn: `/usr/bin/bash /home/nick/work/libnn/build.sh AX45MPV` (ast530 toolchain on PATH).
2. QEMU correctness: `cd Examples/ARM/arm_nn_examples/kws_dnn && make run` - expect completion without semihosting errors (the DNN output prediction can be spot-checked but is not required for cycle baseline).
3. FPGA total: `make perf` - reports total inst+cycle.
4. FPGA per-layer: `make perf-layers` - prints 8 rows (4 FC, 3 ReLU, 1 softmax).
5. Record numbers in `kws_dnn/baseline.md` matching cifar10/baseline.md format (Total table + per-layer table with libnn function names). Commit with `[misc]` tag.

Note: FPGA run requires board reservation via `MYPC=sw-boards.andestech.com MYPORT=1115` (defaults already in cifar10 Makefile). If the board is unavailable, QEMU run still validates correctness but does not yield cycle counts.
