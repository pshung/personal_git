---
name: rt-c-matmul-empty-roi
description: "FIXED 2026-06-12 (7022599): rt_c_matmul's ROI was empty (kernel hoisted/DCE'd past the markers); root cause = non-escaping statics; lesson: marker memory clobbers only cover ESCAPED memory"
metadata: 
  node_type: memory
  type: project
  originSessionId: e41bc0d4-d741-42b4-ba15-e56e60fb3e8e
---

FIXED in 7022599 (2026-06-12). rt_c_matmul shipped with an EMPTY ROI:
the compiler hoisted the inlined GEMM above enter_vsim(), and with
noinline alone it deleted the call as a dead store. window_cycles (~74)
measured drain overhead. Found by --cosim's "N ROI retires" line.

ROOT CAUSE (the durable lesson): GCC's asm "memory" clobber only orders
accesses to ESCAPED memory. A `static` array whose address never leaves
the TU is invisible to the marker asm, so kernel code touching only such
arrays can hoist, sink, or be DCE'd across the markers -- noinline alone
does not save it (IPA mod/ref still proves the call dead). Fix pattern:
external linkage (or otherwise escape the address) for ROI data + a
noinline kernel call between the markers. rt_c_v_matmul survived only
because V intrinsics are opaque to IPA.

Guard: tests/fixtures/test_fixture_roi_content.sh statically asserts the
marker span carries the promised kernel (run it after touching fixtures
or bumping the toolchain). Quick dynamic check: --cosim prints the true
ROI retire count. After the fix: 8x8x8 GEMM (16^3 was ~322k vsim cycles,
too close to harness timeouts), 4683 ROI retires, ~45k cycles. See
[[feedback-verify-codegen-with-objdump]] and [[cosim-roi]].
