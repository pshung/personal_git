# Verify QEMU hotloops + vsim Kanata loop-window on libnn

## Context

We have two new external tools we want to fold into `/optimize` so the loop can target the *actual* hot inner loop instead of measuring whole-function cycles:

1. **QEMU hotloops plugin** - `/local/nick/qemu_v5/scripts/hotloops.sh` + `libhotloops.so`. Reports `iters | start_pc -> end_pc | fn+off` for backward TB transitions.
2. **vsim Kanata loop-window** - `/local/nick/vsim/build/sim_ax45mpv_premium` with `--kanata --kanata-loop-start --kanata-loop-end --kanata-loop-skip --kanata-loop-record`. Restricts a Konata pipeline dump to N iterations of a chosen loop body.

Goal of *this* task: end-to-end smoke test on real libnn ELFs to surface integration issues *before* wiring into `/optimize`. User explicit constraint: build ELFs **without `-g`** so the hot-loop table stays human-pickable.

## Verification target

Pick row 4 of `ROADMAP.md`: `conv_HWC_s8_s8_s8_sym_bias_fast` (524,851 cyc on FPGA, recently r-uarch2 hoisted - we know its hot loop well, so we can sanity-check the plugin output against the assembly we already understand). Also do a tiny sanity ELF (row 125: `relu_s8`, 3,099 cyc) as a control - it has a single trivial vector loop, so the hotloops table should have exactly one obvious winner.

## Files / paths I will use (read-only, no edits required for verification)

- Build: `/home/nick/work/libnn_0421/test_perf.sh "" "" "" <fn>` -> `t_<fn>.adx`
- QEMU + plugin: `/local/nick/qemu_v5/build/qemu-system-riscv64`, `/local/nick/qemu_v5/build/contrib/plugins/libhotloops.so`
- Hotloops wrapper: `/local/nick/qemu_v5/scripts/hotloops.sh`
- vsim: `/local/nick/vsim/build/sim_ax45mpv_premium`
- vsim doc: `/local/nick/vsim/docs/KANATA_LOOP_WINDOW.md`
- QEMU machine cfg already used by `/optimize`: `project/ax45mpv/qemu_cfg/zve64d/ADP-AE350-AX45MPV-1C_dw0_mw1.cfg`
- Existing perf ELF launcher reference: `.claude/skills/hot-inner-kernel-extractor/` (already runs vsim baremetal in this repo)

## Step-by-step verification

### Step 1 - build a no-`-g` perf ELF

```
cd /home/nick/work/libnn_0421
export PATH="/local/nick/SW_Release_cp/ast530/nds64le-elf-newlib-v5d/bin:$PATH"
./build.sh AX45MPV
mkdir -p build_perf_verify && cd build_perf_verify
../test_perf.sh ax45mpv riscv64-elf-gcc BOARD conv_HWC_s8_s8_s8_sym_bias_fast
```

Expect `t_conv_HWC_s8_s8_s8_sym_bias_fast.adx`. Confirm with `riscv64-elf-readelf -S` that there is no `.debug_*` section. If there is, identify where `-g` is leaking in (CFLAGS, board makefile, or test stub) and strip it - per CLAUDE.md instruction.

### Step 2 - QEMU hotloops on the perf ELF

The perf test reads `mcycle` directly and writes the result via Andes semihosting to fd 9 (per repo CLAUDE.md). hotloops.sh defaults to `qemu-riscv64` user-mode emulation, **which is wrong for these ELFs** - they are baremetal AE350 images linked at `0x0`. Two options to test:

  a. **System mode**: invoke `qemu-system-riscv64` directly with the same machine/CPU args `/optimize` already uses (`-machine andes_ae350 -cpu andes-ax45mpv,vext_spec=v1.0,vlen=1024 -nographic -semihosting -kernel <elf>`) plus `-plugin /local/nick/qemu_v5/build/contrib/plugins/libhotloops.so` and `-d plugin`. This is the path I expect to work.
  b. Whatever `hotloops.sh` does by default, captured for comparison.

If (a) works, that's the integration point. If neither works without source changes to the plugin, that's *issue #1 to file*.

Capture: top 10 loops, look for the inner GEMM kernel (should be in `nn_mat_mul_kernel_*` or `conv_HWC_s8_s8_s8_sym_bias_fast` inner block). Cross-check `end_pc` against `t_*.adx.objdump` to confirm the address lands on the expected back-branch (the one with `bnez` / `nds.bnec` closing the K loop).

### Step 3 - vsim Kanata window using the picked PCs

Pick the top loop's `start_pc` / `end_pc` from Step 2. Choose `--kanata-loop-skip 4 --kanata-loop-record 4` (skip warmup, capture 4 steady iters). Run:

```
sim_ax45mpv_premium <elf> \
   --kanata loop.kanata \
   --kanata-loop-start 0x... --kanata-loop-end 0x... \
   --kanata-loop-skip 4 --kanata-loop-record 4
```

Expected: simulator exits with `Kanata loop window [pc 0x...]: 4 iters, ... insns, ... cycles, IPC=...`, and `loop.kanata` opens cleanly in Konata.

### Step 4 - the real thing we are looking for

Treat this as a *bug-finding* run, not a happy-path demo. Specifically watch for:

- **PC stability** - does the same source build give identical hot-loop PCs across runs? (Required for `/optimize` to script.)
- **Plugin compatibility with Andes vector ops** - does the plugin choke on `vd4dots` / `nds.bbc` / `nds.beqc` (known issue in some plugins per memory `feedback_extractor_skill_revisions.md`)?
- **Iteration-count sanity** - `iters` should equal (loop trip count) - 1 per call, summed over the perf-test outer loop. For `conv_HWC_s8_s8_s8_sym_bias_fast` we know this from the existing optimize work; mismatch flags a plugin-counting bug.
- **vsim end-PC retire vs fetch** - if `end_pc` is the last instruction of the kernel and is *predicated* or sits on a fall-through path on the last iter, the gate may close one short. Verify `iters` reported by vsim matches `--kanata-loop-record`.
- **Skip-vs-warmup interaction** - run with `--kanata-loop-skip 0` and `--kanata-loop-skip 100`; both must emit a self-consistent Konata trace (no orphan `I` without `R`).
- **Signal-to-noise** - if the perf-test main outer loop dominates `iters` over the inner GEMM, raise `--min-iters` until the inner kernel is rank #1. That tells us the right default threshold for `/optimize` integration.
- **Repeat on `relu_s8`** as a control: a single trivial loop should be unambiguously top-1, IPC under Kanata should match what the existing extractor harness reports.

## Deliverable from verification

A short note (in chat, not a file) listing per tool:
1. What worked.
2. What broke / is fragile.
3. Concrete change requests for `hotloops.sh` and/or vsim Kanata flags before they get baked into `/optimize`.

## Out of scope

- Editing `/optimize` skill - that's the *next* task once verification is clean.
- Any code changes to `hotloops.c` or vsim itself - file as issues only.
- ROADMAP cycle-count regressions; we are not optimizing here, only validating tooling.

## Verify-the-verifier checklist

- ELF has no `.debug_*` sections.
- hotloops top entry's `end_pc` lands on a real back-branch in `t_*.adx.objdump`.
- vsim summary line prints non-zero IPC and exits 0.
- Konata file size is small (KB-MB range), not multi-GB.
