# Plan: run all 7 demos on one RVV-intrinsic GEMM workload

## Context

The demos under `tests/demos/` (T1..T7) today use a mix of fixtures: 4 use the
marked V fixture `rt_c_v_regs`, 3 use the CSR-less spin loop `icount_spin`. The
user wants every demo to showcase its switching mechanism on the SAME recognizable
RVV GEMM, so the demo suite reads as "one workload, seven ways to switch."

An RVV-intrinsic GEMM fixture already exists and builds:
`tests/fixtures/rt_c_v_matmul.c` (16x16x16 outer-product GEMM using
`__riscv_vle32` / `__riscv_vmacc_vx` / `__riscv_vse32`). We reuse it.

### Hard constraint that shapes the design (verified in code)

`qemu_plugin/hybrid_handoff.c:471-485`: in icount/slice/bbv modes the default CSR
matcher is STILL registered (only `pc_mode` `continue`s past it, line 468). So any
workload that contains `csrwi 0x7C0,0` drains AT the marker and `exit(200)`s before
a count target inside the kernel is ever reached. Therefore the count/profile demos
need a marker-free workload.

User decisions:
1. Use a preprocessor macro to enable/disable the markers, building the SAME source
   twice (one marked ELF, one markerless ELF). "Same GEMM code" = identical kernel.
2. Use FIXED count constants (no runtime self-calibration). Size the markerless GEMM
   long enough (compile-time repeat) that fixed targets land inside the kernel.

### Two findings confirmed by reading/probing the built artifacts

- `nm -n rt_c_v_matmul.elf` shows only `main`, `_hybrid_enter_pc`, `_hybrid_exit_pc`.
  At `-O1` the kernel is inlined into `main`, so a PC-range assertion has no
  `vmatmul_kernel` symbol to anchor on. Fix: mark the kernel `noinline` (also keeps
  it anchored in the ROI per `runtime/rt_c_helpers.h:49-51`).
- Orchestrator CSR-drain path is marker-driven: `tools/orchestrator/spawn.py:33`
  passes the plugin only `outfile=...`; `tools/orchestrator/checkpoint.py:237` sets
  replay `trigger_kind="csr"`. So T6 (archive) and T7 (simpoint replay) genuinely
  depend on the in-binary markers -> they must use the MARKED build.

## Fixture mapping after the change

| Demo | Mode    | Build       | ELF                      |
|------|---------|-------------|--------------------------|
| T1   | csr     | MARKED      | rt_c_v_matmul.elf        |
| T2   | pc      | MARKED      | rt_c_v_matmul.elf        |
| T3   | icount  | MARKERLESS  | rt_c_v_matmul_free.elf   |
| T4   | bbv     | MARKERLESS  | rt_c_v_matmul_free.elf   |
| T5   | slice   | MARKERLESS  | rt_c_v_matmul_free.elf   |
| T6   | archive | MARKED      | rt_c_v_matmul.elf        |
| T7   | simpoint| MARKED      | rt_c_v_matmul.elf        |

Both ELFs come from the one source `rt_c_v_matmul.c`; only the 2 marker calls and
the repeat count differ via `-D` flags. T7 keeps its current behavior: its small
slice/icount targets profile the crt0+init prefix BEFORE the enter marker (same
regime as today's `rt_c_v_regs`); the kernel runs in the M7 vsim replay leg.

## Changes (TDD order: RED first, then GREEN)

### Step 1 - `tests/fixtures/rt_c_v_matmul.c` (source: macro + noinline + repeat)
Behavior-preserving for the marked build (repeat defaults to 1).
- After `#define N 16`:
  ```c
  #ifndef GEMM_REPEAT
  #define GEMM_REPEAT 1
  #endif
  ```
- Mark the kernel noinline (so it is a real `nm`/`readelf` symbol and stays in ROI):
  ```c
  __attribute__((noinline)) static void vmatmul_kernel(void)
  ```
- In `main`, guard the markers and wrap the kernel in the repeat loop:
  ```c
  init_matrices();
  #ifndef HYBRID_MARKERLESS
    enter_vsim();
  #endif
    for (int rep = 0; rep < GEMM_REPEAT; rep++)
      vmatmul_kernel();          /* idempotent: vacc re-seeded to 0 each outer iter */
  #ifndef HYBRID_MARKERLESS
    exit_vsim();
  #endif
  ```
  Phase-2 syscall-free rule intact; phase-3 verify unchanged.

### Step 2 - `tests/fixtures/Makefile` (markerless twin)
The existing `$(RT_C_V_FIXTURES:%=%.elf)` rule is pattern-based; the `_free` ELF is a
different preprocessor view of the same `.c`, so it needs an explicit rule.
- Add near CFLAGS: `GEMM_REPEAT_FREE ?= 200`  (~260k+ kernel insns vs 10k targets).
- Add explicit target (reuses RT_C_V_CFLAGS / RT_C_LIBS / RUNTIME_SRCS / test.ld):
  ```make
  rt_c_v_matmul_free.elf: rt_c_v_matmul.c $(RUNTIME_SRCS) test.ld $(RUNTIME_DIR)/rt_c_helpers.h
  	$(CC) $(RT_C_V_CFLAGS) -DHYBRID_MARKERLESS -DGEMM_REPEAT=$(GEMM_REPEAT_FREE) \
  	  -T test.ld $(RUNTIME_SRCS) rt_c_v_matmul.c $(RT_C_LIBS) -o $@
  ```
- Append `rt_c_v_matmul_free.elf` to the `all` target and to `clean`.
- Do NOT add it to `RT_C_V_FIXTURES` (the pattern rule would seek a nonexistent
  `rt_c_v_matmul_free.c`). It is an internal twin; document it in USER_GUIDE.

### Step 3 - count/profile demos (MARKERLESS)
Portable kernel-range helper (resolve `vmatmul_kernel` addr+size via `readelf -sW`,
toolchain at `$HYBRID_TOOLCHAIN/bin/...`, fall back to bare name). `read_u64`
already returns decimal; compare decimals:
```sh
RE="${HYBRID_TOOLCHAIN:+$HYBRID_TOOLCHAIN/bin/riscv64-unknown-elf-readelf}"; RE="${RE:-riscv64-unknown-elf-readelf}"
read KLO KSZ < <("$RE" -sW "$VSIM_ELF" | awk '$8=="vmatmul_kernel"{print strtonum("0x"$2), $3; exit}')
{ [ -n "${KLO:-}" ] && [ -n "${KSZ:-}" ]; } || { echo "FAIL: vmatmul_kernel not found"; exit 1; }
pc_in_kernel() { awk -v p="$1" -v lo="$KLO" -v sz="$KSZ" 'BEGIN{exit !(p>=lo && p<lo+sz)}'; }
```
- **T3 `demo_icount_roundtrip.sh`**: default `FIXTURE=rt_c_v_matmul_free`; keep
  QEMU_ICOUNT=10000 / VSIM_ICOUNT=5000 (confirm they fit in the one-time probe).
  Replace BOTH `pc in {0x100002,0x100004}` checks with `pc_in_kernel`. Wire the
  shared mmap into the vsim leg too (`--shared-mem-path/-size/-base 0x0`, mirroring
  `tests/e2e.sh:99-101`) so the GEMM .bss from QEMU1 survives into vsim. Update header.
- **T5 `demo_slice_consume_roundtrip.sh`**: default `FIXTURE=rt_c_v_matmul_free`;
  keep SLICE=1000 / SLICE_AT=1 / VSIM_ICOUNT=5000; keep the slice-boundary log
  assertion; replace both pc checks with `pc_in_kernel`; add vsim shared-mem flags;
  update header.
- **T4 `demo_bbv_profile.sh`**: default `FIXTURE=rt_c_v_matmul_free`; keep
  SLICE=1000 / ICOUNT=10000 (EXPECTED_ROWS=10 is fixture-independent); rename the
  `.bb` artifact label cosmetically; confirm `simpoint` exits 0 on the GEMM BBV.

### Step 4 - marker-driven demos (MARKED)
- **T1 `demo_csr_oneshot.sh`** / **T2 `demo_pc_oneshot.sh`**: swap
  `FIXTURE=rt_c_v_regs` -> `rt_c_v_matmul`; update the echo line; set `TIMEOUT=120`
  (heavier vsim leg).
- **T6 `demo_archive_replay.sh`**: swap in all 3 places - `FIXTURE` default,
  the `echo "Fixture: ..."`, and the YAML literal `elf: tests/fixtures/...elf`.
  Keep `trigger.kind: csr`.
- **T7 `demo_simpoint_loop.sh`**: swap `FIXTURE` default + comments; `elf_path`
  derives from `VSIM_ELF` (auto). Re-verify the M4 BBV row count lands before the
  enter marker; retune SLICE / PROFILE_ICOUNT (env-tunable) if init lengthened the
  prefix. M7 replay (csr) unchanged.

### Step 5 - docs (project rule: update on behavior change)
- `docs/USER_GUIDE.md`: M1/M3/M4/M5/M6/T7 examples -> new fixtures + TIMEOUT;
  replace "two RVC insns at 0x100002/0x100004" prose with the kernel-range check;
  add a note on the marked vs markerless twin.
- `docs/switching_modes_tutorial.md`: same example/fixture updates.
- Per-demo header comments updated inline in Steps 3-4.

## Critical files
- `tests/fixtures/rt_c_v_matmul.c`
- `tests/fixtures/Makefile`
- `tests/demos/demo_icount_roundtrip.sh`, `demo_slice_consume_roundtrip.sh`,
  `demo_bbv_profile.sh`, `demo_csr_oneshot.sh`, `demo_pc_oneshot.sh`,
  `demo_archive_replay.sh`, `demo_simpoint_loop.sh`
- `docs/USER_GUIDE.md`, `docs/switching_modes_tutorial.md`

## Verification
1. `make -C tests/fixtures rt_c_v_matmul.elf rt_c_v_matmul_free.elf` (GREEN build).
2. One-time probe on the markerless ELF: `drain_at_exit=1` for the true total; sweep
   `icount=` reading pc@byte16 to find the kernel window. Confirm 10000/5000 fit.
3. `nm -n rt_c_v_matmul_free.elf | grep vmatmul_kernel` exists (noinline worked).
4. Per demo: `./hsim demo T1` .. `./hsim demo T7` (or `bash tests/demos/demo_*.sh`)
   all pass. T2 still resolves `_hybrid_enter_pc/_hybrid_exit_pc` (noinline-safe).
5. Aggregate: `bash tests/fixtures/demo.sh` (T1..T7 tally).

## Risks
- noinline changes the MARKED ELF layout: csr (opcode) and pc (symbol-name) triggers
  are both layout-agnostic; verify T2 anyway.
- Fixed-target overshoot if GEMM_REPEAT_FREE too small: the kernel-range assertion
  fails loudly (safe RED). REPEAT=200 gives ~26x margin.
- T4 BBV may be a single hot block -> simpoint may find 1 cluster; T4 asserts
  non-empty simpts (not K=2), so likely fine; confirm exit 0.
- T7 prefix drift: matmul `init_matrices` may change the M4 row count vs rt_c_v_regs;
  retune SLICE/PROFILE_ICOUNT (env-tunable). T7's profile/slice cover the startup
  prefix, not the kernel proper (pre-existing behavior, documented, out of scope to
  change here).
