# Why optimized cos is slower than ref (and what to do about it)

## Context

Bench results for `cos(1.0)` (100 calls in a loop) on Andes FPGA:

| variant | instructions | cycles | CPI |
|---------|--------------|--------|-----|
| ref     | 102808       | 615881 | 5.99 |
| opt     | 101621       | 619224 | 6.09 |

Opt executes **1187 fewer instructions (-1.15%)** but takes **3343 more cycles (+0.54%)**. CPI got worse, so the dynamic instruction reduction was more than cancelled by new pipeline stalls. Per-call delta: ~12 instructions saved, ~33 cycles lost.

This is the soft-float RV32 build (`-march=rv32im`). The entire cos call path is integer arithmetic - **no FPU instructions involved**. (`k_cos.s` is dead code on this path; the optimized path is `s_cos.s` -> `andes_dpreduct.s` -> `andes_exmul.s` -> `andes_sigmax.s`.)

## Root cause

Two recent "code-shrink" commits removed instructions that were inadvertently acting as scheduling padding for an in-order pipeline with multi-cycle multiplier and AGU-after-sp-update stalls.

### Commit `a58f346db` "fold remaining paired/triple stack adjusts"

Merged sequences like `addi sp,-16; sw; addi sp,-16; sw; addi sp,-48` into a single `addi sp,-80` followed by 5 back-to-back sp-relative stores. On simple in-order Andes cores, the first store after `addi sp` incurs an AGU stall waiting for the new `sp` value. The previous form spread the sp updates across the prologue, hiding this latency.

Hit sites per cos call: prologue + epilogue of `__gf_dpcos` (s_cos.s:12-17, :111-117), `__gf_dpreduct`, `__gf_exmul` (called 1-2 times), `__gf_sigmax` (called 1-2 times). ~10 stall sites per call x 100 calls x ~3 cycles = **~3000 cycles**, matching the observed delta.

### Commit `98ad3582d` "reduce code size across all RV32 libm assembly"

Collapsed `mv; mul; mulhu; mv; mv` mulr64 sequences to bare `mulhu`/`mul` pairs. The removed `mv`s were absorbing multiplier latency. The bare result is now consumed 1-2 instructions later by another integer op, creating a multi-cycle RAW stall on each.

Sites:
- `andes_exmul.s:13-14, 18-19, 24-25` - 3 mul pairs per call to `__gf_exmul` (called 1-2x per cos)
- `andes_sigmax.s:38-39, 43-44, 52-53` - 3 mul pairs **inside the Horner loop**, which iterates `degree+1 = 6` times for cos (s_cos.s:56 sets `li x13, 5`)

Worst-case contribution: 6 iters x 3 muls x 3 cycles x 100 calls = ~5400 cycles. Even partial impact dwarfs the saved instructions.

### Smaller contributors

- Coefficient-table load-use stall at `andes_sigmax.s:32-37` (`lw x18` -> `mv x20,x18` 2 instructions later).
- `tail .LCret` at s_cos.s:68 - 1 fetch bubble per call vs fall-through.
- Reduced `slt`+branch hint distance in `__gf_dpreduct` branchy reducer.

## Files involved

- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_cos.s` - entry, prologue at :12-17, epilogue at :111-117
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/andes_exmul.s` - mul pairs at :13-14, :18-19, :24-25
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/andes_sigmax.s` - Horner loop mul pairs at :38-39, :43-44, :52-53; coefficient loads :32-35
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/andes_dpreduct.s` - argument reduction (small contribution for `cos(1.0)`)

## Verification plan (read-only first)

1. **Confirm magnitude attribution**: check out parent of `a58f346db`, rebuild bench, run `make bench-cos`. If most of the 3343 cycles return, confirms (1). Then test parent of `98ad3582d` similarly for (2).
2. **Inspect actual schedule**: disassemble `test/test_cos_bench_opt.elf` and look for the suspect prologue + Horner sequences to confirm they survived assembly to final instruction layout.

## Fix options (choose one to pursue after verification)

- **A. Reschedule prologue stores** in `s_cos.s`, `andes_dpreduct.s`, `andes_exmul.s`, `andes_sigmax.s` to interleave a non-sp-dependent instruction between `addi sp` and the first sp-relative store. Restores 1 cycle/site without re-adding instructions.
- **B. Restore mul-latency padding in `__gf_exmul` and `__gf_sigmax`**: insert independent integer work (the `add`/`sltu` carry chain that follows) between `mulhu`/`mul` and their consumers. Pure scheduling; same instruction count.
- **C. Both A+B**: should recover all of the 3343 cycles and likely improve over the original since the static instruction wins from `98ad3582d`/`a58f346db` are preserved.

Recommended: **C**, since it preserves the size win and only requires reordering existing instructions.

## Out of scope

- "Helper-factoring" commits (`a1d1f3fcb`, `82e312165`, `f88a463be`) touched `andes_dpexexp.s`/`andes_dpexlog.s`/`andes_fpexlog.s` only. **None of those files are on the cos call path**, so the user's initial guess that factoring caused the regression does not apply here.
- `k_cos.s` is the legacy newlib-style kernel using libgcc soft-float helpers. Not called from `__gf_dpcos`. No changes needed there.
