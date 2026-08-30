---
name: sweep-sh-grid-harness
description: "sweep.sh runs the whole (build variant x MUL_MAT node) cycle grid in parallel, resumable, with an nrows gate and a --selfcheck against published numbers"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9a8ed4fe-13e9-424e-bb5f-5a5e4429a388
  modified: 2026-08-28T20:49:43.803Z
---

`sweep.sh` in the llama.cpp root is the grid driver that `measure.sh` is not:
measure.sh does one node across a few variants, serially, to the terminal.
sweep.sh does variant x node, many legs at once, one log per leg, resumable.
Used to produce [[q1-0-prefill-gemm-stage-breakdown]].

```sh
bash sweep.sh --selfcheck    # gate: re-derive two published K=51 numbers
bash sweep.sh                # prefill grid, K=50..56 x 4 variants
MODE=gemv bash sweep.sh      # matching decode grid
bash sweep.sh --md           # regenerate the markdown tables from the logs
```

Things that are load-bearing, learned the hard way:

- **MODE picks the ggml path via the prompt, nothing else.** gemm = `--no-warmup`
  + 4-token prompt (nrows=4); gemv = the warmup pass (nrows=2). Every leg
  re-reads nrows from its own `[roi]` line and records BAD-NROWS rather than a
  number if it disagrees -- the wrong prompt measures the OTHER kernel and
  still prints a plausible cycle count.
- **Concurrency is safe.** Each hybrid run stages into its own `make_temp_dir`
  (andesim `driver/manifest.cpp`), no sockets, and the figure comes from an RTL
  model, so host load cannot move it. 22 legs at once was fine; ~2 GB and ~4
  threads per vsim, so ~16 legs saturates 64 cores.
- **Emit legs variant-major, slowest variant first.** xargs fills slots from
  the front; `pristine` is ~6x every other variant, so emitting it first makes
  the wall clock the longest single leg instead of the sum.
- **Budget 24 h per leg.** 12 h was NOT enough for `pristine` ffn_up/ffn_down
  at 4 tokens (~83M and ~96M cycles) when the grid ran 16-wide. A timed-out leg
  costs its whole wall clock and yields nothing.
- Two bash traps this hit: `local v=$1 log="...$v..."` reads an unset `v`
  (bash expands every word before performing any assignment), and an
  unrecognized flag must NOT fall through to the sweep -- it once started hours
  of simulation from a typo. Unknown flags now exit 2.
