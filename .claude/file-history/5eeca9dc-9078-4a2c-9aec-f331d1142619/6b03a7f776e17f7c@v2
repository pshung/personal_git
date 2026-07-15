---
name: cycle-leg-fixture-sizing
description: A cycle-leg (vsim, ~8.7kHz) test fixture sized for the fast (QEMU) leg silently times out with NO crash trace and NO output -- diagnose by shrinking the workload first, not by assuming a bug or blindly raising the timeout.
metadata:
  type: feedback
  originSessionId: 5eeca9dc-9078-4a2c-9aec-f331d1142619
---

Recurring pattern while building [[andesim-linux-runtime-roadmap]]'s vlinux
test fixtures (U6, U7 -- two occurrences in one session): a fixture whose
loop count / data size was chosen with only the fast (QEMU, MHz-speed) leg
in mind runs fine there, then on the cycle-accurate leg (vsim, ~8.7 kHz)
just... times out. No crash, no error trace, no partial output beyond the
boot banner -- the process is genuinely still running, just far slower
than the timeout budget assumed.

Concrete numbers from this session (`ax45mpv_premium`, ~8.7 kHz):
- A static-glibc binary's own startup (TLS setup, riscv_hwprobe loop,
  ...) costs a fixed ~400-435s baseline REGARDLESS of what the fixture's
  own code does -- this alone is why every glibc-linked vlinux fixture
  needs a several-hundred-second timeout, not the ~1-2min a bare-metal
  fixture needs.
- On TOP of that baseline, a 10-million-iteration `-O0` busy loop (U6)
  and a 256 KB / ~258-window-round-trip file transfer (U7) BOTH blew a
  600s total budget. Shrinking to 10K iterations and a 16 KB / ~9-round-
  trip transfer respectively fixed both, with zero loss of what the test
  actually verifies (a monotonic-delta check and a checksum-after-mmap
  check do not care how big the workload was).

**This is a DIFFERENT failure signature from the fast-permissive/cycle-
enforces-hardware-contract bug class** ([[fast-leg-permissive-cycle-enforces-hw-contract]]):
that class always produces a distinct fault (illegal instruction, load
access fault, specific mcause/mtval) that fast never sees. THIS class
produces no fault at all -- just silence until the harness's own
`timeout` kills it. If a NEW cycle-leg fixture times out with zero
output beyond the boot lines, check data size/loop count BEFORE assuming
a functional bug.

**How to apply**: when writing a new fixture that runs on both fast and
cycle:
1. Size loops/data transfers for the SLOWER leg from the start, not just
   whatever number reads well in the fast-leg output. If the roadmap or
   spec gives an illustrative size (e.g. "64 MB", "10M iterations"),
   treat it as a fast-leg-only suggestion and scale it down for the
   automated cycle-leg test, with a comment explaining why.
2. If a cycle-leg run times out with no crash trace: do NOT immediately
   assume a logic bug and start debugging the syscall/feature code. Run
   a much-smaller-input diagnostic version FIRST (a few minutes) to
   confirm the code path is actually correct and just slow, before
   spending time on speculative debugging of correct code.
3. Once confirmed as a sizing issue, prefer shrinking the workload over
   just raising the timeout -- keeps the regression suite fast for every
   future run, not just this one. A modest timeout bump on top (for
   margin) is fine; relying on timeout alone is not, since it makes the
   whole suite slower forever.
