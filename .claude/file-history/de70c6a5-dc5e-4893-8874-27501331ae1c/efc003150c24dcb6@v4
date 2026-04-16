# libnn RVV Optimization Workflow

## Overview

This is the standard methodology for optimizing existing RVV implementations in libnn, targeting AX45MPV FPGA with VLEN=1024. The workflow has 7 steps arranged in a loop.

---

## Step 1: Select Target Function

**Focus: functions that already have RVV but can be improved.**

Sources for candidates:
- FPGA cycle count logs in `build_perf_ax45mpv/` — find the slowest functions
- Disassembly review (`libnn.objdump`) — spot suboptimal patterns (register spills, poor scheduling, missed tiling)
- Query optdb for prior lessons that suggest follow-up work:
  ```bash
  .venv/bin/python3 scripts/optdb.py search "bottleneck in <category>"
  ```
- Compare tiling/LMUL strategies across similar functions — if one was improved, siblings may benefit from the same pattern

## Step 2: Analyze Current Implementation

1. **Read the source** — understand the existing RVV code, its plain C fallback, and the algorithm
2. **Read the disassembly** — check `libnn.objdump` for the function. Look for:
   - Register spills (stores/loads to stack within hot loop)
   - Instruction count per loop iteration
   - LMUL and SEW choices
3. **Check optdb** for lessons on the same function or similar patterns:
   ```bash
   .venv/bin/python3 scripts/optdb.py search "<function_name>"
   .venv/bin/python3 scripts/optdb.py search "<pattern, e.g. vwmacc dot product>"
   ```
4. **Identify the hypothesis** — what specific change should improve performance and why

## Step 3: Implement the Optimization

- Modify the RVV path inside the existing `#ifdef ENA_VEC_ISA` guard
- Keep plain C fallback untouched
- Common optimization levers:
  - **Tiling factor** — process more rows/columns per iteration
  - **LMUL choice** — trade register count for throughput
  - **Loop restructuring** — reduce overhead, improve dual-issue
  - **Prefetch** — software prefetch for next iteration's data
  - **Instruction interleaving** — overlap independent ops for pipeline utilization

## Step 4: Verify Correctness (QEMU)

```bash
# Build libnn
/usr/bin/bash qemu-validate/build_libnn.sh

# Test the specific function at VLEN=1024
/usr/bin/bash qemu-validate/run_qemu_test.sh <test_name> --strace --vlen 1024

# Full regression (16 = parallel jobs)
/usr/bin/bash qemu-validate/run_all_tests.sh 16 1024
```

QEMU is **correctness only** — no meaningful cycle counts.

## Step 5: Measure Performance (FPGA)

Run on the AX45MPV FPGA board. The board is accessed via GDB expect script which uploads the binary:

```bash
cd build_perf_ax45mpv
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

The test harness uses `PF_COUNTER` + `rdcycle` to measure and print cycle counts per function call. Output goes to per-test log files in `build_perf_ax45mpv/<run_dir>/log/`.

**FPGA cycle counts are the ground truth.** Compare before/after.

## Step 6: Pipeline Analysis (vsim)

Use AndesCycle (vsim) to understand **why** performance changed. vsim models the CPU core pipeline (not memory hierarchy).

### Quick cycle breakdown by function:
```bash
/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium <program.adx> --log-level 0 2>&1 \
  | python3 /local/nick/vsim-workspace/vsim/tools/functrace.py <program.dump>
```

### Detailed pipeline analysis:
```bash
ln -sfn /local/nick/vsim-workspace/vsim/tools /tmp/vsim

PYTHONPATH=/tmp python3 /local/nick/vsim-workspace/vsim/tools/konata.py \
  --cpu ax45mpv_premium \
  --objdump-file <program.dump> \
  --output kanata.log \
  --experimental \
  <program.adx>
```

### What to look for in pipeline logs:
| Pattern | Indicates | Fix |
|---------|-----------|-----|
| Long VQ→VD gap | VPU instruction queue backpressure | Interleave scalar/vector work |
| Many VW stages per instruction | High LMUL eating VRF write bandwidth | Try smaller LMUL with more tiling |
| Single-issue cycles (only i0, no i1) | Poor dual-issue utilization | Reorder instructions to reduce dependencies |
| Long VC for VLSU ops | Cache miss on vector load/store | Align data, add prefetch |
| Burst of R...1 (flushes) | Branch misprediction | Restructure branches, use conditional moves |

### Note on VLEN:
vsim ships with VLEN=512 by default. For VLEN=1024, update `NDS_VLEN` in the CPU config and regenerate. Pipeline analysis patterns apply identically — LMUL=1 just processes more elements.

## Step 7: Record the Lesson (optdb)

**Always record, whether the result is better or worse.**

```bash
echo '{
  "function": "<function_name>",
  "summary": "<one-line what you tried>",
  "approach": "<detailed description of the change>",
  "cycles_before": "<FPGA cycle count before>",
  "cycles_after": "<FPGA cycle count after>",
  "speedup": "<Nx or regression>",
  "pipeline_insight": "<what vsim showed>",
  "lesson": "<key takeaway for future optimizations>",
  "outcome": "improved|regressed|neutral",
  "tags": ["<relevant>", "<tags>"],
  "date": "<YYYY-MM-DD>"
}' | .venv/bin/python3 scripts/optdb.py add --json
```

Good lessons answer: "If I encounter a similar function in the future, what should I try or avoid?"

---

## Tools Summary

| Tool | Purpose | Location |
|------|---------|----------|
| `qemu-validate/build_libnn.sh` | Build libnn for QEMU testing | repo |
| `qemu-validate/run_qemu_test.sh` | Single test on QEMU (--strace --vlen 1024) | repo |
| `qemu-validate/run_all_tests.sh` | Full test suite on QEMU (arg1=parallel_jobs, arg2=vlen) | repo |
| `test.sh` + `riscv64-sim-wrapper-on-board` | FPGA cycle count measurement via GDB | repo + `project/ax45mpv/` |
| `sim_ax45mpv_premium` | vsim quick simulation / cycle count | `/local/nick/vsim-workspace/vsim/build/` |
| `konata.py --experimental` | vsim pipeline log generation | `/local/nick/vsim-workspace/vsim/tools/` |
| `functrace.py` | vsim per-function cycle breakdown | `/local/nick/vsim-workspace/vsim/tools/` |
| `scripts/optdb.py` | Optimization knowledge base (search/add/list) | repo |
| `libnn.objdump` | Disassembly for checking codegen quality | build output |
