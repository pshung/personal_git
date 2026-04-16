# Plan: Reduce .text size in RV32 libm assembly

## Context

Current `.text` total across the 56 RV32 libm functions is **17592 bytes** (per `make size-all`). Recent commits already did register-allocation and compressed-instruction passes. Investigating the 8 largest assembly files identified ~190-265 bytes of remaining low-to-medium risk savings, dominated by:

1. Split `addi sp,sp,-N` prologue/epilogue pairs (almost every file).
2. Duplicated `__clzsi2` save/restore wrappers (3 copies in `s_fmod.s`).
3. Redundant load-then-store sequences after callee returns.
4. `li t6,1; add; sltu` carry pattern that has a 2-byte shorter form.

This plan covers only the **low-risk, mechanically-verifiable** wins. Higher-risk refactors (cross-call register reallocation, control-flow folding) are deferred.

## Approach

Apply changes file-by-file. After **each** file edit, run:
```
make clean && make test-<func>
```
to verify accuracy diffs vs the reference build, then `make size-<func>` to confirm bytes saved.

### Phase A: cross-cutting low-risk wins (apply to all 8 files)

For each file in `{s_expm1.s, s_log1p.s, s_pow.s, s_sqrt.s, sf_pow.s, s_fmod.s, s_acos.s, s_asin.s}`:

1. **Merge split `addi sp,sp,-N` prologue and epilogue pairs** into a single frame adjust. Verify all `lw`/`sw` offsets in the function body are updated to the new total.
   - Estimated: ~4-6 bytes/file = **~32-48 bytes**.

2. **Replace `li t6,1; add reg,reg,t6; sltu t6,reg,t6` with `addi reg,reg,1; seqz t6,reg`** wherever the literal `1` is used only for the increment+overflow check. Search target: `s_sqrt.s` (3 sites), `s_pow.s` (1 site).
   - Estimated: **~8-10 bytes**.

3. **Merge nested `addi sp,-16; addi sp,-16` inside `__clzsi2` wrapper blocks** to a single `addi sp,-32` (and matching epilogue). Sites: `s_pow.s`, `s_sqrt.s`, `s_fmod.s` (x3), `s_acos.s`, `s_asin.s`, `sf_pow.s`.
   - Estimated: **~24-32 bytes**.

### Phase B: targeted dedup (highest ROI single change)

4. **`s_fmod.s`: dedup three `__clzsi2` save/restore wrappers**. The three blocks at L96-112, L184-200, L230-246 differ only in (a) the `mv x10, <reg>` argument and (b) the destination of the result. Approach:
   - Convert two of them into shared local-label trampolines reached via `jal ra, .Lclz_*`, with the differing `mv` happening before the `jal`.
   - Or factor only the spill/restore halves and inline the call.
   - Estimated: **~30-40 bytes**.

### Phase C: targeted small fixes

5. ~~**`s_expm1.s`**: eliminate the second `la x8, __subdf3`~~ - **NOT feasible as written.** At L178, `x8` is overwritten with `la x8, Q` because `andes_p5ac` uses `x8` as its coefficient-table pointer register. The reload at L186 (`la x8, __subdf3`) is therefore necessary. Eliminating it would require either (a) confirming `andes_p5ac` does not use `x8` as an input (needs andes_p5ac ABI audit), or (b) saving/restoring `x8` around the `la x8, Q` block - which costs more than the reload saves. **Skip unless andes_p5ac ABI is confirmed to not use x8.**

6. ~~**`s_expm1.s`**: remove the redundant `lw x15, 28(sp)` at L243~~ - **No size saving.** L240 loads `lw x12, 28(sp)`, and L243 reloads the same offset into `x15`. Replacing L243 with `mv x15, x12` is correct, but both `c.lw` and `c.mv` encode as 2 bytes in RV32C. Zero bytes saved. (Eliminates a memory access, but this is not a code-size optimization.)

7. ~~**`sf_pow.s`**: replace `li x21, 65535; and x20, x14, x21` with `slli/srli`~~ - **Already done.** `sf_pow.s` L190-191 already reads `slli x20,x14,16` / `srli x20,x20,16` with comment "zero-extend lower 16 bits of x14". Nothing to do.

### Total estimated savings: ~80-130 bytes (~0.5-0.7% of total)

Phase C yielded no actionable items after verification against the actual files - all three original items were either already done, not feasible, or produced no size saving. Savings come entirely from Phase A and Phase B.

If accuracy and size targets are met after Phase A-B, more aggressive changes (s_acos/s_asin store-after-load folding, s_pow shl-with-carry helper) can be evaluated as follow-ups.

## Critical files

- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_expm1.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_log1p.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_pow.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_sqrt.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/sf_pow.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_fmod.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_acos.s`
- `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_asin.s`

Shared `andes_*.s` helpers are **not** modified.

## Verification

After **each** file change:
```
cd /home/nick/work/picolibc_agentic/libm/machine/riscv
make clean
make test-<func>     # diffs opt vs ref ELF output
make size-<func>     # confirms bytes saved
```

After all changes:
```
make clean && make test-all     # full accuracy sweep
make size-all                   # final aggregate size
```

Compare final `size-all` total against current baseline of **17592 bytes** to quantify total savings.

If any `test-<func>` shows a diff, revert that file's changes and investigate before continuing.
