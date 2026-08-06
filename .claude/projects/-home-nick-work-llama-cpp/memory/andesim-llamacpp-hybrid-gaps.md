---
name: andesim-llamacpp-hybrid-gaps
description: "llama.cpp on andesim hybrid: WORKING via vlinux runtime + marker-mode ROI on Bonsai-4B (K=51 cycle baselines); remaining caps (2GiB RAM, ELEN=32 patch set for premium) and engine build matrix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 047fa35b-69c2-4ca4-8695-5347e3e7a746
  modified: 2026-08-06T06:47:51.401Z
---

Updated 2026-07-21 (originally 2026-07-15). Target switched Bonsai-27B -> Bonsai-4B-Q1_0 (572 MB): fits the 2 GiB cap, plain qwen3 (no qwen35 rv64 bug), and the full flow is CONFIRMED on it. Canonical recipe doc: /home/nick/work/andesim/docs/llama_roi_howto.md; roadmap: llama.cpp/opt_roadmap.md.

**State: WORKING end to end (2026-07-16, re-verified run started 2026-07-21)**
- `andesim run --mode hybrid --trigger marker --runtime linux --mem-size 2000M --engine vsim:<e> --step-timeout-ms <big> build-rv64-static/bin/llama-completion -- -m models/Bonsai-4B-Q1_0.gguf -no-cnv --prompt "The capital of France is" -n 32 -c 512 -t 1`
- ROI = MUL_MAT node K counted in ggml_compute_forward (patch in llama.cpp working tree, gated on -DANDESIM_ROI_MUL_MAT_K, HINT NOPs). K=51 = layer 7 V projection (2560x1024, smallest matmul; 4B has 253 MUL_MAT/token = 36x7+1). ANDESIM_ROI_MUL_MAT_N for K..K+N-1.
- Baselines: ax45mpv_premium 6528953 cycles; fpga_l3 4476168; N=2 (V+K proj) 13040043 on premium. Repeat-stable.
- Nothing executes after ROI end (no handback); vsim ~9 kHz -> K=51 is ~13 min wall on premium, needs --step-timeout-ms 14400000 on fpga_l3 (900000 not enough). --kanata works (651 MB trace for K=51).

**The old "cannot compile" blocker is GONE**: solved by `--runtime linux` (vlinux) + Andes Linux glibc toolchain (config.env LINUX_TOOLCHAIN=/local/nick/SW_Release/build-ast542/build-toolchain/linux/nds64le-linux-glibc-v5d), static link. The bare-metal newlib no-gthreads facts below only apply to the vplat runtime path. llama.cpp needs common/log.cpp synchronous-fallback patch (worker thread creation fails on vlinux; in working tree, uncommitted).

**llama.cpp working-tree mods (uncommitted, needed for this flow)**: ggml-cpu.c ROI marker patch; ggml-cpu/CMakeLists.txt GGML_RV_MARCH_LETTERS/GGML_RV_ZC_EXTRA vars; common/log.cpp sync logging.

**Engine build matrix (build-rv64-static)**
- Common: -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_RV_ZFH=OFF -DGGML_RV_ZVFH=OFF -DGGML_CPU_REPACK=OFF (stock repack uses vsseg4e64), C/CXX flags: -mext-zvlsseg -DANDESIM_ROI_MUL_MAT_K=51 -I <andesim>/build/runtime/include
- vsim:ax46mpv_fpga_l3 (ELEN=64 VLEN=1024, real L3): pristine ggml + -DGGML_RV_MARCH_LETTERS=g -DGGML_RV_ZC_EXTRA=zca_zcb_zcmp_zcmt (has Zca/Zcmp/Zcmt NOT Zcd; default 'gc' march emits illegal c.fsdsp). CURRENT build-rv64-static config.
- vsim:ax45mpv_premium (ELEN=32 VLEN=512, no zfh/zvfh): default march BUT needs 3 e64-removal ggml patches (llama_roi_howto.md section 4: vec.cpp f16/bf16 `target("arch=rv64gc")` attr; cvar/softmax f32-reduce rewrite; quantize_row_q8_0/1 -> _ref). NOT in tree today - re-apply before premium builds. Premium FP datapath also rejects LMUL=8 float ops (int m8 fine).
- **DECISION 2026-07-23 (user): product premium = ELEN 64** -> canonical premium engine is sim_ax45mpv_premium_max (ELEN/FELEN 64, packed FP16, 32K D$; probe 15/15 ok). On it the 3 e64-removal patches are OBSOLETE and full-V march works; ELEN32 constraints only matter if premium_full ever comes back.
- Engines are external prebuilts now: QEMU_BIN_DIR=/home/nick/work/qemu_andesim/build/qemu, VSIM_BIN_DIR=/home/nick/work/vsim_andesim/build (sim_ax45mpv_premium, sim_ax46mpv_fpga_l3, ...).

**Bonsai-8B WORKS on hybrid AND fast (2026-07-29)** - models/Bonsai-8B-Q1_0.gguf
(1158654496 B, byte-size-identical to HF prism-ml/Bonsai-8B-gguf, already local).
qwen3, 36 layers (same as 4B), n_embd 4096, n_head_kv 8. Two flags that are NOT
in build.sh/measure.sh/verify.sh defaults and are both mandatory:
- **`--no-mmap`**: without it the load dies at 54s with `ggml_aligned_malloc:
  insufficient memory (attempted to allocate 931.50 MB)` /
  `failed to allocate CPU_REPACK buffer of size 976748544`. Root cause: on RISC-V
  the Q1_0 repack buft ACCEPTS these tensors (on x86 it is rejected -> mmap only),
  so the 1099 MiB file mapping AND the 931 MiB CPU_REPACK buffer are both resident
  = 2030 MiB > the 2 GiB window. vlinux implements mmap (only ENOSYS 258
  riscv_hwprobe / 435 clone3 / 220 clone), so the mapping really costs guest RAM.
  With --no-mmap: 931 (repack) + ~168 (rest) + 72 (KV @ -c 512) + 312 (compute @
  n_batch 2048) = ~1484 MiB, fits. Further headroom if ever needed: -b 512, -c 256.
- **`--mem-size 2097148K`** = the exact hybrid max (2 GiB - HYBRID_V_SCRATCH_BYTES,
  = 32*128 = 4096 B; include/hybrid/state_abi.h:73,80 + driver/shm.cpp:90).
  hybrid REJECTS `2G` with "exceeds the AE350 DRAM window" - it does not silently
  cap. fast mode accepts `2G` because it goes straight to QEMU `-m` (main.cpp:78),
  so the two modes have DIFFERENT --mem-size rules.
8B hybrid FULL CHAIN (2026-08-04, fpga_l3, K=51 = blk.7.attn_v.weight
[4096 x 1024] nrows=2, logs /home/nick/tmp/8b-runs/): pristine 7,278,168 ->
repack 3,475,147 (2.09x) -> +prefetch 2,218,540 (3.28x) -> d4/F9 648,246
(**11.23x**). Repack and prefetch stages scale per-element 1:1 from 4B
(prefetch 0.264 cyc/elem/act, inside the 0.261-0.265 invariant band); d4 is
the only stage that degrades: 0.155 vs 0.138 cyc/elem on 4B (~12%), so 8B
total is 11.23x vs 4B 12.34x - "decode purely issue-bound" starts to crack
at K=4096 (unverified why; more weight bytes streamed per row).
Exit codes: a SUCCESSFUL fast-mode run returns **2** (the generic vlinux exit trap
at RAM-top; mepc tracks --mem-size: 0x7cfffdc2 at 2000M, 0x7ffffdd2 at 2G). hybrid
returns 0 because nothing runs after the ROI. So exit code is NOT a success signal
in either mode - grep the output. Wall clock: 8B fast mode 8 tokens = ~23 min.

**BIU/L3C address width widened to 39 on ax46mpv_fpga_l3, 2026-07-29 - and it is
TIMING-NEUTRAL.** Motivation: reaching QEMU's DRAM_EXT window needs >32-bit
physical addresses (see the andesim ROADMAP_LINUX_RUNTIME.md U10 rewrite).
- `data/configs/ax46mpv_fpga_l3.cfg`: `NDS_BIU_ADDR_WIDTH` and
  `NDS_L3C_ADDR_WIDTH` 32 -> 39, rebuilt via `./build_vsim.sh` (incremental:
  only this engine re-verilates, the other 6 configs are untouched so ninja
  skips them). Old binary preserved as
  `build/sim_ax46mpv_fpga_l3.biu32-backup`.
- Value RULES (`external/ax46mpv_advanced/config_tools/nds-softcore-config`):
  :6435 `NDS_L3C_ADDR_WIDTH value {32 37 38 39 52 59 64}` is an ENUM - 36 is
  rejected ("ERROR: 36 is not a valid option value of L3-Cache Address Width");
  :4363-4368 `NDS_BIU_ADDR_WIDTH` is free `textinput` 32-64, tool default 39.
- The config tool AUTO-WIDENS 6 dependent widths (all +7): STLB_RAM_DW 60->67,
  STLB_DATA_RAM_DW 30->37, ICACHE_TAG_RAM_DW 30->37, DCACHE_TAG_RAM_DW 32->39,
  CM_SNP_RAM_DW 21->28, L3C_TAG_RAM_DW 18->25. So NEVER hand-patch config.inc
  or a single cfg line - narrow TLB/cache tags would silently truncate
  addresses. Always regenerate (the standalone step is
  `NDS_HOME=<tree> tclsh <tree>/config_tools/nds-softcore-config --load <cfg> --generate`).
- **TIMING NEUTRAL, PROVEN**: same bin-prefetch, 4B K=51 node, BIU=39 engine
  1,384,130 cycles vs BIU=32 backup engine 1,384,130 - bit-identical, not
  "close". Expected: tag-RAM WIDTH does not change cache sets/ways or TLB entry
  count. Controlled A/B done by staging the backup in its own dir and pointing
  `VSIM_BIN_DIR` at it (driver/engine_registry.cpp:186 honours that env).
  Consequence: every cycle number recorded on the old engine stays comparable.
- STILL UNVERIFIED: whether the widened core actually ISSUES a >32-bit address.
  `--print-memmap` CANNOT answer it - it prints the SystemC/TLM region table and
  happily accepted `--shared-mem-base 0x800000000` even on the BIU=32 engine
  (identical output before and after the rebuild). A real load/store up there
  needs vlinux to place its arenas at a non-zero ram_base = roadmap U10d, so
  U10f's "does the RTL address it" gate is BLOCKED ON U10d, not only on the
  engine rebuild.

**27B UNLOCKED (2026-08-05)**: U10b/U10e/U10f DONE (committed: andesim 5c134e5,
1edb88d, 9d10a6d; vsim_andesim e874381). Fast+linux and hybrid now address up
to 16G via ram_base 0x8_00000000 (legacy <=2G layouts bit-identical; alias
region in vsim main.cpp for the low window; cross-window comparisons carry
~0.3% layout noise, gate-3 4B K=51: 362,799 legacy vs 361,930 at 3G). FIRST
27B hybrid measurement: `--mem-size 6G --no-mmap` (mmap+repack would exceed
6G, same math as 8B), K=51 on qwen35 = blk.6.attn_gate [5120 x 6144] nrows=2,
bin-d4 -> **4,578,346 cycles** (0.146 cyc/elem, d4 kernel band). F0 (qwen35 rv64 garbage) FIXED
2026-08-05, llama.cpp 17b246b44: RVV ggml_vec_dot_f32 (+ zvfh vec_dot_f16)
did a `_tu` init merging into an UNINITIALIZED accumulator; Andes GCC 14.2
re-materialized the init under e8,m2,ta leaving 6/8 accumulator regs
tail-agnostic (QEMU writes all-ones) -> every dot ~1e19 -> delta-net
exploded (first bad node GATED_DELTA_NET layer 2, decode). qwen3 4B/8B never
call these helpers on decode paths -> all their numbers stand (fixed-binary
4B K=51 sanity: 362,797 vs 362,799 recorded). Fix: plain init at vlmax +
plain loads, _tu only on the accumulate. Diagnosis pattern that worked:
3-way eval-callback sums (host/rv64-scalar/rv64-RVV, qemu-user, 1-token),
per-TU -march=rv64gc bisect via set_source_files_properties, then objdump.

**27B FULL CHAIN (2026-08-05, fpga_l3, K=51 = blk.6.attn_gate [5120 x 6144]
nrows=2, 6G --no-mmap)**: pristine 54,314,202 -> repack 25,629,722 (2.12x)
-> +prefetch 16,317,304 (3.33x) -> d4 4,578,346 (**11.86x**). Per-elem
consistency across models: pristine 1.71/1.74/1.73, repack 0.82/0.83/0.81,
prefetch 0.264/0.264/0.259 per act, d4 0.138/0.155/0.146 (4B/8B/27B).

U10g(2) CLOSED 2026-08-06: 27B fast mode 6G --no-mmap prints "The capital of
France is Paris." in ~15 min wall (exit-trap mepc 0x97ffffdd4 = high base +
6G). TRAP for future runs: an OVER-BUDGET mmap+repack load (27B mmap 3.8G +
repack ~3.1G > 6G) does NOT fail fast like the 8B@2G case did - it grinds
silently at 99% CPU for 30+ h. Always pass --no-mmap unless mem-size covers
file+repack (~7.5G for 27B); a fail-fast guard in vlinux/llama load is a
worthwhile future fix.

**Still-true hard caps**
- Guest RAM max 2 GiB (QEMU andes_ae350 + driver cap). 27B (~4.5 GB) blocked on this; 4B+KV fits in 2000M.
- Bare-metal toolchain /home/nick/nds64le-elf-newlib-v5d has no gthreads/pthread funcs (vplat path only). vplat: _sbrk unbounded, no clock_gettime, argc=0, stdin EOF, HTIF ~26 MB/s. See [[andes-toolchain-rvv-segment-flag]] for -mext-zvlsseg.
- Hybrid QEMU leg is engine-synced (real elen enforced); fast-mode standalone pins ax46mpv (Zce no Zcd) - use `-- -cpu andes-ax45mpv,vlen=512` there.
