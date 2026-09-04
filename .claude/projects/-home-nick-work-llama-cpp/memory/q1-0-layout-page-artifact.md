---
name: q1-0-layout-page-artifact
description: "Published 2026-09-04: 'One Q1_0 Tile, Three Layouts' artifact (weight/activation/scale memory layouts + intrinsics for upstream, RVV repack, VD4DOT repack); generator and geometry tests live in repo q1_0_layout_page/"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9dc38dc5-bbdf-495d-893d-6c7024760808
  modified: 2026-09-04T06:31:13.821Z
---

Artifact URL: https://claude.ai/code/artifact/74b61050-1b5e-4eb6-ac4d-f10ea2a16552
(favicon 🧱, title "One Q1_0 Tile, Three Layouts"). To update from a later
session pass this URL as `url` to the Artifact tool after `action: read`.

Generator: `q1_0_layout_page/build_page.py` (untracked in the llama.cpp repo
root) owns every constant, reads the kernel excerpts from the repo at build
time, and writes `q1_0_layout_page.html`. `test_page.py` checks drawn width ==
printed label for every figure, the <= 7 visible blocks per section cap, and
that every <details> has a real summary. `render.py` renders each SVG to PNG
with rsvg-convert for the one visual check.

Figures: hero (tile footprint of one vlm.v + register fill + 320/96/32
instruction bars), formats, 1152-B weight strips, three per-variant flow
figures, gemv activation restage, gemm de-interleave.

Related: [[diagrams-need-a-worked-example]], [[writeups-need-progressive-disclosure]],
[[keep-writeups-scoped-to-the-optimization]], [[xandesvdot-nds-vd4dots-usable]]
