# Plan: Optimize GRU Example on AX45MPV VLEN=1024

## Context

The GRU example at `Examples/ARM/arm_nn_examples/gru/` currently has no build automation and no baseline performance data on AX45MPV. We need to enable FPGA perf measurement (mirroring the cifar10 workflow) and then apply the `/optimize` FSM skill to the hot functions identified by per-layer profiling.

Per Explore agent, the GRU cell calls:
- `riscv_nn_fc_mat_vec_s16_s16_s8_sft_bias_fast` x3 per iteration (input+history matmul, K=64 -> N=32)
- `riscv_nn_activate_s16` x3 per iteration (sigmoid/sigmoid/tanh on N=32)
- `nds_mul_q15`, `nds_offset_q15`, `nds_sub_q15` (lightweight elementwise, N=32)

Two iterations are measured in `main()`. The structure is nearly identical to cifar10's harness (uses `PF_COUNTER`, `FUNCTION_PF_ANALYZE`, `startPFM`/`stopPFM`, `enable_fs_and_vs`, `test_util.h`, and old `nds_nn_*.h` headers that need shim).

## Approach

### Step 1: Build automation (new Makefile)

Create `Examples/ARM/arm_nn_examples/gru/Makefile` modeled on `Examples/ARM/arm_nn_examples/cifar10/Makefile`. Key differences:
- `SRC_ORIG := nds_nn_examples_gru.c`
- Shim headers needed: `nds_nn_activation.h`, `nds_nn_fully_connected.h` (only these two, based on gru.c includes)
- No source patching needed (cifar10 needed a sed for maxpool batch arg; GRU does not)
- Same toolchain, QEMU config, FPGA wrapper path, MYPORT=1115
- Targets: `all`, `run` (QEMU strace), `perf` (FPGA total), `perf-layers` (FPGA per-function), `clean`

### Step 2: Collect baseline

- Rebuild libnn: `build.sh AX45MPV`
- Run `make perf` and `make perf-layers` on FPGA via `sw-boards.andestech.com:1115`
- Record total inst/cycle and per-function breakdown for both iterations
- Save to `Examples/ARM/arm_nn_examples/gru/baseline.md` (same format as cifar10/baseline.md)

### Step 3: Apply /optimize FSM to hottest function

Based on shape analysis (K=64, N=32 for fc_mat_vec; N=32 for activate):
- Expected hottest: `riscv_nn_fc_mat_vec_s16_s16_s8_sft_bias_fast` (3 calls per iter, ~2048 MACs each)
- Next: `riscv_nn_activate_s16` (3 calls per iter, 32 elements, table lookup + interp)

Invoke `/optimize` skill with target=hottest function, algorithm-level first. Consult wiki:
- For s16 input / s8 weight FC, check whether vd4dots u8/s16 path applies; K=64 is small but non-trivial
- Check `[[vectorize-k-vs-n]]` and `[[anti-vd4dots-small-k]]` tradeoffs (K=64 is borderline)
- For activate_s16 (table LUT), check for any existing RVV-version-gated path that can be upgraded to v1.0

After each /optimize trial: validate correctness (QEMU strace), measure FPGA cycles, commit if improved, then iterate on next-hottest function.

### Step 4: Update wiki

On success, update `docs/wiki/index.md` operator table and create/update operator pages under `docs/wiki/operators/` per the /optimize `learn` step.

## Critical Files

- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/gru/nds_nn_examples_gru.c` (source, do not modify)
- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/gru/Makefile` (NEW - create from cifar10 template)
- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/gru/baseline.md` (NEW)
- `/home/nick/work/libnn/Examples/ARM/arm_nn_examples/cifar10/Makefile` (reference template)
- `/home/nick/work/libnn/Source/FullyConnectedFunctions/riscv_nn_fc_mat_vec_s16_s16_s8_sft_bias_fast.c` (optimization target)
- `/home/nick/work/libnn/Source/ActivationFunctions/riscv_nn_activate_s16.c` (secondary target)
- `/home/nick/work/libnn/docs/wiki/index.md` (wiki update on success)

## Verification

- `make` builds cleanly
- `make run` produces "Complete first iteration on GRU" / "Complete second iteration on GRU" via QEMU strace
- `make perf` returns total inst+cycle on FPGA
- `make perf-layers` prints per-function breakdown; compare against baseline.md after each trial
- QEMU unit test for the modified function passes: `qemu-validate/run_qemu_test.sh fc_mat_vec_s16_s16_s8_sft_bias_fast --strace --vlen 1024`
- Cycle reduction vs baseline recorded per trial; commit each improvement
