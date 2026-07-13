---
name: ax66-makatau-syscall-bug
description: vsim:ax66_makatau engine fails demo/syscall in --mode cycle due to a real bug in the andesim repo (not andesim-demo)
metadata: 
  node_type: memory
  type: project
  originSessionId: 2f3f544d-3989-4811-a594-f467b83e9ab4
---

`make check-all-engines` (in andesim-demo) sweeps all 3 vsim engines
(`ax45mpv_premium`, `ax46mpv_advanced`, `ax66_makatau`) and found
`vsim:ax66_makatau` fails `demo/syscall` in `--mode cycle`: the guest's
first-ever syscall, `gettimeofday()`, fails right after boot
(`SYSCALL_STAGE_BAD gettimeofday`, exit 2). The other two engines and
`--mode fast` pass fine.

Root cause, verified by reading source directly (2026-07-13):
- `andesim/runtime/vplat_syscalls.c:72-103` (`flush_dcache()`, called by
  every `htif_syscall()`) checks CSR `mmsc_cfg` bit 46 ("L2 present").
  If set, it touches L2C control registers at `0xe0500008/40/80` with
  64-bit `ld`/`sd`.
- `ax66_makatau` is the only one of the 3 engines whose RTL decoder
  reports that bit as 1 (`tests/engines/ax66_makatau-5937b880/rtl_params.json`:
  `PL2C_SUPPORT: 1`; the other two engines have no such param at all).
- But `andesim/driver/memmap.hpp:22-24` and
  `andesim/docs/hybrid_state_transport_problems.md` problem M2 both say
  NO current engine actually has the L2C hardware built
  (`_NDS_L2C_CACHE_SIZE_KB=0` everywhere, ax66_makatau included). So this
  engine's capability CSR says "L2 present" while the hardware disagrees.
- Guest trusts the CSR bit, touches a register that isn't really there
  -> breaks the HTIF syscall protocol on the very first syscall call.
- Second, independent bug in the same function: same doc's problem M5
  says L2C registers need <8-byte access (`sw`/`lwu`), but the code uses
  64-bit `ld`/`sd` regardless.

**CONFIRMED: not an RTL bug, it's a software bug (2026-07-13 follow-up).**
Checked `/home/nick/work/vsim_andesim/external/ax66/andes_ip/mk_core/ucore/csr/hdl/mk_csr.v`
directly. Line 433: `localparam PL2C_SUPPORT = 1; //*always support PL2C
for AX66 even if SIZE = 0KB` - this is an explicit, intentional vendor
design choice, not an oversight. Every other cache support flag in this
file IS size-gated (e.g. `ICACHE_SUPPORT = (ICACHE_SIZE_KB > 0) ? 1 :
0`); PL2C_SUPPORT is the one deliberate exception. The actually-correct,
size-aware CSR is `MPL2CM_CFG` (0xfdf): its `dsz`/`dway` fields are
properly gated on `PL2C_SIZE_KB == 0` (line 14818-14824, "no pl2
cache"). `PL2C_SIZE_KB` itself is a real configurable `parameter`
(line 280) currently 0 for this build - consistent with andesim's
`_NDS_L2C_CACHE_SIZE_KB=0` claim.

So: `mmsc_cfg`'s coarse PL2C "support" bit is genuinely, deliberately 1
on ax66_makatau regardless of size; the RTL exposes the real answer
("is there actually a cache") through a different CSR
(`MPL2CM_CFG`/dsz-dway), which the andesim guest code never reads. The
bug is 100% in `andesim/runtime/vplat_syscalls.c`'s `flush_dcache()`:
it must not treat the coarse support bit as "safe to touch L2C MMIO",
either checking `MPL2CM_CFG`'s size fields first, or another safe
gate.

**Why this matters:** the bug lives in `/home/nick/work/andesim`
(`runtime/vplat_syscalls.c`), a sibling repo to `andesim-demo` (this
project) - not something to fix inside andesim-demo. `andesim-demo`'s
own `check-all-engines` tooling (ROADMAP item 4, already DONE) is
working exactly as designed by catching this.

**How to apply:** if asked again to test/sweep engines, expect this
exact failure on `ax66_makatau` until `andesim/runtime/vplat_syscalls.c`
is fixed to check `MPL2CM_CFG` size fields (not just `mmsc_cfg`'s PL2C
bit) before touching L2C MMIO, and/or fixes the `ld`/`sd` access width
to `sw`/`lwu` per spec. Root cause is now fully resolved/confirmed -
no need to re-investigate the RTL side again. User has not yet said
whether to apply the fix (cross-repo, in andesim) - ask before editing
that repo.
