---
name: keep-writeups-scoped-to-the-optimization
description: "In Nick's perf write-ups, cut everything that is not the optimization itself - no traps, no \"did not work\", no corrections, no open items"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8e533375-c955-49b0-8814-eb9d2ab88fa2
  modified: 2026-08-04T01:43:39.909Z
---

Nick's instruction on the Q1_0 write-up (2026-08-04): "remove information
unrelated to the optimization, like anything about fail - do not mention it."

What that removed from the page:

- A "Traps" section (silent DCE, stride-0 broadcast, misaligned load) and the
  build gates that catch them.
- "Did not work" cards describing approaches that were tried and reverted.
- A "Correction on the record" card retracting an earlier wrong claim.
- A "What is left" / open-items section.
- Every mention of a tensor that failed the repack gate, and the per-token
  roll-up was rescoped to only the layers that were actually optimized.

What stayed: the mechanism of each stage, the measured cycles, and the
constraints that shaped the kernel (stated as requirements, e.g. "this core
requires a 32-bit vector element load to be 4-byte aligned", not as "it
faults").

**Why:** the document's job is to explain how the speedup was obtained. War
stories about bugs, reverted experiments and unfinished work are a different
document and dilute this one.

**How to apply:** engineering-diary material belongs in ROADMAP.md or a memory,
not in the write-up. If a limitation must appear because a number depends on
it, state the scope positively and label it, rather than narrating the failure.

Related: [[diagrams-need-a-worked-example]]
