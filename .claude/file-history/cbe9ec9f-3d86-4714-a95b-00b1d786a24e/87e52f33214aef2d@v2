# Plan: Further code-size reduction in libm/machine/riscv

## Context

Recent commits (98ad3582d, 1c63354bc, 4945f38e2) have already trimmed
`libm/machine/riscv` by ~5% (current total .text = 17558 B). The last
commit only folded *paired* stack adjustments in *double-precision*
files. Two notable opportunity classes remain:

1. **Triple-and-paired stack adjustments** still present in many files
   that the previous commit did not touch (all single-precision `sf_*`
   helpers, several `s_*` files, and some shared `andes_*` helpers).
2. **A handful of high-confidence micro-idiom rewrites** in the largest
   functions (`s_sqrt`, `s_fmod`, `sf_pow`, `s_log1p`).

Verification is straightforward: the directory ships a `Makefile` whose
`test-all` target builds an `_opt.elf` (with our assembly) and a
`_ref.elf` (toolchain libm) for every function and diffs their output
in QEMU.

## Approach (incremental, two passes)

### Pass A: Fold leftover stack adjustments (mechanical, safest)

Each candidate function still has 2 or 3 separate
`addi sp, sp, -N` instructions in its prologue (and matching epilogue),
inherited from the original Andes `push.s`/`pushm` macro lowering.
Merge them into a single `addi sp, sp, -TOTAL`, re-baseing every
intervening `sw` and the matching `lw` offsets accordingly. This is
the same transform commit `4945f38e2` already applied to a subset of
files - the technique and offset arithmetic are well-understood.

#### Triple-adjust files (3 stack adjusts -> 1; saves 4 instr/file)

| File | Adjust lines | Total frame |
|---|---|---|
| `s_sqrt.s` | 9, 11, 17 | 80 |
| `s_pow.s` | 12, 14, 20 | 96 |
| `s_log.s` | 9, 11, 17 | 96 |
| `s_log10.s` | 9, 11, 17 | 96 |
| `s_atan2.s` | 9, 11, 17 | 96 |
| `s_atan.s` | 9, 11, 13 | 64 |
| `s_asin.s` | 9, 11, 16 | 80 |
| `s_acos.s` | 9, 11, 16 | 80 |
| `s_sin.s` | 12, 14, 19 | 80 |
| `s_cos.s` | 12, 14, 19 | 80 |
| `s_tan.s` | 35, 37, 43 | 96 |
| `s_sinh.s` | 29, 31, 36 | 80 |
| `s_cosh.s` | 31, 33, 38 | 80 |
| `s_tanh.s` | 37, 39, 44 | 80 |
| `s_exp.s` | 9, 11, 14 | 64 |
| `andes_dpexatan.s` | 122, 124, 130 | 96 |
| `andes_dpexlog.s` | 74, 76, 82 | 96 |
| `andes_dpexexp.s` | 56, 58, 64 | 80 |

#### Paired-adjust files (2 stack adjusts -> 1; saves 2 instr/file)

`sf_log.s`, `sf_log10.s`, `sf_frexp.s` (inner `__clzsi2` wrappers),
`s_modf.s`, `s_floor.s`, `s_ceil.s`, `s_ldexp.s`, `s_fmod.s`,
`andes_dpreduct.s`, `andes_fpreduct.s`, `andes_exsub.s`,
`andes_exadd.s`, `andes_exmul.s`, `andes_exdiv.s`,
`andes_dpexsqrt.s`, `andes_sigmax.s`, `andes_fpexexp.s`.

Estimated total Pass A savings: ~150-300 B (depending on how many
fold to compressed `c.addi16sp` after assembly).

### Pass B: Targeted micro-rewrites in the largest functions

Highest-confidence candidates only. Each is small and locally
verifiable.

1. **`s_sqrt.s` lines 53-57 and 66-70** - 3-mv high/low swap after
   `mulhu`/`mul` pairs. Just emit the operations into the desired
   destinations directly:
   - Lines 53-57: replace `mulhu x20,x9,x15; mul x19,x9,x15; mv;mv;mv`
     with `mul x20,x9,x15; mulhu x19,x9,x15` (or equivalent ordering
     matching the live-out usage). Saves 3 instr.
   - Lines 66-70: same pattern with `x15,x15`. Saves 3 instr.
2. **`s_sqrt.s` line 63** - `mulhu x11,x9,x9` is dead (x11 overwritten
   at line 66 with no intervening read). Delete. Saves 1 instr.
3. **`s_fmod.s` lines 22 and 30** - duplicate `li 2147483648` into two
   different scratch regs (`x14`, `x18`). Hoist a single load and
   reuse it for both `or` operations by reordering the surrounding
   `slli` ops so the constant register isn't clobbered prematurely.
   Saves 1 large `li` (lui+addi = 8 B).
4. **`s_log1p.s` lines 110-113** - `li x10,0; li x11,0; sw x10,...; sw
   x11,...` -> `sw x0,...; sw x0,...`. Saves 2 instr.
5. **`s_log1p.s` lines 179-183** - the `__adddf3` is commutative; swap
   the two-source order so the in-register result becomes the second
   operand directly, dropping the `mv x12,x10; mv x13,x11`. Saves
   2 instr.

`sf_pow.s` reload-then-respill (lines 77-78 / 99-100) and `s_expm1.s`
spill/reload pairs (lines 165-177, 194-200) are also candidates but
need a more careful flow trace before committing - **deferred**.

Estimated Pass B savings: ~30-50 B.

### Verification (after each pass, per file)

```sh
cd /home/nick/work/picolibc_agentic/libm/machine/riscv
make size-<func>            # confirm size shrink
make test-<func>            # builds opt + ref ELFs, runs both in QEMU,
                            # diffs output - any divergence aborts
```

After all changes:

```sh
make test-all               # full sweep
make size-all               # final size report; diff against size-opt4
```

The repo also has stale `size-baseline`, `size-opt`, ..., `size-opt4`
text files - capture a new `size-opt5` snapshot for the commit message.

## Critical files to modify

Pass A (stack-adjust folds): the 18 triple-adjust files and 17
paired-adjust files listed above.

Pass B (micro-rewrites):
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_sqrt.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_fmod.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_log1p.s`

## Out of scope

- Functions with already-folded single adjusts (e.g. the
  double-precision files touched by 4945f38e2).
- Algorithmic rewrites of the polynomial evaluators or argument
  reduction.
- `rv32e/*.s` mirror tree (separate multilib; can be a follow-up).
- The deferred risky candidates in `sf_pow.s` and `s_expm1.s`.
