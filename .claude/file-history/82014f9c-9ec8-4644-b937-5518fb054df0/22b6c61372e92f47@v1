---
name: ax45mpv-pipeline
description: "AX45MPV pipeline analysis using AndesCycle (vsim) cycle-accurate simulator. Use when analyzing pipeline stalls, VPU throughput, instruction latencies, kanata logs, or optimizing RVV code for AX45MPV. Triggers on pipeline analysis, cycle-accurate simulation, kanata log, stall analysis, VPU pipeline, dual-issue utilization, or AndesCycle/vsim."
---

# AX45MPV Pipeline Analysis

Analyze cycle-accurate pipeline behavior of RVV code on the Andes AX45MPV using the AndesCycle (vsim) simulator.

## Simulator Location

```
/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium       # C++ binary
/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium.*.so  # Python module
/local/nick/vsim-workspace/vsim/tools/konata.py                  # Pipeline log generator
/local/nick/vsim-workspace/vsim/tools/functrace.py               # Function-level profiling
```

## Workflow

### 1. Compile a test program

```bash
TOOLCHAIN=/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin/riscv64-elf-
${TOOLCHAIN}gcc program.c -o program \
  -march=rv64gc_zve32x -O2 -static \
  -Wl,--defsym,_stack=0x3000000 \
  -nostartfiles /local/nick/vsim-workspace/vsim-demo/crt0.S \
  /local/nick/vsim-workspace/vsim-demo/libgloss.c \
  /local/nick/vsim-workspace/vsim-demo/handler.c \
  /local/nick/vsim-workspace/vsim-demo/trap.S
${TOOLCHAIN}objdump -d program > program.dump
```

### 2. Quick cycle count

```bash
/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium program
```

### 3. Generate pipeline log

```bash
ln -sfn /local/nick/vsim-workspace/vsim/tools /tmp/vsim
PYTHONPATH=/tmp python3 /local/nick/vsim-workspace/vsim/tools/konata.py \
  --cpu ax45mpv_premium \
  --objdump-file program.dump \
  --output kanata.log \
  --experimental \
  program
```

`--experimental` is required for VPU pipeline tracking.

### 4. Analyze the pipeline log

Use the bundled analysis script:

```bash
# Default: summary + stall analysis (all instructions)
python3 scripts/analyze_kanata.py kanata.log

# Focus on a specific PC range (hot loop)
python3 scripts/analyze_kanata.py kanata.log --pc-range 10210-10230

# RVV instructions only, with per-mnemonic summary
python3 scripts/analyze_kanata.py kanata.log --rvv-only --summary

# Detailed cycle-by-cycle timeline
python3 scripts/analyze_kanata.py kanata.log --pc-range 10210-10230 --timeline

# Top 20 longest-latency instructions
python3 scripts/analyze_kanata.py kanata.log --top 20 --show-stalls
```

### 5. Visual analysis (optional)

Open `kanata.log` in [Konata](https://github.com/shioyadan/Konata) for graphical pipeline visualization.

## Architecture Reference

See [references/pipeline_arch.md](references/pipeline_arch.md) for detailed AX45MPV pipeline stages, VPU functional units, typical latencies, stall causes, and kanata log format.

Key points:
- **Scalar**: 5-stage dual-issue (IS->EX->MM->LX->WB)
- **VPU**: VQ->VD->VC->VW1..VWn (parallel to scalar)
- VW count = LMUL (m1=1, m4=4, m8=8). Stores have 0 VW stages.
- FUs: VALU (fast arith), VMAC (multiply), VLSU (load/store), VPERMUT, VDIV (slow), VFDIV (slow)

## What to Look For

1. **VQ stalls** (VQ->VD gap) — VPU queue backpressure, FU conflict
2. **Long VC** (VD->VC gap) — cache miss (VLSU) or slow FU (VDIV/VFDIV)
3. **VW bottleneck** (VC->VW gap) — VRF write port contention at high LMUL
4. **Scalar IS stall** — VPU scoreboard full (VSCB=16 entries)
5. **Branch flushes** — misprediction penalty (R status=1)
6. **Dual-issue gaps** — only 1 instruction issued when 2 could be
