# Plan: Size optimization of s_expm1.s

## Context

`s_expm1.s` is the largest untouched hand-tuned RISC-V assembly routine in
`libm/machine/riscv/` at 1152 bytes `.text` (per `size-opt6` report). Recent
commits have shrunk `s_log1p.s`, `s_fmod.s`, and `s_sqrt.s` using patterns
like folding `li 0`+`sw` into `sw x0`, hoisting duplicate literals, and
removing redundant loads. The same patterns apply to `s_expm1.s`. This plan
applies only high-confidence, semantics-preserving tweaks verified by
direct code inspection.

File: `/home/nick/work/picolibc_agentic/libm/machine/riscv/s_expm1.s`

## Changes

All line numbers refer to the current file.

### 1. Line 243: remove redundant reload of 28(sp) (-2 bytes)

At line 240 `lw x12, 28(sp)` already loaded the value. Lines 241-242
(`li x15, -1; beq x12, x15, .L28`) do not clobber x12. Line 243
`lw x15, 28(sp)` reloads the same value, and line 245
`bne x15, t6, .L29` is the only user.

- Delete line 243.
- Change line 245 to `bne x12, t6, .L29`.

Savings: one compressed `c.lwsp` (2 bytes).

### 2. Lines 326+335: fold `li x12, 0; sw x12, 56(sp)` to `sw x0, 56(sp)` (-2 bytes)

At line 326 `li x12, 0` is loaded, then line 335 `sw x12, 56(sp)` stores
it. Between them (lines 327-334) x12 is not used. At line 337
`mv x12, x19` reassigns x12 before any other read.

- Delete line 326.
- Change line 335 to `sw x0, 56(sp)`.

Savings: one compressed `c.li` (2 bytes). `c.swsp` with x0 source is
legal, same size as the original store.

### 3. Lines 391+393: fold `li x11, 0; sw x11, 28(sp)` to `sw x0, 28(sp)` (-2 bytes)

At .L17 line 391 loads `x11 = 0`, line 392 loads x10 with a literal,
line 393 stores x11 to 28(sp). x11 is then reloaded at line 396
(`mv x11, x20`) before any read.

- Delete line 391.
- Change line 393 to `sw x0, 28(sp)`.

Savings: one compressed `c.li` (2 bytes).

### 4. Line 330: replace `lw x11, 28(sp)` with `mv x11, x10` (0 bytes, but see note)

At line 325 `lw x10, 28(sp)` loads the value. Between 325 and 330, x10
is read (327, 328) but not written. Line 330 reloads 28(sp) into x11;
same value is already in x10.

- Change line 330 to `mv x11, x10`.

Both `c.lwsp` and `c.mv` are 2 bytes, so this is size-neutral but
slightly faster (no load). Optional - include only if other changes
apply cleanly.

### 5. Line 349: replace `lw x11, 28(sp)` with `mv x11, x10` (0 bytes)

`.L36` is reached only via `beqz t6, .L36` at line 329. Along that
path, x10 holds 28(sp) from line 325 and is not clobbered. Same
analysis as #4: size-neutral, slightly faster.

- Change line 349 to `mv x11, x10`.

### 6. Lines 52-57: reuse x12 via `mv x13, x12` (-6 bytes)

Line 52 sets `x12 = 1082535490`. Line 53 branches to .L5 on it. If
the branch is not taken, line 54 immediately clobbers x12. Line 57
rematerializes the same `1082535490` constant into x13. Since
`1082535490` does not fit in 12 bits, the original `li` is a
2-instruction sequence (lui+addi, 8 bytes, non-compressible).

Reorder:

    li   x12, 1082535490          # line 52
    bltu x9, x12, .L5             # line 53
    mv   x13, x12                 # NEW, 2 bytes compressed
    lui  x12, 524032              # line 54
    bgeu x9, x12, .L6             # line 55
    li   x12, -17155601           # line 56
                                  # line 57 deleted
    call __gtdf2                  # line 58

At the .L5 branch target, x13 is immediately rewritten (line 67
`li x12, -1023872167; li x13, 27618847`), so leaking the new value
into x13 is safe.

Savings: 8 bytes (deleted `li`) - 2 bytes (new `c.mv`) = **6 bytes**.

## Total estimated savings

~12 bytes (2+2+2+6) across 4 independent edits. Modest; s_expm1 is
mostly ABI argument-shuffling around `__adddf3`/`__subdf3`/`__muldf3`
calls, which is structurally hard to shrink further without freeing a
callee-saved register to hold `__adddf3` (rejected: no free register
without spilling).

## Files to modify

- `libm/machine/riscv/s_expm1.s`

## Verification

From `libm/machine/riscv/`:

1. Accuracy: `make test-expm1` (builds `test/expm1_opt.elf` vs
   `test/expm1_ref.elf` under Andes QEMU v5 and diffs output).
2. Size delta: `make size-expm1` before and after; expect ~1152 ->
   ~1140 bytes `.text`.
3. Optional: `make test-all` to ensure no shared-helper regressions
   (s_expm1 calls `andes_p5ac` and uses `Q` table; neither is touched).
