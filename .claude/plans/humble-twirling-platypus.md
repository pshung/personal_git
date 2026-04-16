# Plan: Andes helper size optimizations

## Context

The RISC-V libm under `libm/machine/riscv/` has ~40 hand-written `andes_*.s`
helper files shared by all higher-level math functions. Prior work has been
focused on the `s_*.s` / `sf_*.s` top-level routines (dead-mul removal,
`sw x0` for zero stores, constant hoisting). The helper files were not yet
audited. This plan is the result of a size audit of the top-level helpers
(not rv32e). The goal is to remove dead code and boilerplate duplication
without touching behavior, verified via the existing `make test-*` A/B
comparison.

## Findings - candidate edits

Ranked by risk (low to higher) and by estimated byte savings.

### Tier A - trivial, mechanical, zero behavioral risk

1. **andes_0.s** - 4x foldable adjacent `addi sp, sp, -16` pairs.
   Each pair (two separate qzero / pzero prologues/epilogues) collapses to a
   single `addi sp, sp, -32` / `+32`. Est. 8 instructions removed.
   File lines ~219-220, ~235-236 (and matching epilogues).

2. **andes_1.s** - identical pattern to andes_0.s. Est. 8 instructions removed.

3. **andes_n.s** - two adjacent `addi sp, sp, 16` at lines ~53-54 and
   ~101-102. Investigate the line 102 `16 vs 8` comment mismatch first -
   may be a latent bug in the hand-translated code or just a stale comment.
   If comment is stale, fold to single `addi sp, sp, 32`. Est. 2
   instructions removed.

4. **andes_fpexsqrt.s** - three apparently-dead `mul` instructions in a
   7-line span (lines 48-49, 51-52, 53-54): each writes to `x14` or `x10`
   that is overwritten before any read. Same dead-`mul` pattern fixed in
   `s_sqrt.s` commit c40cb6ed9. Est. 3 instructions removed in the
   smallest helper.

### Tier B - dead `mul` removals in other helpers

Apply the same pattern used in `s_sqrt.s`: delete `mul` instructions whose
destination is overwritten before use. Each must be individually verified
against surrounding register life by reading a 10-line window and then by
`make test-<func>` for every function that reaches the helper.

5. **andes_fpexatan.s** - ~4 dead muls at lines ~145-146, ~212-213,
   ~228-229, ~240-241. Also 3x duplicate `li x15, 2147483648` across
   lines ~86, 155, 270 (hoistable into a callee-save x-reg spanning the
   whole function body if a free callee-save exists - needs liveness
   verification, else skip).

6. **andes_dpexsqrt.s** - ~4 dead muls in the even/odd exponent arms
   (lines 18-20, 32-34). Plus 4x `li x9, 65535` at lines 55, 97, 116,
   135 - hoist to a single load at function entry if x9 is preserved.

7. **andes_fpexlog.s** - ~2 dead muls (lines ~162-166, ~174-175). Plus
   4x duplicate `li x21, 2147483648` - hoist. Also prologue/epilogue
   pushes sp twice (split pushm pattern); combining into a single frame
   adjust saves 2 instructions.

8. **andes_dpexatan.s** - 1 clearly dead `mul` at line ~175-178.
   Plus multiple duplicate `li ..., 2147483648` loads.

9. **andes_fpexexp.s** - 1 dead `mul` at line ~75-78 (same pattern).

### Tier C - duplicate scaffolding (bigger wins, higher risk)

10. **andes_dpexlog.s** - two identical 14-line push/call `__clzsi2` /
    pop scaffolds. Consider factoring to a local helper block or using
    fall-through to a shared tail. Est. ~10-12 instructions saved if
    factored successfully.

11. **andes_fpexlog.s** - same `__clzsi2` scaffold duplicated twice.
    Similar factoring. Est. ~10 instructions.

12. **andes_dpexexp.s** - two ~24-line save/call-`__gf_sigmax`/restore
    blocks that differ only by the table address (`expcoo` vs `expcon`).
    Factor via `la x10, table; jal .Lcommon` form. Est. ~18-20
    instructions saved. Highest single-file win in this tier.

### Tier D - skip (not worth the risk or effort)

- `andes_dpreduct.s` / `andes_fpreduct.s` - bulk carry-chain code, already
  minimal for ADC-less RISC-V. No clear wins.
- `andes_r.s` / `andes_r4.s` / `andes_n.s` dispatcher bodies - already tight.
- `andes_up4.s` .. `andes_up8.s` - each is a chain of 4 instructions
  tail-calling the next. Cannot shrink without breaking the reuse chain.
- `andes_p*.s` - prologue/epilogue is already minimal; can't eliminate
  saving of the `__adddf3` / `__muldf3` function pointers in x19/x20.
- Structural 4-6x duplication of div/remu/mul loops in `dpexsqrt.s` and
  `fpexatan.s` - large potential but high correctness risk; defer.

## Critical files to modify

Low risk, do first:
- `libm/machine/riscv/andes_0.s`
- `libm/machine/riscv/andes_1.s`
- `libm/machine/riscv/andes_n.s` (verify line 102 first)
- `libm/machine/riscv/andes_fpexsqrt.s`

Medium risk, one file per commit:
- `libm/machine/riscv/andes_fpexatan.s`
- `libm/machine/riscv/andes_dpexsqrt.s`
- `libm/machine/riscv/andes_fpexlog.s`
- `libm/machine/riscv/andes_dpexatan.s`
- `libm/machine/riscv/andes_fpexexp.s`

Higher risk, consider last:
- `libm/machine/riscv/andes_dpexlog.s`
- `libm/machine/riscv/andes_dpexexp.s`

## Pattern references (already-landed commits)

- `c40cb6ed9` s_sqrt.s - dead `mulhu` in squared-norm computation
- `b672cb2f9` s_fmod.s - hoist duplicate `li 0x80000000`
- `026bf3e50` s_log1p.s - `li 0; sw` pairs -> `sw x0`
- `f21da4f44` s_log1p.s - swap `__adddf3` args to eliminate `mv` pair
- `69fe05243` s_expm1.s - redundant loads, li+sw zero folds, li hoists

These are the exact patterns to mirror here.

## Verification protocol (per commit)

Each commit must pass the Makefile A/B compare for every function that
reaches the modified helper. Mapping (from call-graph in CLAUDE.md):

- andes_0.s / andes_1.s: used by j0/j1/y0/y1 - not in the current
  `FUNCS_DOUBLE_*` test list, so verify by building `libandes.a` cleanly
  and comparing `size` before/after. No runtime test available.
- andes_n.s: used by jn/yn - same as above; size check only.
- andes_fpexsqrt.s -> sqrtf, hypotf-path in float: `make test-sqrtf`
- andes_fpexatan.s -> atanf, asinf, acosf: `make test-atanf test-asinf test-acosf`
- andes_fpexlog.s -> logf, log10f, powf: `make test-logf test-log10f test-powf`
- andes_fpexexp.s -> expf, coshf, sinhf, tanhf, powf:
  `make test-expf test-coshf test-sinhf test-tanhf test-powf`
- andes_dpexsqrt.s -> sqrt, hypot-path: `make test-sqrt`
- andes_dpexatan.s -> atan, asin, acos: `make test-atan test-asin test-acos`
- andes_dpexlog.s -> log, log10, pow: `make test-log test-log10 test-pow`
- andes_dpexexp.s -> exp, cosh, sinh, tanh, pow:
  `make test-exp test-cosh test-sinh test-tanh test-pow`

Between each commit:
1. `make clean && make` to rebuild `libandes.a` and all test elfs.
2. `make size-all` and compare TOTAL against baseline captured before edits.
3. `make test-<f>` for every function mapped above. All must report `PASS`.
4. Only then `git commit` using `/commit` skill (commit-optimizer) to
   capture size delta.

## Execution order

1. Capture baseline: `make clean && make size-all > /tmp/andes-size-baseline.txt`
2. Tier A edits, one commit per file, verify after each.
3. Tier B edits (dead muls + constant hoists), one file per commit,
   verify after each. Stop and investigate if any test FAILs - do not
   batch-fix.
4. Tier C (scaffolding refactors) only if Tiers A+B complete cleanly.
   Each refactor gets its own commit and full verification sweep.
5. Final size report: `make size-all > /tmp/andes-size-after.txt` and
   diff against baseline.

## Notes / open questions

- andes_n.s line 102 `addi sp, sp, #8` comment vs `addi sp, sp, 16`
  instruction: confirm whether this is a documented hand-translation
  comment that went stale, or a latent bug. Read git blame first.
- Some duplicate-`li` hoists require finding a free callee-save register;
  if all x9/x18-x21 are live across the duplication span, hoist is not
  possible and that item is dropped.
- Estimated total savings across all tiers (very rough, pre-verification):
  50-90 instructions, i.e. 200-360 bytes of `.text` in the andes helpers.
  Tier A alone is ~20 instructions / ~80 bytes at zero risk.
