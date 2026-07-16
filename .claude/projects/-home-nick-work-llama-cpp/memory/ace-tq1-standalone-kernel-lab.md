---
name: ace-tq1-standalone-kernel-lab
description: "User's earlier standalone TQ1/TQ2 kernel extraction at /local/nick/vsim-workspace/vsim-demo/ace-tq1 - vsim baremetal, rdcycle, ACE custom instructions; techniques reusable for Q1_0/Q2_0 RVV work"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a1f025b8-7f3c-4e04-8739-c3980abe86ac
---

/local/nick/vsim-workspace/vsim-demo/ace-tq1 is the user's earlier standalone
extraction of the TQ1_0 x Q8_K kernels (tq1.c, tq2.c), built for Andes vsim
baremetal (clang, -march=rv{XLEN}gc_zve32x_zfh, hvm_util malloc, enable_ace(),
mstatus VS-bit set in main).

Useful pieces for the llama.cpp Q1_0/Q2_0 RVV optimization (see
[[andesim-llamacpp-hybrid-gaps]] and opt_roadmap.md):

- Real cycle measurement: rdcycle() reads mcycle between kernel calls; vsim is
  cycle-accurate where QEMU only proxies instruction count. Flow: QEMU for
  correctness, vsim for cycles, FPGA final.
- Deferred-reduction pattern (roadmap F2): vwmaccsu accumulates i8 products
  into i16m2 lanes, ONE vwredsum per 256-block. Works there because TQ1_0/Q8_K
  have one scale per block; Q1_0 x Q8_0 must adapt (per-32 y scales).
- Trit unpack trick for ternary (roadmap F5 Q2_0): vmul by pow3 {3,9,27,81}
  then vwmulu x3 + vnsrl >>8 turns packed base-3 bytes into {0,1,2}.
- bsums offset trick: subtract sum(q8) once per block instead of handling the
  {0,1,2}->{-1,0,+1} offset per element (block_q8_K carries bsums).
- ACE custom instruction flow (roadmap F6+): unpack.ace spec -> COPILOT
  generates lib/libacetool.so (assembler plugin, objdump -Mace=...) and
  libaceasim.a (sim model); license.ini needed. Custom ops used:
  ace_v_q_tq1_unpack03_i32m4, ace_v_tq1_unpack4_i8m1,
  ace_v_w_mul_free_macc_i16m{2,8}.
- Caveat: its main() has no automated reference comparison (constant 1.0 test
  data, prints result only) - reuse the build/measure infra, not the
  verification; kernel-lab/ in llama.cpp repo has the proper harness.
