---
name: ax66-makatau-syscall-bug
description: "ax66 HTIF syscall bug: ROOT CAUSE FOUND AND FIXED (2026-07-14) - host backdoor-wrote syscall results into flat RAM, invisible through ax66's private write-back PL2C; fixed by moving the mailbox into an uncached SimControl device window (vsim + QEMU + runtime, all committed)"
metadata:
  node_type: memory
  type: project
  originSessionId: 2f3f544d-3989-4811-a594-f467b83e9ab4
---

`vsim:ax66_makatau` used to fail every HTIF syscall (`demo/syscall`,
gettimeofday, file io) in `--mode cycle`; ax45/ax46/QEMU passed.

## ROOT CAUSE (proven 2026-07-14)

The legacy HTIF protocol staged args/results in a `magicmem` block in
cacheable RAM; the host serviced calls by **backdoor** reads/writes of the
flat backing store (`SimpleMemory::data`), behind the Verilated core's
caches - no bus transaction, nothing snooped. Any core with a private
write-back L2 keeps serving its own stale copy. ax66 is the only engine
with one (PL2C 256KB, `mmsc_cfg` bit46=1); ax45/ax46 have none, so their
post-flush reads missed to RAM and got fresh data.

Controlled proof (same ELF, 3 engines, probe replaying `htif_syscall()`):
ax66 read back the staged syscall number (5) and `tv_sec=0`; ax45/ax46
read the result (0) and a real timestamp. The guest cannot fix it:
VA-scoped CCTL traps on ax66 (`NO_CCTL_VA = RVH_SUPPORT`, RVH=yes),
`*_ALL` invalidates drop unrelated dirty lines, and probes showed L1-only
ops are unreliable anyway (line migrates between L1 and PL2C).

## THE FIX (landed, all repos, TDD)

Mailbox moved OUT of RAM into device storage - coherence by construction
(device space is PMA-uncached on every engine). Contract in
`andesim/ROADMAP_HTIF_WINDOW.md`: 2KB window at SimControl +0x800 (eight
u64 arg/result slots + 1984B payload area), doorbell `SYSCALL_GO` at
+0x28, payload pointers are window VAs, guest uses u64 accesses only.
Legacy RAM protocol kept for old ELFs. `flush_dcache()` DELETED from the
runtime (its L2-MMIO block poked 0xe0500000, which on ax66 is the L3C
base - wrong device anyway).

Commits:
- vsim_andesim `c90c234` window + `8d71170` run_syscall extract
  (+ `b48cff5`/`5229426`: cstdint + alias-region fix, a separate real bug)
- qemu fork `2342ca8227` andes_ae350 sim_ctrl mirror
- andesim `0e3a13e` runtime rewrite + vplat_window fixture/test

Verified: `test_vplat_gettimeofday.sh` + `test_vplat_window.sh` green on
ax45/ax46/ax66 cycle + QEMU fast; vplat f1-f9/markers green;
`demo/syscall` SYSCALL_OK on ax66 in cycle and both hybrid triggers.

## Dead ends (do NOT re-open)
- Theory 1 (disproven): `flush_dcache()`'s L2C MMIO writeback path.
- Theory 2 (disproven for THIS bug): alias-region VA translation - real
  independent bug, fixed and unit-tested, but magicmem lived at low
  addresses so it was a no-op here.
- `vplat_file.elf`'s old wild-address crash (0x6300050980) was the same
  coherence hole in the guest->host direction: the host read stale args
  (a garbage buffer pointer) out of RAM the guest's caches still owned.

## Lesson (held)
Confirm from real runtime values, not docs/vendor samples: both dead
theories came from reading static config; the answer came from running
one ELF on all three engines and diffing behavior. When two masters
share memory through different paths (bus vs backdoor), suspect
coherence before address math.

## Build notes
vsim: `./build_vsim.sh` (container; native fails on vendored deps).
Platform-only C++ edits do NOT re-Verilate - incremental is minutes. Unit
tests build natively: `ninja -C build-utest test_sim_control && ctest`.
QEMU fork: `./build_qemu.sh` in qemu_andesim. Runtime/fixtures need
`. config.env` first (exports HYBRID_TOOLCHAIN). See
[[vsim-build-via-container]].
