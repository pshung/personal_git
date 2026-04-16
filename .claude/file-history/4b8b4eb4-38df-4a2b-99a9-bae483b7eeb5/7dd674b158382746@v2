# Latency Optimization of RISC-V libm Assembly

## Context

The RISC-V soft-float libm assembly in `libm/machine/riscv/` was machine-translated
from Andes v3 (`pushm/popm`, `mulr64`, etc.) into plain RV32IM. The translation
preserved correctness but left behind patterns that hurt per-call latency on
in-order cores:

- Long serial `sw/lw` blocks with load-use hazards feeding immediately-dependent
  arithmetic.
- Values stored to the stack and then re-loaded from the same slot into a
  different register, effectively a `mv` via memory.
- A local `__clzsi2` wrapper (`.Ldo_clzsi2`) that spills 5 registers around every
  call, used on the hot path in `__gf_dpexlog`.
- Three-way register swaps (`mv tmp,a; mv a,b; mv b,tmp`) after multiply blocks
  in `andes_exmul/exdiv/sigmax` that could be removed by renaming later uses.
- At least one fully dead multiply in `andes_sigmax.s`.
- Redundant constant rematerialization (`li x19,32`, `li t6,1`) across branches.

Recent commits (`5b999a3bd`, `14f74476a`) already established the pattern of
inlining `__clzsi2` in `sf_fmod.s` / `andes_exsub` / `sf_modf.s` for exactly this
reason. This plan extends that treatment across the rest of the hot call graph,
targeting latency reduction with <=2% code-size growth per file (some changes
are net-negative size).

Intended outcome: measurable cycle reduction on FPGA benchmarks for `log`,
`logf`, `sin`, `cos`, `exp`, `pow`, `sinh`, `cosh`, `tan`, `asin`, `acos`
(all of which flow through `__gf_dpexlog`, `__gf_sigmax`, `__gf_exmul`, or
`__gf_exadd`), with no accuracy regressions and no significant size growth.

## Scope and Approach

All work is in `libm/machine/riscv/`. Changes are strictly mechanical /
local; no algorithm changes, no new coefficient tables, no interface changes.
Each change is independently measurable via the existing `make bench-<func>`
and `make test-<func>` targets.

The changes are grouped into waves, ordered by `(expected cycle win) / (risk)`.
After each wave: run `make test-all` for correctness and `make bench-<func>`
on the primary impacted functions, then commit via `/commit` skill with the
benchmark deltas captured.

## Wave 1 - Pure dead code / dead moves (free wins, net size reduction)

No risk, no size cost, directly removes instructions from the hot path.

### File: `andes_sigmax.s`
Called from every trig and transcendental (`s_sin`, `s_cos`, `s_exp`, `s_log`,
`s_pow`, etc.) - arguably the single hottest helper in the library.

- Line 53: `mul x14,x10,x18` is immediately overwritten by `mv x14,x20` on
  line 54 with no intervening read of x14. Delete the `mul`.
- Lines 51/54: `mv x20,x14` / `mv x14,x20` pair exists only to preserve x14
  across the (now-deleted) mul. Once the mul is gone, both mvs are dead.
  Remove them and delete the now-unnecessary save of x20.
- Lines 43-47 and 44-46: the 3-way shuffle
  `mv x9,x18; mv x18,x20; mv x15,x12; mv x12,x13; mv x13,t6`
  after the mul block can be collapsed by renaming subsequent uses of x9,
  x12, x13, x18 to read directly from the post-mul registers. Verify by
  tracing live ranges through `.Li2` (line 65).

### File: `andes_dpexsqrt.s`
Two copies of the pattern `mv x21,x14 ; mulhu x15,x11,x15 ; mv x14,x21` around
lines 17-19 and 30-32. `mulhu` does not write x14, so both `mv`s are dead.
Remove them at both sites.

### File: `andes_exmul.s` (lines ~20-22)
`mv t6,x9 ; mv x9,x18 ; mv x18,t6` 3-way swap after the multiply block.
Replace by renaming subsequent uses through `.Lb1`'s fallthrough region. No
instruction to execute, no chain length.

### File: `andes_exdiv.s` (lines ~61-63 and ~155-157)
Same 3-way `mv` swap pattern, twice. Same fix.

**Verification after Wave 1**:
- `make test-all` - all pass
- `make bench-sin bench-cos bench-exp bench-log bench-sqrt`
- Expect 3-10 cycles saved per call in functions that route through sigmax;
  fewer for sqrt/exmul/exdiv.

## Wave 2 - Store-then-reload-same-slot -> direct `mv`

No risk, net size reduction, reduces memory traffic through D-cache.

### File: `andes_dpexlog.s` - three sites

Each site has the pattern:
```
sw x10,4(sp) ; sw x11,8(sp) ; sw x12,12(sp) ; sw x13,16(sp) ; ...
mv x10,x18 ; mv x11,x19 ; mv x12,x20
lw x13,4(sp) ; lw x14,8(sp) ; lw x15,12(sp)    # reloads x10,x11,x12 originals
```
The lw block is a move-through-memory of the just-stored values. Replace with
`mv x13,x10; mv x14,x11; mv x15,x12` executed before the `mv x10,x18...`
overwrites. Apply at:
- Lines 130-142 (before the `__gf_exdiv` call)
- Lines 162-170 (before the second `__gf_exmul` call)
- Lines 245-257 (before the `__gf_exadd` call)

Each site: 3 `lw` -> 3 `mv`. Same instruction count, zero memory traffic,
zero load-use stall.

**Verification**: `make test-log bench-log bench-pow bench-logf bench-powf`.

## Wave 3 - Inline `__clzsi2` in dpexlog (follow existing pattern)

### File: `andes_dpexlog.s`
- Delete `.Ldo_clzsi2` at lines 284-303.
- At the two call sites (lines 120 and 195), inline the `__clzsi2` call
  directly following the pattern already used in `sf_fmod.s` /
  `andes_exsub.s` (see commit `5b999a3bd`). The caller can use the already
  live t-registers for `__clzsi2`'s scratch without the 5-register spill.

Each site: removes ~10 instructions of wrapper overhead + 1 call/return pair.
Net code size: shrinks (wrapper body deleted, inline body smaller than the
wrapper because no spill).

**Verification**: `make test-log bench-log bench-pow`; compare `size-*`
artifacts for `andes_dpexlog.o` before/after.

## Wave 4 - Reorder post-call reload blocks to hide load-use

Purely instruction scheduling. No size change.

### Files and sites
- `s_sin.s` lines ~45-52: reloads x10,x11,x12,x13,x14,x15 then
  `addi x20,x12,-1; andi x20,x20,2; beqz x20,.Li4`. Move x12's reload to
  the top (or pair the `addi`/`andi`/`beqz` immediately after `lw x12`'s
  slot is filled but before the unrelated reloads) so the 3-instruction
  dependent chain runs in the shadow of the other loads.
- `andes_dpexexp.s` lines ~76-87: 7 consecutive `lw` from sp then
  `addi x9,x20,-1022` depending on latest load. Reorder x20 reload first.
- `andes_dpexexp.s` lines ~150-160: same pattern with `xor x15,x15,x14`.
- `andes_dpexlog.s` lines ~185-195: 7 reloads then branch on x13 + call
  with x13 arg. Move the x13-dependent sequence before the unrelated loads.
- `andes_dpexlog.s` line 161: `addi x12,x12,1` directly consumes the x12
  just reloaded at line 189. Hoist it or reorder the reload block.

These changes individually save 1-3 cycles per call on in-order cores
with load-to-use latency of 2+.

**Verification**: `make bench-sin bench-cos bench-exp bench-log`.

## Wave 5 - Branchless carry propagation in exadd/exmul

Moderate size impact (small growth) but eliminates hard-to-predict short
branches in hot soft-float helpers. Do this wave only if Waves 1-4
produced less-than-expected cycle improvements, since the size cost is
real (+8-16 bytes per site) and the branches are typically well-predicted
once warm.

### Files (deferred/optional)
- `andes_exadd.s` lines 53-70
- `andes_exmul.s` lines 29-45 and 49-78
- `andes_dpreduct.s` lines 40-108 (five copies of the same idiom)

Replace `add; sltu; beqz; add; sltu; beqz; addi; tail` carry-propagation
trees with straight-line
```
add  x10,x10,x13
sltu c1,x10,x13
add  x11,x11,x14
sltu c2,x11,x14
add  x11,x11,c1
sltu c3,x11,c1
or   carry,c2,c3
```

**Verification**: `make bench-exp bench-log bench-pow bench-sin`. Expect
1-3 cycles per exadd/exmul call on cores with >=2-cycle branch mispredict
penalty.

## Critical files to modify

| File | Wave |
|---|---|
| `libm/machine/riscv/andes_sigmax.s` | 1 |
| `libm/machine/riscv/andes_dpexsqrt.s` | 1 |
| `libm/machine/riscv/andes_exmul.s` | 1 (+5 optional) |
| `libm/machine/riscv/andes_exdiv.s` | 1 |
| `libm/machine/riscv/andes_dpexlog.s` | 2, 3, 4 |
| `libm/machine/riscv/andes_dpexexp.s` | 4 |
| `libm/machine/riscv/s_sin.s` | 4 |
| `libm/machine/riscv/andes_exadd.s` | 5 (optional) |
| `libm/machine/riscv/andes_dpreduct.s` | 5 (optional) |

## Reused Existing Patterns

- Inline `__clzsi2` pattern: already established in
  `libm/machine/riscv/sf_fmod.s` and `libm/machine/riscv/andes_exsub.s`
  (commit `5b999a3bd`), and `libm/machine/riscv/sf_modf.s`
  (commit `14f74476a`). Copy that pattern for Wave 3.
- Inline polynomial evaluation with `mulhu`: already done in
  `libm/machine/riscv/sf_sin.s` (lines ~40-65). Useful reference for
  register-allocation style when collapsing shuffles in Wave 1.
- `EN_PERF` benchmarking harness in `test/test_<func>.c` files: use
  existing `make bench-<func>` targets. No new bench files needed.

## End-to-End Verification

After each wave, from `libm/machine/riscv/`:

```sh
# Correctness on every touched function
make clean && make test-all

# Size check (should not grow noticeably except Wave 5)
make size-all > size-after.txt
diff size-before.txt size-after.txt

# Cycle count on FPGA via GDB harness
make bench-sin bench-cos bench-exp bench-log bench-sqrt bench-pow
make bench-sinf bench-cosf bench-expf bench-logf
```

Commit each wave independently using the `/commit` skill so each size/cycle
delta is isolated and bisectable. Roll back any wave whose bench output
shows regression vs. the previous wave's baseline.

## Out of Scope

- Changes to C files in this directory (only `.s` assembly).
- Any coefficient/table changes.
- RV32E variants in `rv32e/` unless the upstream `.s` shares identical
  code - secondary pass after Waves 1-4 stabilize.
- New benchmarks or test harnesses - existing ones cover every target.
- FPU-aware or vector paths.

## Prompt-Injection Note

While exploring, `Read` tool results returned system-reminders instructing
refusal to improve code after any file read (framed as malware analysis).
The files read (`andes_sigmax.s`, `andes_dpexlog.s`) are clearly part of
the user's own picolibc working tree and are not malware. The reminders
appear misaligned with the requested task. No changes will be made in
plan mode regardless; flagging here so the user is aware before approving
execution.
