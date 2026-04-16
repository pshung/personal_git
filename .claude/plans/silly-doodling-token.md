# Plan: Configurable `sinf` code-gen pipeline (GoFast-replacement)

## Context

Goal: instead of hand-writing one new latency-optimized `sinf`, build a **configurable generator** that takes a YAML/TOML config describing the target microarchitecture, desired polynomial shape, reduction strategy, and accuracy target, and emits:

1. Sollya-computed minimax coefficient tables (`.s`)
2. A templated assembly kernel (`sf_sin.s` replacement)
3. A templated argument-reduction routine (`andes_fpreduct.s` replacement, if changed)
4. An experiment report (max ULP, `.text` size, cycle count on QEMU and/or FPGA)

The same pipeline must be reusable for `cosf`, `tanf`, and later double-precision siblings. It plays the same role as whatever internal flow GoFast used to produce the original tables, but is transparent, versioned, and reproducible.

### Why configurable
The latency-optimal degree, Horner-vs-Estrin split, and reduction strategy all depend on: multiplier latency, multiplier pipelining, load-use latency, branch penalty, ISA extensions, and the tolerated ULP / code-size budget. Hard-coding one choice forecloses experiments. A config-driven generator lets us sweep the design space and pick the Pareto winner.

### Baseline GoFast algorithm recovered (for reference)
Full recovery is in the commit history of this plan file; key points:
- `sinf` is soft-float; argument is raw bits in `x10`.
- Reduction (`andes_fpreduct.s`) is **bit-serial 64-bit long division by `pi/2 = 0x10B4611A_6487ED51`** with a loop count of `exponent - 125` iterations. Fast-out for `|x| < 0.5` (returns `x` unchanged - significant accuracy gap). Returns qNaN for `|x| >= 2^32`.
- Sin kernel: 4-coefficient degree-7 odd Horner in Q1.31, loop-terminated by a sentinel word with MSB set. Polynomial `~ x*(1 - x^2/6 + x^4/120 - x^6/5040)`.
- Cos kernel: 5-coefficient degree-8 even Horner. Polynomial `~ 1 - x^2/2 + x^4/24 - x^6/720 + x^8/40320`.
- Quadrant `k` selects kernel via `((k-1)&2) == 0 ? cos : sin`; sign = `sign(x) XOR bit1(k)`.
- Final pack truncates, does not round.
- Uses `mulhu` exclusively (upper 32 of 32x32 unsigned multiply); no `__gf_ex*` helpers.

### IEEE-754 gaps to close
1. `|x| < 0.5` identity shortcut - large error near 0.5.
2. NaN for `|x| >= 2^32` - should be finite in `[-1, 1]`.
3. No Payne-Hanek - ULP loss near multiples of `pi/2`.
4. Truncating final pack - ~1 ULP bias.

---

## Pipeline architecture

```
 config.yaml
    |
    v
 gen_sinf.py  ----> sollya script  ----> sollya  ----> coeffs.json
    |                                                     |
    |                                                     v
    |                                             render templates
    |                                                     |
    v                                                     v
 gen/<name>/                          gen/<name>/andes_fp{sin,cos}cof.s
   config.yaml                         gen/<name>/sf_sin.s
   coeffs.json                         gen/<name>/andes_fpreduct.s   (optional)
   report.json
    |
    v
 run_experiment.py
    |
    +--> make test-sinf  GEN=<name>      (accuracy vs newlib)
    +--> make bench-sinf GEN=<name>      (cycle count on QEMU or FPGA)
    +--> parse results, merge into report.json
```

All generated files live under a versioned directory `gen/<name>/`. The existing `Makefile` is extended with a `GEN=<name>` override that swaps the three assembly files it uses for that target.

---

## Config schema (`config.yaml`)

```yaml
function: sinf                  # sinf | cosf | tanf  (extensible)
name: sinf_d9_estrin2_rv32im    # unique tag for gen/<name>/
description: "degree-9 sin, Estrin-2, bit-serial reduction, RV32IM"

target:
  isa: rv32im                   # rv32im | rv32imc | rv32imc_zba_zbb | rv32imc_zicond | ...
  abi: ilp32
  core: andes-n25               # used only for QEMU -cpu and FPGA link
  xlen: 32

# Instruction latencies (cycles, result-to-use). Used by the code-gen heuristic
# that chooses Horner vs Estrin and decides on scheduling slack.
latency:
  mul:       1
  mulh:      4
  mulhu:     4
  mulhsu:    4
  load_use:  2
  alu:       1
  branch_taken_penalty: 2
  mispredict_penalty:   3
  mul_pipelined: true           # can a second mulhu issue while a first is in flight?

accuracy:
  target_ulp: 1.0               # 0.5 = correctly-rounded, 1.0 = faithful, >1 = relaxed
  eval_domain: [-0.7853981633974483, 0.7853981633974483]   # [-pi/4, pi/4]
  rounding: round_nearest_even  # round_nearest_even | truncate

size_budget:
  extra_text_bytes: 512         # max additional .text vs current sinf
  extra_rodata_bytes: 256       # for larger coefficient tables / reduction consts

reduction:
  strategy: bit_serial          # bit_serial | cody_waite_2 | cody_waite_3 | payne_hanek
  small_arg_threshold_exp: -12  # for |x| < 2^N, use sinf(x) = x identity (N must give sub-ULP error)
  huge_arg_policy: reduce       # reduce | return_nan   (reduce requires payne_hanek path)
  pi_over_2_words: 2            # how many words of pi/2 to carry; 2=64-bit, 3=96-bit, 4=128-bit

kernel:
  sin_degree: 9                 # odd degree: 7, 9, 11
  cos_degree: 10                # even degree: 8, 10, 12
  evaluation: estrin2           # horner | estrin2 | estrin4
  unroll: true                  # fully unroll Horner/Estrin (no loop, no sentinel)
  fixed_point_format: Q1.31     # Q1.31 | Q2.30
  use_mulhsu_for_signed_coefs: false

verify:
  sweep:
    - { range: [-6.283185, 6.283185], points: 100000 }     # one full period sweep
    - { range: [-1.5710, -1.5706],    points: 5000  }      # cancellation near -pi/2
    - { range: [ 1.5706,  1.5710],    points: 5000  }      # cancellation near +pi/2
    - { range: [ 100.0,   10000.0],   points: 10000 }      # medium-large args
    - { range: [ 1e6,     1e9 ],      points: 5000  }      # huge args (only if payne_hanek)
  special_inputs: [+0.0, -0.0, +inf, -inf, nan, 1.0e-38, 1.0e-45]
  max_allowed_ulp: 1.0

bench:
  enabled: true
  target: qemu                  # qemu | fpga | both
  representative_input: 1.0     # passed to perf() via test_sinf.c EN_PERF path
  iterations: 100               # matches existing EN_PERF loop count
```

---

## Generator script: `tools/libm_gen/gen_sinf.py`

Responsibilities (pure Python 3, no third-party deps except PyYAML; Sollya invoked as subprocess):

1. **Load + validate config.** Fail loudly on unknown keys or invalid combinations (e.g. `huge_arg_policy: reduce` with `strategy: bit_serial`).

2. **Compute polynomial coefficients** via Sollya.
   - Emit a `.sollya` script per kernel:
     ```
     prec = 200!;
     display = hexadecimal;
     f_sin  = sin(x)/x;          // so we fit an even polynomial in x for the x-factored form
     d      = [-pi/4, pi/4];
     p_sin  = fpminimax(f_sin, [|0,2,4,6,8|], [|31,31,31,31,31|], d, fixed, absolute);
     supnorm(p_sin, f_sin, d, absolute, 2^(-35));
     print("coeffs:", coeff(p_sin, 0), coeff(p_sin, 2), ...);
     ```
   - Run `sollya --warnonstderr script.sollya`, parse stdout, extract integer mantissas.
   - Convert to the exact Q-format word values the kernel expects (including the sentinel bit the Horner loop uses, if `unroll: false`).
   - Record `supnorm` result in `coeffs.json` as `polynomial_ulp_bound`.

3. **Render templates** (`tools/libm_gen/templates/`):
   - `sf_sin.s.tmpl` - parameterized by degree, evaluation scheme, unroll, rounding.
     - `horner` template: generates the existing 4-5-word Horner loop (optionally unrolled).
     - `estrin2` template: computes `r2`, `r4`, then `(c0 + c1*r2) + r4*(c2 + c3*r2)` in two parallel chains.
     - `estrin4` template: computes `r2, r4, r8`, splits polynomial into 4 subchains.
   - `andes_fpsincof.s.tmpl`, `andes_fpcoscof.s.tmpl` - just `.long` tables, written from `coeffs.json`.
   - `andes_fpreduct.s.tmpl` - parameterized by `strategy`, `pi_over_2_words`, `huge_arg_policy`.
     - `bit_serial` branch keeps the current division loop (baseline).
     - `cody_waite_N` emits `r = ((x - k*C_hi) - k*C_mid) - k*C_lo` with `k = round(x * 2/pi)`. Coefficients `C_hi/mid/lo` are exact Sollya splits of `pi/2`.
     - `payne_hanek` emits a call to a precomputed `2/pi` table (~4-6 words) and a fixed schedule of multiplies. Required if `huge_arg_policy: reduce`.

4. **Write output** to `gen/<name>/` and update a `gen/index.json` registry.

### Template selection rules (code-gen heuristic)
Given `latency.mulhu`, `latency.mul_pipelined`, `kernel.sin_degree`:
- If `evaluation: auto`, the generator picks Estrin when `mulhu_lat * degree / 2 > mulhu_lat * (degree/2) + one_extra_mulhu`, i.e. whenever the multiplier can overlap.
- If `unroll: auto`, unroll when the entire polynomial fits in `size_budget.extra_text_bytes`.

Users can always override `auto` with an explicit value. The heuristic exists so we can sweep configs without rewriting them.

---

## Experiment runner: `tools/libm_gen/run_experiment.py`

1. Takes a config path (or a directory of configs for a sweep).
2. For each config:
   a. Calls `gen_sinf.py config.yaml` to produce `gen/<name>/`.
   b. Invokes the existing Makefile with an override:
      ```sh
      make -C libm/machine/riscv GEN=<name> test-sinf
      make -C libm/machine/riscv GEN=<name> bench-sinf    # if bench.enabled
      ```
   c. Parses the test diff output for max ULP error (compute from opt vs ref `%08lx` lines).
   d. Parses cycle-count output from the bench run.
   e. Runs `riscv32-elf-size gen/<name>/sf_sin.o gen/<name>/andes_fp{sin,cos}cof.o gen/<name>/andes_fpreduct.o` to get `.text` and `.rodata` sizes.
   f. Appends all results to `gen/<name>/report.json`:
      ```json
      {
        "config": "...",
        "polynomial_ulp_bound": 0.82,
        "measured_max_ulp": 0.94,
        "text_bytes": 312,
        "rodata_bytes": 60,
        "cycles_qemu_sinf_1p0": 187,
        "cycles_fpga_sinf_1p0": 162
      }
      ```
3. Sweep mode: takes a directory of configs, produces a single `gen/sweep.csv` for comparison.

### Makefile integration (minimal diff)

Add to the existing `Makefile`:

```make
GEN ?=
ifneq ($(GEN),)
  GEN_DIR = gen/$(GEN)
  # Replace the three sinf-related sources when GEN is set
  ASM_SRCS := $(filter-out sf_sin.s andes_fpreduct.s andes_fpsincof.s andes_fpcoscof.s, $(ASM_SRCS) $(ANDES_SRCS))
  ASM_SRCS += $(GEN_DIR)/sf_sin.s $(GEN_DIR)/andes_fpreduct.s $(GEN_DIR)/andes_fpsincof.s $(GEN_DIR)/andes_fpcoscof.s
endif
```

(Exact variable names will be adjusted to match the real sinf build-chain in the existing Makefile; the structure stays the same.)

---

## Files to be created

| Path | Role |
|---|---|
| `tools/libm_gen/gen_sinf.py` | main generator (config -> sollya -> render -> gen/) |
| `tools/libm_gen/run_experiment.py` | driver (gen -> make -> parse -> report.json) |
| `tools/libm_gen/templates/sf_sin.s.tmpl` | kernel template (horner / estrin2 / estrin4) |
| `tools/libm_gen/templates/andes_fpsincof.s.tmpl` | sin coefficient table template |
| `tools/libm_gen/templates/andes_fpcoscof.s.tmpl` | cos coefficient table template |
| `tools/libm_gen/templates/andes_fpreduct.s.tmpl` | reduction template (4 strategies) |
| `tools/libm_gen/templates/sollya_minimax.sollya.tmpl` | sollya script template |
| `tools/libm_gen/configs/baseline.yaml` | reproduces the current GoFast sinf exactly (sanity check) |
| `tools/libm_gen/configs/d9_estrin2.yaml` | example target config |
| `tools/libm_gen/README.md` | short usage notes |
| `libm/machine/riscv/Makefile` | + ~8 lines for `GEN=` override (edit existing) |

No existing assembly files are modified. The current GoFast assembly stays in place as the default when `GEN=` is unset.

---

## Verification

### Sanity (baseline reproduction)
1. `python tools/libm_gen/gen_sinf.py tools/libm_gen/configs/baseline.yaml`
2. Byte-compare `gen/baseline/andes_fpsincof.s` against `libm/machine/riscv/andes_fpsincof.s`. Should match exactly (up to whitespace) - this proves the Sollya + renderer reproduces the original tables.
3. `make GEN=baseline test-sinf` should diff-clean against the ref.

### New config validation
1. `python tools/libm_gen/run_experiment.py tools/libm_gen/configs/d9_estrin2.yaml`
2. Inspect `gen/d9_estrin2/report.json`:
   - `measured_max_ulp <= accuracy.target_ulp`
   - `text_bytes <= baseline_text + extra_text_bytes`
   - `cycles_* < baseline_cycles`
3. Run `make GEN=d9_estrin2 test-sinf` manually to double-check the diff sweep.

### Sweep
1. Place multiple configs in `tools/libm_gen/configs/sweep/*.yaml`.
2. `python tools/libm_gen/run_experiment.py tools/libm_gen/configs/sweep/`
3. Inspect `gen/sweep.csv` for a Pareto front of cycles vs ULP vs size.

### End-to-end smoke (FPGA)
1. Pick the best sweep result.
2. `make GEN=<best> bench-sinf FPGA_REMOTE=sqa-boards.andestech.com:1113`
3. Confirm FPGA cycle count roughly matches the QEMU cycle count.

---

## Decisions (confirmed with user)

- Tool location: `libm/machine/riscv/tools/libm_gen/` (lives next to the assembly it generates).
- Config format: **TOML**, parsed via `tomllib` (stdlib, Python >= 3.11). Zero third-party deps.
- Sollya: assumed to be on `PATH` - invoked as plain `sollya` in a subprocess.
- Sweep mode is in scope from day one: `run_experiment.py` accepts either a single `.toml` or a directory of them and emits `gen/sweep.csv`.

All paths in this plan are relative to `libm/machine/riscv/` unless noted. Generator layout becomes:

```
libm/machine/riscv/tools/libm_gen/
  gen_sinf.py
  run_experiment.py
  templates/
    sf_sin.s.tmpl
    andes_fpsincof.s.tmpl
    andes_fpcoscof.s.tmpl
    andes_fpreduct.s.tmpl
    sollya_minimax.sollya.tmpl
  configs/
    baseline.toml          # reproduces current GoFast sinf exactly
    d9_estrin2.toml        # example latency-target config
    sweep/                 # drop-in directory for sweep mode
      d7_horner.toml
      d9_horner.toml
      d9_estrin2.toml
      d11_estrin4.toml
  README.md
```

Generated output goes to `libm/machine/riscv/gen/<name>/` (already in this directory's `.gitignore` layout convention).
