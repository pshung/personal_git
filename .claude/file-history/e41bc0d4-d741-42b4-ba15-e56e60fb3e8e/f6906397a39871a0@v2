---
name: rt-c-matmul-empty-roi
description: "rt_c_matmul fixture bug: compiler hoisted the inlined GEMM above enter_vsim(), so the ROI is empty (markers back-to-back); window_cycles=74 is drain overhead only"
metadata: 
  node_type: memory
  type: project
  originSessionId: e41bc0d4-d741-42b4-ba15-e56e60fb3e8e
---

Discovered 2026-06-12 while smoke-testing cosim checkpoints: in
tests/fixtures/rt_c_matmul.elf the compiler hoisted the inlined
matmul_kernel() ABOVE the enter_vsim() marker. The ENTER (0x1002aa) and
EXIT (0x1002ae) markers are back-to-back; the ROI retires only ~3 insns
(halt slack). The GEMM actually runs in QEMU phase 1, and the hybrid
window_cycles (~74) measures drain overhead, not the kernel.

Why nothing caught it: e2e only checks a cycle figure exists, and
--verify compares two deterministic runs that agree whether or not the
ROI re-ran on vsim. `--cosim` surfaces it directly: "3 ROI retires".
rt_c_v_matmul is fine (its ROI is a real `jal vmatmul_kernel`, 1692
retires); rt_c_v_regs is fine (7 inline V insns).

**How to apply:** before quoting any fixture's hybrid figure, check the
marker span with objdump (see [[feedback-verify-codegen-with-objdump]]) or
run `--cosim` and read the "N ROI retires" line. The fixture fix (not yet
done): give the marker asm a real ordering dependency on the kernel's
data, not just a "memory" clobber, or call a noinline kernel like
rt_c_v_matmul does.
