---
name: new-engine-dormant-codepath-bugs
description: bringing up a new vsim engine variant can exercise vsim's OWN simulator code paths (not just the guest binary) for the first time -- e.g. multi-bank HVM/ILM/DLM backdoors -- and hit latent C++/SystemC bugs in vsim itself, distinct from [[fast-leg-permissive-cycle-enforces-hw-contract]]'s guest-code class.
metadata:
  type: feedback
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

Found bringing up `ax46mpv_fpga_l3` (first ax46mpv-family engine with
`NDS_HVM_BANKS=2`; `ax46mpv_advanced` -- the only prior ax46mpv config --
has `NDS_HVM_BANKS=1`). `ax46mpv_cpu_cluster_subsystem.hpp`'s
`set_hvm()`/`get_hvm()` only ever referenced `u_1p_bank0`'s hierarchical
Verilated array, using `_NDS_HVM_SIZE_KB` (the TOTAL across both banks) as
the write length. Each bank's real array was sized for HALF that
(`NDS_HVM_ADDR_BANK_BIT=22` => 4 MiB/bank of 8 MiB total, confirmed via
`VlUnpacked<VlWide<32>, 32768>` in the generated `*__024root.h`). Writing
the full 8 MiB into a 4 MiB array overflowed the heap silently -- the
bounds check in `set_hvm` compares against the TOTAL size (which matched),
so it didn't catch the per-bank overflow. No crash at the write site
itself; corruption only surfaced later as a SIGSEGV inside
`sc_core::sc_port_registry::construction_done()` during the NEXT
`sc_start()` elaboration call, deep in SystemC internals with no relation
to HVM in the backtrace.

**The reference implementation already existed and was already correct**:
`ax45mpv_premium_cpu_cluster_subsystem.hpp`'s `set_hvm`/`get_hvm` (gated on
`#if defined(_NDS_IO_HVM0) && defined(_NDS_IO_HVM1)`) already handles the
2-bank case properly, splitting via `bank_bytes = 1 << _NDS_HVM_ADDR_BANK_BIT`
and calling the SAME shared `hvm_bank_write`/`hvm_bank_read`
(`lm_backdoor.hpp`) twice with different `base` offsets -- the `base`
param exists specifically for this. ax46mpv's wrapper just never got the
same treatment because every prior ax46mpv config was single-bank. Fixed
by porting that exact pattern in, `#if defined(...)`-gated so the existing
single-bank engine's behavior is untouched (ax46mpv's own bank0/bank1
macro names differ from ax45mpv_premium's -- `_NDS_IO_HVM_BANK0_TYPE0`/
`_NDS_IO_HVM_BANK1_TYPE0`, not `_NDS_IO_HVM0`/`_NDS_IO_HVM1` -- check the
built `config.inc`, don't assume naming carries across engine families).

**Why**: a cpu_wrapper's backdoor (ILM/DLM/HVM set_*/get_*) is written and
tested against WHATEVER bank count the engines that exist at the time
happen to have. A brand-new engine config that changes a previously-fixed
parameter (bank count, here) silently walks into whichever code path never
got exercised. This is a bug in vsim's OWN C++ glue code, not in QEMU, not
in andesim, and not in the guest binary being tested -- categorically
different from [[fast-leg-permissive-cycle-enforces-hw-contract]]'s class
(guest code violating a real hw contract that only the strict leg
enforces). Diagnosis path that worked: bisect which CLI flag alone
reproduces the crash (`--hvm` alone did; `--ilm`/`--dlm` alone didn't) --
much faster than reading the whole hybrid resume sequence top-down, since
the crash SITE (SystemC elaboration) was nowhere near the actual BUG site
(the HVM write).

**How to apply**: when a new engine config changes ANY parameter that was
previously constant across every existing engine of that family
(bank count, cache presence/level, privilege levels, vlen/elen, ...),
suspect that EVERY cpu_wrapper code path gated on or sized from that
parameter may have a latent bug -- it was never truly tested, only
untested-and-coincidentally-not-crashing. Check whether a SIBLING engine
(different family, same capability) already has a correct reference
implementation to port from before writing one from scratch. A late,
seemingly-unrelated SIGSEGV (wrong module, wrong subsystem, elaboration-
time rather than at the actual bad write) is a classic heap-corruption
symptom -- bisect by CLI flag / code path before trying to read a
backtrace literally.
