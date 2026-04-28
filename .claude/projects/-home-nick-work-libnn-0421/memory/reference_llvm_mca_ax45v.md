---
name: llvm-mca timeline + bottleneck analysis for AX45MPV (nx45v)
description: How to invoke llvm-mca with the andes-45-series scheduling model on Andes vector ISA (vd4dots, vqmacc, vle8). Plus what the model gets wrong vs FPGA ground truth.
type: reference
originSessionId: c5543f22-1bda-47c4-a76e-d6e3930611f2
---
## Invocation

`/local/nick/llvm-project/build/bin/llvm-mca` is LLVM 20.1.8 with `andes-45-series` and `nx45v` scheduling models. The `-mcpu=nx45v` alone does NOT enable Andes vector dot product or vqmacc instructions; need explicit attrs.

```bash
/local/nick/llvm-project/build/bin/llvm-mca \
  --march=riscv64 -mcpu=nx45v \
  -mattr=+xandesvdot,+xandesvqmac,+v \
  --iterations=8 --timeline --bottleneck-analysis \
  --timeline-max-cycles=300 --timeline-max-iterations=2 \
  /tmp/kernel.s
```

Required attrs:
- `+v` -- base RVV
- `+xandesvdot` -- enables `nds.vd4dots.vv`, `nds.vd4dotu.vv`, `nds.vd4dotsu.vv`
- `+xandesvqmac` -- enables `nds.vqmacc.vv`, `nds.vqmacc.vx`
- `+xandesvbfhcvt`, `+xandesvpackfph` for bfloat / packed fp16 if needed

`--bottleneck-analysis` is silently ignored on in-order CPUs (warning printed) -- look at resource pressure table instead. Use `--all-views` to see hardware statistics.

## Model fidelity for AX45MPV V1024_8MB

**What llvm-mca gets right (qualitatively):**
- Scalar adds dual-issue (2-wide ALU port).
- vd4dots throughput 1 cyc/instr at m1 (matches spec).
- vle8 throughput 2 cyc/instr at DLEN=512 (model assumes DLEN=512, not the V1024_8MB DLEN=1024 -- on real HW vle8 is 1 cyc/instr).
- vsetvli marked HasSideEffects -- creates barriers as expected.

**What it gets wrong / underestimates:**
1. **VLSU+VMAC dual-issue underestimated.** The spec says these CAN dual-issue if VRF write ports don't conflict; the model often serializes them. Real HW typically gets 2x more overlap than mca shows.
2. **DLEN parameterization missing** -- the nx45v model is hardcoded to DLEN=512, so vle8 throughput cost is 2x what we actually see at DLEN=1024.
3. **vsetvli barrier cost overestimated** -- model treats it as a hard drain, real HW pipelines through if vtype delta is small (e.g., e8->e8 with same VL is nearly free).
4. **Cross-iter latency hiding** -- in-order model can't OOO-hide a load-to-use across phases the way real HW does via the VLSU buffer (16 entries, 2KB).

**Net effect:** If model says X cyc/iter, real FPGA is often 0.5x-0.7x. Use mca to find STRUCTURAL hazards (RAW chains, missed dispatch slots), not absolute cycle counts. FPGA `test_perf.sh` is the ground truth.

## What it's GOOD for

- **Spotting RAW chains across phases**: scalar pointer-bump chain -- if you put `add a0,a0,a4; vle8 (a0)` adjacent, mca shows the 3-cyc add latency stall directly in the timeline.
- **Comparing two scheduling orders** for the same instruction set -- the *direction* of the delta is usually right even if magnitude isn't.
- **Resource-pressure tables** -- which resource is the binding constraint per iter.
- **Instruction info** -- per-instr latency / throughput (often agrees with spec).

## What it's BAD for

- Peephole gain prediction (model can show +5% for a change that loses on FPGA, or vice versa).
- Anything depending on the in-flight VLSU buffer / MSHR depth -- mca doesn't model load queue capacity.
- HVM-related decisions (model has no HVM).

## Lessons learned (from round 7 attempt)

1. **Asm "scalar interleave" with vle8** (`add a0,a0,a4` between vle8s) -- mca correctly flagged this as -2.5x because of intra-iter pointer RAW. Don't do it.
2. **vsetvli pair merge** (4->2 vsetvli/iter by collapsing SW-pipeline phases) -- mca said -5% but the design BREAKS the SW-pipeline overlap. Real HW would lose much more than 5% saving from removed barriers. Don't trust mca's "win" if the structural change kills a pipelining property.
3. **Source asm extraction**: convert objdump mnemonics directly; format mostly matches llvm-mca asm syntax. `c.add` -> `add`, `c.li` -> `li`, etc. -- expand compressed mnemonics or llvm-mca won't parse.
4. **Iteration count**: use `--iterations=8` minimum to get steady-state cycles (first iter has cold-start overhead). Compare per-iter cyc, not total.
