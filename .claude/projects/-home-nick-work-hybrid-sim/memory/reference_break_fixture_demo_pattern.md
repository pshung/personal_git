---
name: reference_break_fixture_demo_pattern
description: How to demonstrate a hybrid handoff limitation with a break_*.S fixture (standalone-PASS vs hybrid-FAIL asymmetry)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2e88bf70-6c26-451c-a2f4-3a77d55a90c8
---

To PROVE a hybrid-handoff limitation (not just describe it), ship a
`tests/fixtures/break_*.S` fixture and run it as a live cell in
`docs/andes_sim_limitations.ipynb`.

Pattern (see `break_lrsc.S`, `break_mcycle_write.S`, `break_vscratch.S`):
- Bare-metal RV64 asm, linked at 0x00100000 via `runtime/andes-sim.ld`.
- Delimit the ROI with the marker HINTs `slti x0,x0,0x5A0` (enter) /
  `0x5A1` (exit). Exit a passing run via SimControl: `sw x0, 0(0xe0080000)`.
  A failing run hangs in a tight loop -> the harness/`timeout` kills it.
- The proof is the ASYMMETRY: the same ELF PASSes standalone
  (`--model fast` AND `--model cycle`, one engine, no handoff) but FAILs
  `--model hybrid`. That isolates the handoff boundary as the sole cause
  (e.g. LR/SC: the reservation set on QEMU1 is lost when vsim resumes).
- Register in the Makefile's `BREAK_FIXTURES` list (NOT in `all` -- they
  misbehave on purpose). `.S` is git-tracked; `.elf`/`.o` are gitignored.
  Build: `make -C tests/fixtures break_lrsc.elf TOOLCHAIN=$HYBRID_TOOLCHAIN`.
- Run (bound the hang so it returns):
  `timeout 30 andes-sim run --model hybrid --trigger marker --engine vsim:ax45mpv_premium <elf>`
  exit 124 = the documented hang.

Not every limitation is cleanly demonstrable on the default M-only
`ax45mpv_premium`: PMP-locked-entry (L2), satp/paging (L3), and vendor-CSR
(L21) demos are confounded (WARL-pinned CSRs, or need a trap handler that
violates the trap-free envelope) -- document those instead of shipping a
flaky fixture. See [[reference_notebook_verification]] to run the notebook,
and verify code-vs-text drift directly ([[feedback_verify_codegen_with_objdump]]).
