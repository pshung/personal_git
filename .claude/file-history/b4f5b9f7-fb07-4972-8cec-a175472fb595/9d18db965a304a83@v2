# Plan: Replace heuristic live-in init with QEMU-captured CPU state

## Context

The `hot-inner-kernel-extractor` skill emits a standalone .S harness for
the hot inner loop of a libnn function so we can re-run that loop in
vsim/FPGA for cycle-accurate measurement. The harness needs to enter
the loop in a state the original loop entered. Today the harness
**guesses** that state via a name-based heuristic in
`emit_harness.py:emit_live_in_init` (e.g. registers named like pointers
get `la <reg>, scratch_in`, counters get small `li`s, vectors get
zeros or `vle8` from scratch). The heuristic has a hard ceiling:

1. **Computed bounds checks** (e.g. `mulw t1,a4,a5; subw t1,t1,s9; bge a0,t1,_oob`)
   — t1 is a function of multiple input regs; no name-based
   assignment can satisfy `bge a0,t1`. The kernel exits via the OOB
   bailout on iter 1 and the harness reports a bogus cycle count.
   The recently-added warning in `run_kernel_vsim.sh` detects this
   case but cannot fix it.
2. **Stack-resident live-ins** (e.g. `c.ldsp t0,24(sp)` inside the loop)
   — heuristic doesn't initialize stack frame bytes; the load returns
   garbage and may dereference into unmapped memory.
3. **Vector-value-sensitive timing** — `nds.vd4dots` and other Andes
   vector instructions vary cycles with operand values. Heuristic
   loads scratch bytes that have nothing to do with the original.

These three failure modes collapse into **one** root cause: we don't
know the real iter-1 register/memory state, so we have to guess it.

The fix: extend the QEMU profile run we already do (via the hotblocks
plugin) to **capture the actual CPU state** the moment the loop is
first entered, dump it as a binary blob, and have `emit_harness.py`
splat that blob into registers/stack/vector regs at the start of
each measured iteration. Stop guessing; measure.

This raises the skill's coverage from ~30-40% of libnn functions
(leaf GEMM kernels, pure-dataflow ops) to ~85-90%. Memory-bound
kernels remain limited by vsim having no cache model, but that's
a sim limitation, not a skill limitation.

## Approach (4 tiers, ship T1+T2 together; T3+ as follow-ups)

### Tier 1 — GPR + stack capture (fixes #1 and #2; ~3 days)

**New plugin** `cstate.so` at
`.claude/skills/hot-inner-kernel-extractor/plugin/cstate.c`. Built
against `/local/nick/qemu_v5` headers via meson, alongside hotblocks.

We add a *new* plugin rather than extend hotblocks because hotblocks
runs unconditionally to rank hot blocks (used in step 1) and we want
state capture only in step 2 (after the hot loop_start_pc is known).
Splitting them keeps the hot-loop discovery pass cheap.

Plugin args:
- `capture_pc=0xNNNN` — guest virtual address of loop_start_pc.
- `out=path/to/state.bin` — output blob path.
- `frame_bytes=4096` — bytes of stack to capture above sp (default).

Plugin behavior (uses public API only — no private QEMU headers):
1. In `qemu_plugin_register_vcpu_init_cb`: call
   `qemu_plugin_get_registers()`, build name→handle map for
   `x0..x31`, `pc`, `vstart`, `vl`, `vtype`, `v0..v31`. Cache in TLS.
   (T1 only needs the GPR subset; T2 enables the vector entries.)
2. In `qemu_plugin_register_vcpu_tb_trans_cb`: walk insns in the TB;
   if any insn's `qemu_plugin_insn_vaddr()` equals capture_pc,
   register `qemu_plugin_register_vcpu_insn_exec_cb(insn, snap_cb,
   QEMU_PLUGIN_CB_R_REGS, NULL)`.
3. `snap_cb`: atomic-CAS one-shot guard; on first hit, read all GPRs
   via `qemu_plugin_read_register`, read sp's value, then read
   `frame_bytes` of guest memory at sp via
   `qemu_plugin_read_memory_vaddr`. Write blob, exit-callback to
   flush. Subsequent hits no-op so the kernel continues normally
   (the unit test still completes for hotblocks ranking parity).

**Blob format** (versioned, little-endian, fixed schema):
```
offset 0x000: char     magic[4]    = "CSTA"
offset 0x004: u32      version     = 1
offset 0x008: u64      capture_pc
offset 0x010: u32      xlen_bits   (64)
offset 0x014: u32      vlen_bits   (1024 on AX45MPV)
offset 0x018: u32      num_xreg    (32)
offset 0x01C: u32      num_vreg    (32, 0 on T1)
offset 0x020: u32      stack_bytes
offset 0x024: u32      reserved
offset 0x028: u32      vtype
offset 0x02C: u32      vl
offset 0x030: u32      vstart
offset 0x034: u32      _pad
offset 0x040: u64      xreg[32]            (256B)
offset 0x140: u8       vreg[32][VLEN/8]    (4096B at VLEN=1024; 0 on T1)
offset 0x140 + vsize: u8 stack[stack_bytes]
```
Captured `sp` is `xreg[2]`. The harness reads `stack_bytes` from the
blob and writes them to `[sp_target - stack_bytes .. sp_target)`,
where `sp_target` is a fresh page in the harness BSS (we don't try
to recreate the original sp address — addresses on stack-resident
live-ins are reconstructed by the loader, see "stack pointer
remapping" below).

**Wire-up in extract_kernel.sh**: after `find_hot_loop.py` produces
analysis.json with `loop_start_pc`, run a second QEMU pass:
```
qemu-...elf -plugin cstate.so,capture_pc=$LOOP_PC,out=$OUT/state.bin \
            -- ./<test binary> ...
```
Then `emit_harness.py --captured-state $OUT/state.bin ...`.

`run_hotblocks.sh` already invokes a QEMU plugin run; mirror that
script as `run_cstate.sh`. Reuse the same QEMU/binary/argv
assembly logic — extract that into `parse_config.sh` if it isn't
already shared, to avoid duplication.

**emit_harness.py changes** (`script/emit_harness.py`):

Add `--captured-state PATH` CLI flag. When set:

- Skip the heuristic init entirely. New helper
  `emit_blob_init(live_ins, blob_meta)` outputs:
  ```asm
      la t6, captured_state           # T6 holds blob base
      ld a0,   0x040+8*10(t6)         # x10 == a0; offset = 0x40 + 8*10
      ld a1,   0x040+8*11(t6)
      ...
      la sp, harness_sp_top           # synthetic stack top in BSS
      addi sp, sp, -<stack_bytes>     # carve frame
      # memcpy stack bytes from blob to [sp .. sp+stack_bytes)
      la t1, captured_state + <stack_off>
      mv t2, sp
      li t3, <stack_bytes>
  1:  ld t4, 0(t1)
      sd t4, 0(t2)
      addi t1, t1, 8
      addi t2, t2, 8
      addi t3, t3, -8
      bnez t3, 1b
  # T2 only: vsetvl + vle for live-in vector regs
  ```
  Only live-in regs are reloaded (per `analysis.json:live_in_regs`).

- `emit_blob_reset(live_ins, blob_meta)` — same as init minus the sp
  carve (sp is already correct from the first iter), called inside
  the loop. This restores live-ins to iter-1 values each iter; the
  body sees a stable starting state.

- The blob itself is embedded via:
  ```asm
  .section .rodata
      .balign 64
  captured_state:
      .incbin "<absolute path to state.bin>"
  ```
  Absolute path resolved at emit time so the assembler can find
  the file regardless of the build CWD. Path is recorded in
  analysis.json so re-emits don't re-run the plugin.

- Output: `kernel.s` (assembly) + the existing `kernel.c` wrapper.
  No changes needed to wrapper for T1/T2 — the wrapper just calls
  `extracted_kernel`, which does its own sp swap.

- Backwards compatibility: if `--captured-state` is omitted, fall
  through to today's heuristic. This preserves the current path
  for kernels where the heuristic already works (most leaf GEMM)
  and avoids a hard dependency on the new plugin.

**Stack pointer remapping**: addresses captured on the stack at
sp+8, sp+16, etc. are typically pointers into stack-resident
arrays in the *original* sp address space, but they may also point
into heap/BSS — those still resolve correctly because we don't
move them. Pure-stack pointers (rare in libnn — only padding
helpers) require an extra fixup pass; defer to T1.5 if it appears.
The detection is straightforward: if a captured stack qword falls
in `[sp_orig - frame_size, sp_orig + frame_size)`, rewrite it to
the corresponding `harness_sp` offset before sd. Skip in T1.

**Verification (T1)**:
- `conv_HWC_u8_u8_s8_sym_bias_fast` — currently fails at
  `bge a0,t1,_kpc_10de4` (t1 = stride*W - left + right). With
  T1, expect `cyc/iter` near the FPGA-measured value (within 5%).
- A leaf GEMM kernel that already worked with heuristic
  (`nn_mat_mul_kernel_s8_s8_s8_unroll4`) — must still produce
  the same cycles (regression check).
- A function with stack live-ins — pick by `grep` for
  `c.ldsp.*(sp)` inside an extracted loop body across libnn
  test set; if none found, document T1 as un-stressed for #2 and
  defer #2 verification to whichever real kernel hits it next.

### Tier 2 — Vector regfile + vtype/vl capture (fixes #3; ~1.5 days)

Same plugin, just enables the `v0..v31`+`vtype`+`vl`+`vstart`
captures. Confirmed in `qemu-plugin.h`:868-932 — the API exposes
all visible regs uniformly via `qemu_plugin_get_registers()`. RISC-V
target-side: vector regs ARE included when V is enabled (verified
by inspection of `target/riscv/translate.c` in QEMU's tree; if it
turns out they aren't, fall back to a GDB-attached snapshot — see
"Risks" below).

emit_harness.py changes:
- After scalar restore, emit:
  ```asm
      lw t0, 0x028(t6)             # vtype
      lw t1, 0x02c(t6)             # vl
      vsetvl x0, t1, t0            # restore vtype/vl
      la t2, captured_state + 0x140
      vle8.v v0, (t2); addi t2, t2, <vbytes>
      ...                          # 32 vle8.v's, one per live-in vreg
  ```
  Only live-in vregs are loaded (per analysis.json).
- `emit_blob_reset` re-issues the vle8.v's for live-in vregs.

**Verification (T2)**:
- A vd4dots-using kernel — measure cycles with T1 only (vectors
  zero), then with T2 (real vectors). Compare to FPGA. T2 should
  match closer.

### Tier 3 — Top-K harnesses for multi-loop functions (~1 day)

Functions with multiple hot loops (e.g., `softmax_s16` with both
exp and norm passes) currently produce one harness for the
single hottest block. Extract the top K=3 hotblocks from
`hotblocks.so` output (already ranked by ecount), and emit one
harness per loop into `work/<fn>/loop_<i>/`. The aggregator
produces a stacked-bar report.

### Tier 4 — Cycle-weighted hotblock ranking (~0.5 day)

hotblocks.so ranks by `ecount`; for vector kernels, ranking by
`ecount * vector_icount` better correlates with cycle share. Add
a static cost model in find_hot_loop.py that classifies each
insn (scalar=1, vle/vse=4, vmacc/vd4dots=8, etc.) and weights
ecount accordingly when picking the "hottest" loop. Pure
heuristic; requires no plugin change.

### Tier 5 — Optional: link libnn.a for in-loop calls

If a hot loop contains a `jal/jalr` to a non-inlined helper, the
harness can't resolve the symbol today. Add an `--link-libnn`
flag that links the harness against the just-built libnn.a.
Risk: pulls in toolchain runtime; defer until a real case
appears.

## Critical files

- `.claude/skills/hot-inner-kernel-extractor/plugin/cstate.c` — **new**
- `.claude/skills/hot-inner-kernel-extractor/plugin/Makefile` or
  `meson.build` — **new** (mirror QEMU's `contrib/plugins/`)
- `.claude/skills/hot-inner-kernel-extractor/script/run_cstate.sh` — **new**
- `.claude/skills/hot-inner-kernel-extractor/script/extract_kernel.sh` —
  add cstate step between find_hot_loop.py and emit_harness.py
- `.claude/skills/hot-inner-kernel-extractor/script/emit_harness.py` —
  - new `emit_blob_init`/`emit_blob_reset` helpers
  - new `--captured-state` flag
  - emit `.incbin` and blob loader in standalone/fpga/vsim paths
  - keep heuristic as fallback when flag absent
- `.claude/skills/hot-inner-kernel-extractor/script/find_hot_loop.py` —
  carry `captured_state` path through analysis.json (one new field;
  no behavior change)
- `.claude/skills/hot-inner-kernel-extractor/script/run_kernel_vsim.sh` —
  the existing early-exit warning still fires if blob is wrong;
  add a one-line check that captured_state.bin exists when
  `--captured-state` was used to emit
- `.claude/skills/hot-inner-kernel-extractor/SKILL.md` — document
  the new flow (heuristic → captured-state) and the fallback
- `.claude/skills/hot-inner-kernel-extractor/config.toml` — add
  `[cstate]` section: `plugin_path`, `default_frame_bytes`

## Existing utilities to reuse

- `parse_config.sh` — already centralizes paths; add `CFG_CSTATE_PLUGIN`,
  `CFG_CSTATE_FRAME_BYTES` here so the new run script picks them up.
- `find_hot_loop.py:compute_live_ins` (lines 401-416) and
  `collect_producers` (lines 419-434) — unchanged; we still need
  the live-in set to know *which* registers in the blob to splat.
  We just no longer need `live_in_producers` (the prologue subset)
  for emission — keep producing it for analysis.md readability.
- `emit_harness.py:emit_loop_body` (lines 247-297) — unchanged. The
  body extraction and branch-rewriting logic is independent of how
  init happens.
- The existing vector-init code path in `emit_live_in_init`
  (lines 161-189) — keep intact as the heuristic fallback;
  blob path is parallel.

## Verification

End-to-end checks, in order:

1. **Plugin builds**: `meson compile cstate` from build dir produces
   `cstate.so`. Smoke: `qemu-... -plugin cstate.so,capture_pc=0x10000,out=/tmp/x.bin -- /bin/true` should produce a (small, garbage-PC-never-hit) empty blob and not segfault.

2. **State capture round-trip**: pick a tiny C program that
   prints register values from a known PC; load with
   `cstate.so,capture_pc=<that PC>`; diff captured blob against
   the program's printed values. Must match bit-for-bit.

3. **T1 regression**: rerun
   `nn_mat_mul_kernel_s8_s8_s8_unroll4` with `--captured-state`.
   vsim cyc/iter must match the prior heuristic-mode result
   within 1% (otherwise the blob loader is corrupting state).

4. **T1 fix**: `conv_HWC_u8_u8_s8_sym_bias_fast` with
   `--captured-state`. Expected: vsim cyc/iter > body_size/2,
   no early-exit warning. Sanity-check against FPGA cycles
   from `test_perf.sh ax45mpv ... conv_HWC_u8_u8_s8_sym_bias_fast`
   on the AX45MPV board (within 5% — vsim has no cache, FPGA
   does, but for a compute-bound conv the difference is small).

5. **T2**: pick a kernel using `nds.vd4dots` (known
   value-dependent). Compare T1-only cycles vs T1+T2 cycles vs
   FPGA. T2 should be closer.

6. **Backward compat**: rerun the existing skill test set
   (~5 functions that work today) without `--captured-state`.
   Output must be byte-identical to before this change.

## Risks and mitigations

- **Risk**: QEMU 9.2 RISC-V target may not expose vector regs
  through the public plugin API. *Mitigation*: write a minimal
  test program in step 2 above that vle.v's a known pattern;
  ship T1 even if T2 turns out to need a different mechanism.
  Fallback for T2: attach GDB at the first-hit breakpoint and
  scrape `info reg vlenb v0..v31` — slower but works through
  any QEMU version.

- **Risk**: capture_pc fires more than once before the loop
  becomes "warm" (TB invalidated, retranslated, hit again).
  *Mitigation*: atomic CAS one-shot guard in snap_cb. After
  first hit, mutate the registered callback to a no-op and
  rely on TB regeneration to skip it. Verified pattern in
  QEMU's own `cache.c` plugin.

- **Risk**: stack-resident pointers point into the original
  sp's address space, become invalid when we relocate sp.
  *Mitigation*: defer per "stack pointer remapping" note;
  fix when first kernel hits it (none in our current test
  set).

- **Risk**: blob bloat at VLEN=1024 (4KB vector + 4KB stack +
  256B GPR ≈ 8KB per kernel). *Mitigation*: trivial — these
  are .rodata in a test harness, not a deployed binary. No
  action needed.

- **Risk**: `.incbin` path resolution under different build
  CWDs. *Mitigation*: emit absolute path. Verified GAS
  supports this.

## Out of scope

- Mask-driven loops where iter-N control path differs from
  iter-1 (rare in libnn). Captured state pins iter-1; iter-N
  can diverge if a vector mask flips. Living with this.
- Memory-system-bound kernels (cache effects). vsim has no
  cache model; this is a sim limitation, not a skill one.
  FPGA fallback remains the right answer for those.
- Multithreaded kernels — libnn is single-threaded; no plan.
