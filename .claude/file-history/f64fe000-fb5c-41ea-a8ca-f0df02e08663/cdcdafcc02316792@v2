---
name: ax66-makatau-syscall-bug
description: "vsim:ax66_makatau fails HTIF syscalls in --mode cycle; ROOT CAUSE FOUND - host services syscalls by a backdoor write into the flat backing store, invisible to the guest through ax66's private write-back L2 (PL2C). Fix belongs in the vsim platform, not the guest runtime."
metadata:
  node_type: memory
  type: project
  originSessionId: 2f3f544d-3989-4811-a594-f467b83e9ab4
---

`make check-all-engines` (andesim-demo) sweeps the rv64 vsim engines and
`vsim:ax66_makatau` fails `demo/syscall` in `--mode cycle`: the guest's
first HTIF syscall (`gettimeofday`) fails right after boot. ax45mpv_premium,
ax46mpv_advanced, and `--mode fast` (QEMU) all pass.

## ROOT CAUSE (found, evidence-backed - session 3)

The HTIF magicmem transport assumes host and guest share a coherent view of
RAM. They do not on ax66.

- The host services a syscall by writing the result **directly into the
  SystemC flat backing store** - `SimControl::dispatch()`
  (`vsim_andesim/src/platform/sim_control.hpp`) copies args from, and writes
  the return value back into, `data_region.data.begin() + offset`. That is a
  backdoor poke into `SimpleMemory::data` (`simple_memory.hpp`), which sits
  **behind** the Verilated core's caches. `SimpleMemory` only serves a read
  from `data` when the core actually issues a bus transaction; a line the
  core still holds is never refetched, so the host's write is invisible.
- On a core with a **private write-back L2**, the syscall buffers stay
  resident across the handoff and the guest reads its own stale copy. ax66
  has PL2C (256 KB; `mmsc_cfg` bit46 = 1, `mcache_ctl.pl2_en` bit32 = 1);
  ax45/ax46 have no PL2C (`NDS_L2C_CACHE_SIZE_KB {0}`, bit46 = 0). That is the
  whole difference.

**Controlled proof (identical ELF, three engines, `probe3.c` = a faithful
replay of `htif_syscall()` then a readback; b_transport is synchronous so the
host has already written the result before the readback runs):**

| engine | PL2C | mmsc_cfg b46 | mcache_ctl | baseline read | tv_sec |
|--------|------|--------------|------------|---------------|--------|
| ax45mpv_premium | none | 0 | 1b03      | 0 (fresh) | real |
| ax46mpv_advanced| none | 0 | 1b03      | 0 (fresh) | real |
| ax66_makatau    | 256K | 1 | 100001f03 | 5 (stale) | 0 |

`tv_sec` is the clincher: it is a plain host-written **payload** buffer
(gettimeofday's `tv`), not the dirty command word. ax66 reads the bss zero
(0), ax45/ax46 read the real timestamp. So this is genuinely host-write /
guest-cache incoherence, NOT the command word and NOT address translation.

**The guest runtime cannot robustly fix it on ax66:**
- The architecturally correct move is "invalidate only the result buffers
  after the call." That needs **VA-scoped CCTL**, which **traps** on ax66:
  `mk_csr.v` sets `NO_CCTL_VA = RVH_SUPPORT`, and ax66 has
  `NDS_RVH_SUPPORT {yes}` -> VA-form CCTL commands are removed. (probe1:
  `L1D_VA_INVAL`/`L1D_VA_WBINVAL` -> traps=1 on ax66, =0 on ax45.)
- The "ALL" variants don't work: `L1D_WBINVAL_ALL` (cmd 6, what
  `vplat_syscalls.c::flush_dcache()` uses) leaves the guest reading stale;
  `L1D_INVAL_ALL` (cmd 23) would also drop unrelated dirty lines (stack) and
  corrupt the guest at a non-terminal point.
- No guest knob tested exposed the write: WBINVAL_ALL, INVAL_ALL,
  prefetch-off (clear IPREF/DPREF), and DC_COHEN all still read stale on
  ax66. (DC_COHEN can't help - the host poke bypasses the coherence bus.)

**Blocking layer = vsim platform** (per andesim-demo/CLAUDE.md taxonomy):
the SimControl/HTIF backdoor transport is incoherent with the modeled cache
hierarchy for private-write-back-L2 cores. NOT RTL-capability (ax66 has the
memory + CCTL), NOT the andesim driver, NOT the demo. Hybrid mode passes on
ax66 for hello/rvv/fp/etc. precisely because it drains **registers** via the
Debug Module (`state_drain.hpp`, DMI abstract reads) and never round-trips a
host write through guest RAM - so it never hits this.

## PROPER FIX (right layer = vsim, not yet implemented)

After `dispatch()` writes results into `data`, the simulator must make those
bytes visible to the core: invalidate the affected line(s) in the Verilated
core's L1/PL2C model, or issue the result write as a bus transaction the
caches observe - for every engine that models a write-back cache. The handler
already knows the guest addresses it wrote (magicmem, plus each syscall's
payload buffer: gettimeofday `tv`, read `buf`, stat `statbuf`, getcwd `buf`,
...). This is the coherence QEMU gets for free (no guest cache model).
Open question for implementation: whether the Verilated Andes model exposes a
cache-invalidate/flush backdoor, or one must be added. No such primitive
exists in the tree today (hybrid sidesteps RAM coherence via register drain).
Cheap guest-side confirmation not yet run: read the buffers through an
uncacheable mapping (e.g. the RAM_ALIAS 0x800000000 window if PMA marks it
NC) - should return fresh, proving the data is in `data` and only the cache
shadows it.

## Dead ends (do NOT re-open)
- THEORY 1 (session 1): `flush_dcache()`'s L2 MMIO writeback (`mmsc_cfg`
  bit46 gate, 0xe0500000 window). Disproven: skipping the whole block, ax66
  fails identically. (That MMIO window is the kv-core shared-L2C mechanism;
  ax66's PL2C is private/CSR-controlled, so the block is a no-op there
  anyway.)
- THEORY 2 (session 2): alias-region guest-address translation
  (`RAM_ALIAS_BASE 0x800000000`). Disproven: the ELF's magicmem/tv live at
  low addresses (~0x109000), resolved via the plain `region` path; the
  alias-region fix (`SimpleMemory::base_for`) is a real, unit-tested,
  kept fix but a no-op for THIS bug.

## Lesson (held)
Confirm from real runtime values, not docs/vendor samples. Both dead theories
came from reading static config; the answer came from running the same ELF on
all three engines and diffing behavior (probe3). A vendor constant from a
different test harness in the same repo can be entirely inapplicable.

## How to build vsim_andesim (needed for the fix)
Do NOT hand-patch CMakeCache paths. This repo builds INSIDE a pinned
container: `./build_vsim.sh` (builds the `env` image, runs `./build.sh` with
the repo bind-mounted at `/work` - that is why build/ CMakeCache shows /work
paths; correct, not stale). Native host builds hit vendored-dependency
breakage (LIEF missing `#include <cstdint>`, systemc-components API drift).
Full rebuild of all 4 CPUs is slow (single-CPU Verilation ~7.5 min) - run in
background, do not block synchronously. See [[vsim-build-via-container]].

## Reproduce / probes (this session)
`/tmp/.../scratchpad/probe3.c` (discriminator, no rebuild needed) and
`cctl_probe.c` (CCTL sweep). Build: `riscv64-...-gcc -march=rv64gc -mabi=lp64d
-O2 -B /home/nick/work/andesim/build/runtime -specs=andesim.specs`. Run:
`sim_<engine> probe3.elf`. Runtime fixture:
`andesim/tests/vplat/test_vplat_gettimeofday.sh` (RED on ax66). Build fixtures
after `. /home/nick/work/andesim/config.env` (exports HYBRID_TOOLCHAIN).

## How to apply
Root cause is settled - do not restate it as open or re-run the dead
theories. If asked to FIX: the change is vsim-side (cache-coherent syscall
writeback) + a full container rebuild; it is significant. Confirm scope with
the user before starting (they have said twice this is open-ended). A natural
RED test already exists (`test_vplat_gettimeofday.sh` fails on ax66); a
SimControl-level unit test could pin it before touching the transport.
