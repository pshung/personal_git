---
name: qemu-user-vs-system-flavors
description: "two QEMU flavors in this env - qemu-runner agent is bare-metal qemu-system only; Linux binaries (kernel-lab tests, llama binaries) must use run-rv64-qemu.sh via Bash"
metadata: 
  node_type: memory
  type: project
  originSessionId: c26ec38c-e5b0-486c-aa62-058263cf1ea8
---

Two incompatible QEMU flows exist for rv64 work (verified 2026-07-22):

- qemu-runner agent -> `/home/nick/.claude/agents/qemu-runner/run_qemu.sh` ->
  `qemu-system-riscv64 -M andes_ae350 -bios <ELF> -semihosting`. ONLY for
  bare-metal ELFs (ace-tq1 rdcycle style). Feeding it a Linux binary gives
  exit 1 with zero output. The agent is hard-constrained to one call of that
  wrapper and cannot run anything else. Wrapper takes VLEN as arg 2.
- `llama.cpp/run-rv64-qemu.sh` -> Andes `qemu-riscv64` user-mode. For Linux
  glibc binaries: kernel-lab/test_q1_0_rv64, llama-bench, etc. Output is
  normal stdout - no semihosting fd-9 quirk, safe to run directly in Bash.
  VLEN via env: `QEMU_CPU=andes-ax45mpv,vlen=256,zfh=true,zvfh=true`
  (zfh/zvfh must be explicit or fp16 SIGILLs).

**Why:** the session guidance "always use qemu-runner for QEMU" only applies
to semihosting/bare-metal ELFs; following it for Linux binaries wastes an
agent round-trip and returns nothing.

**How to apply:** static glibc binary (file says "ELF ... statically linked,
for GNU/Linux") -> Bash + run-rv64-qemu.sh. Bare-metal/semihosting ELF ->
qemu-runner agent with VLEN as second arg. See [[ace-tq1-standalone-kernel-lab]].

**Baremetal flow that actually works (2026-07-23, user-directed):** build with
the toolchain DEFAULT runtime + `-mvh` (Andes virtual hosting) - NO custom
crt0/libgloss/handler. Same ELF then runs on Andes QEMU
(`-M andes_ae350 -semihosting -bios <elf>`, qemu_v5 build) AND on vsim RTL
sims. The vsim-demo BSP (crt0.S/libgloss.c/htif.h, DISPLAY/EXIT MMIO,
_stack=0x3000000) is a tarpit: stack beyond premium RAM -> access-fault
storms, printf-in-trap-handler hangs, QEMU has none of its MMIO devices.
Ladder: QEMU functional pass FIRST, vsim only for cycles.
`/local/nick/qemu_andes/build` is GONE - wrapper repointed to
`/local/nick/qemu_v5/build/qemu-system-riscv64`. ax46mpv has Zcmp not Zcd:
build rv64g (no c) and keep float-printf out (iprintf) or c.fsdsp traps.
