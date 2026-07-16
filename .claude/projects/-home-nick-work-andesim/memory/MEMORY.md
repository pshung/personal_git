# Memory index

- [ax66 registration loose ends](ax66-registration-loose-ends.md) — d23 rebuilds unregistered (guard fails; rm sim_d23 or register), uzobctl/sleepvalue spec escalation (release_surface/hvm_wiring fixed 2026-07-15).

- [Log-first debugging](log-first-debugging.md) — debug andesim failures only via --log-level/--log-file/repro bundle; missing info = add the log line first.
- [Andes engine config source](andes-engine-config-source.md) — a built vsim engine uses its `build/.../obj_sc/config.inc` (or `--describe`), which can differ from the `external/` source tree.
- [Premium M-ext CSR capability](premium-mext-csr-capability.md) — premium verifies only 17 of the 51 v4 M-ext CSRs; QEMU exposes more than vsim implements; dump real set via RSP qXfer.
- [Pipe swallows build exit code](pipe-swallows-build-exit-code.md) — `build | tail` masks failures; also: correct compile_commands.json flags don't prove a .o actually recompiled (rm -f the exact .o if behavior stays stale).
- [zsh noclobber breaks > redirects](zsh-noclobber-background-redirect.md) — `cmd > existing.log` fails with "file exists" on this host; use `>|`.
- [ACE in andesim bring-up](ace-in-andesim-bringup.md) — run ACE demos under andesim; copilot/eca version matrix, QEMU agent-ABI (ace_agent_* v102) blocker, cycle=engine rebuild.
- [andesim Linux-runtime roadmap](andesim-linux-runtime-roadmap.md) — COMPLETE: U0-U9 all done, llama-completion runs on andesim fast AND hybrid mode (6528953 cycles, K=51 ROI). U10/U11 optional 27B stretch.
- [Fast-permissive/cycle-enforces bug class](fast-leg-permissive-cycle-enforces-hw-contract.md) — 6 instances now incl. ELEN=32/LMUL=8 vector faults; QEMU (esp. plain fast) under-enforces hw contracts vsim RTL correctly rejects.
- [Cycle-leg fixture sizing](cycle-leg-fixture-sizing.md) — a fixture sized for fast silently times out (no crash) on the ~8.7kHz cycle leg; diagnose with a much-smaller input before assuming a bug.
- [llama.cpp RISC-V checkout](llama-cpp-riscv-checkout.md) — /home/nick/work/llama.cpp: Bonsai-4B (qwen3, 572MB) verified working via run-rv64-qemu.sh; build-rv64* dirs explained.
- [riscv64-linux-gdb is broken](riscv64-linux-gdb-broken.md) — vendor LINUX_TOOLCHAIN gdb can't run (stale Jenkins python paths); use handler.c's trap-frame dump or QEMU -d exec instead.
- [CM-build halted cache-enable wedge](cm-build-halted-cache-enable-wedge.md) - hybrid-only silent in-ROI output / aperture timeouts on NDS_CACHE_COHERENCE engines; restore must OR DC_COHEN; bisect via state-file write_mask + drained GPRs.
