# andesim --print-memmap: audit + implementation plan

## Context

User request: add `--print-memmap` to andesim printing the memory map regions
supported in HYBRID mode. vsim has its own `--print-memmap`; user doubts its
correctness and it is not plumbed through andesim. Deliverables: (1) audit of
vsim's --print-memmap correctness, (2) design + implementation plan for the
andesim feature, with closed-loop verification.

## Part 1 - Audit verdict on vsim --print-memmap (VERIFIED, ran the binary)

Architecture is sound: `main.cpp:461` dumps the LIVE interconnect routing
table (`interconnect.hpp:176 dump_region()`), not a hardcoded list. But:

CONFIRMED BUGS (empirically, sim_ax45mpv_premium a4a4d13):
1. PRINT: every size is +1. `MemoryRegion.end_address` is exclusive
   (memory_region.hpp:28-29) yet dump prints `end - base + 1`
   (interconnect.hpp:182). e.g. UART prints `size: 0x100001`.
2. PRINT: upper bound printed is the EXCLUSIVE end but reads as inclusive
   (`uart2: [0xf0300000-0xf0400000]`; 0xf0400000 is not decoded).
3. DECODE BUG (worst): HVM aperture bound as
   `NDS_HVM_BASE + NDS_HVM_SIZE_KB * 0x1000 - 1` (simulator.hpp:162-173).
   KB needs *0x400; *0x1000 makes the window 4x too big: config 256 KiB,
   decoded+printed 1 MiB [0x90000000-0x90100000). QEMU maps 256 KiB
   (hvm_size_pow_2=18), so [0x90040000,0x90100000) DIVERGES between engines.
   Same engine's --describe says hvm_size=262144 - vsim self-contradicts.
4. SEMANTICS: ILM/DLM shown as ONE 4 MiB slave-port aperture
   [0xa0000000-0xa0400000) (simulator.hpp:180-184, memory_map.h) hiding real
   ILM=64K/DLM=32K. Reader infers 2M/2M.
5. Standalone RAM row is [0x0-0x90000000) = 2.25 GiB default window - not the
   hybrid window (hybrid = --shared-mem-size, driver-set), and it covers
   QEMU's MROM@0x80000000 + NOR@0x88000000 range. Printed map != hybrid truth.
6. Reserved PLDM row [0xe6800000) indistinguishable from routable targets.
7. RAM alias row [0x8_00000000) unreachable on these cores
   (NDS_BIU_ADDR_WIDTH=32) - phantom.
8. By definition vsim-only: cannot answer "what does HYBRID support" (QEMU
   side absent: PLIC/PLMT/PLICSW/MROM/virtio... are QEMU-only regions).

andesim today: ZERO memmap support (repo-wide grep). Driver owns no map;
bases live in plugin defaults + fixture header; --describe has sizes only.

## Part 2 - The hybrid memory map (ground truth established)

Per-engine map = driver RAM math + engine geometry + platform constants:

| Region | Base..End(incl) | Phases | Content transport |
|---|---|---|---|
| DRAM (program RAM) | 0x0 .. mem_size-1 | both | shared mmap (survives) |
| V-scratch page (reserved) | mem_size .. +0xFFF | hybrid transport | reserved, ELF-fit-checked |
| ILM overlay (when milmb.IEN) | ilm_base=0x0 .. +64K | both | sidecar .ilm (if backdoor) |
| DLM overlay | dlm_base=0x200000 .. +32K | both | sidecar .dlm (if backdoor) |
| HVM | 0x90000000 .. +256K | both | sidecar .hvm (if backdoor) |
| LM slave-port window | 0xa0000000 .. 0xa03fffff | both | transport path (QEMU subport / vsim slv_bfm) |
| SimControl/HTIF | 0xe0080000 .. +0xFFF | both | device, state does NOT cross |
| UART2 (console) | 0xf0300000 .. +1M-1 | both | device, state does NOT cross |
| UART1 | 0xf0200000 .. +1M-1 | both | device, state does NOT cross |
| SMU | 0xf0100000 .. +1M-1 | both | device, state does NOT cross |
| L2C reg window | 0xe0500000 .. +1M-1 | both (engine L2C-gated) | restored subset via PB |
| PLDM (debug module) | 0xe6800000 .. +0xFFF | vsim reserved | do not touch |
| MROM/NOR/PLIC/PLMT/PLICSW/PIT/WDT/RTC/DMAC/SDC/MAC/BMC/virtio/DTROM/stubs | (various) | QEMU-only | engine-divergent, unsafe in ROI |

Geometry sources at runtime (NO new duplication):
- RAM window/V-scratch: existing driver math (cmd_run.cpp:416-431, shm.cpp:86-94, mmap_base run_plan.hpp:27).
- ILM/DLM/HVM bases+sizes: parse the staged qemu.cfg the driver ALREADY
  generates from engine `--print-qemu-config` (run_plan.cpp:46-54; verified it
  emits ilm_base/dlm_base/ilm_size/dlm_size/enables/hvm_base/hvm_size_pow_2).
- Transportability: EngineDescriptor ilm/dlm/hvm_size (backdoor-gated).
- Platform constants (devices + slave window + QEMU-only list): ONE new static
  table in driver/memmap.hpp, provenance-commented (andes_ae350.c:69-133 +
  vsim memory_map.h), drift-guarded by the contract test below.

## Part 3 - Implementation (TDD)

Stage A (RED->GREEN, driver unit level):
- New driver/memmap_test.cpp (doctest, mirrors plan_test.cpp registration in
  driver/CMakeLists.txt -> binary build/driver/andesim-memmap-test): failing
  tests first for compose_memmap(descriptor, qemu_cfg_text, mem_size):
  region set, availability tags, transport tags, inclusive-end arithmetic,
  zero-size (advanced-like) engines dropping sidecar rows, V-scratch row.
- driver/memmap.hpp/.cpp: MemRegion{name,base,end,phases,transport,note},
  compose + render (text table).
- CLI: bool run flag `--print-memmap` (cli.cpp bool branch like --dry-run
  cli.cpp:52; Cli field; kRunOpts row main.cpp:82). cmd_run: after plan/ctx
  build (qemu.cfg staged), print table + exit 0 (no spawn). ELF optional:
  when present, annotate fit vs scratch (reuse elf_load_top). Update
  tests/andes_sim/test_andes_sim_release_surface.sh help-tree assertion.

Stage B (contract + e2e, shell):
- tests/andes_sim/test_andes_sim_print_memmap.sh, 3 layers like
  test_andes_sim_print_qemu_config.sh:
  1. unit binary run;
  2. engine contract (SKIP if no engine): run `sim_* --print-memmap`, parse,
     cross-check every vsim-phase region in the driver table appears in the
     engine dump (base exact; size tolerant of the known +1 until vsim fix);
  3. driver e2e: `andesim run --mode hybrid --print-memmap --engine ... elf`
     greps key rows (DRAM row reflects --mem-size, V-scratch row, UART2 row).

Stage C (vsim repo fixes - separate repo, separate commits; each RED first
in vsim's test setup):
- Fix dump_region: print inclusive end + true size; tag reserved rows
  "(reserved)". (behavioral commit + its unit test)
- Fix HVM aperture scaling *0x1000 -> *0x400 (real decode bug; regression
  test; then re-run hybrid f4/hvm e2e).
- Optional follow-ups (report only, not in scope): 4M slave aperture
  annotation, RAM-alias gating by BIU width.

Stage D (docs):
- docs/USER_GUIDE.md: new `### 2.6 Guest memory map & --print-memmap`
  (next to 2.3 plugin-bases + 2.5 mem-size window); README quickstart line.
- ROADMAP.md: record under F-PROD-05 adjacent surface.

## Verification
- All stage-A unit tests green (build/driver/andesim-memmap-test).
- bash tests/andes_sim/test_andes_sim_print_memmap.sh green with real engine.
- tests/andes_sim/test_andes_sim_release_surface.sh green.
- After vsim Stage C: vsim unit tests + JOBS=8 bash scripts/run_e2e.sh green
  (HVM path exercised by f4/hvm tests).
- Manual: `./andesim run --mode hybrid --print-memmap --engine
  verilator:ax45mpv_premium tests/fixtures/handoff_roundtrip.elf` and diff
  eyeball vs `sim_ax45mpv_premium --print-memmap`.

## Decisions (PM was away; defaults taken, all revisitable)
1. CLI shape: `run --print-memmap` flag (prints the effective map of exactly
   the run you asked for, then exits; --dry-run family).
2. Mode scope: hybrid-only MVP (`--mode fast|cycle` + --print-memmap errors
   with a clear "hybrid only for now" message).
3. vsim fixes: in scope, in the hybrid_vsim repo, separate commits, each with
   a failing test first (dump_region display fix; HVM *0x1000 -> *0x400).
4. Output: text table only (columns REGION/BASE/END incl./SIZE/PHASES/
   TRANSPORT/NOTE). JSON deferred.
