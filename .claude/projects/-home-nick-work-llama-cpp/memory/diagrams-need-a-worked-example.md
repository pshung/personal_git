---
name: diagrams-need-a-worked-example
description: "Nick wants technical figures drawn to real scale so the problem is visible as area; not schematics, and not toy examples he has to hand-compute"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8e533375-c955-49b0-8814-eb9d2ab88fa2
  modified: 2026-08-04T02:08:30.047Z
---

Two rejections on the same figure set, in order:

1. Schematic diagrams (random-looking cells, greyed grids showing only shape)
   got "so crude nobody can understand it".
2. My fix - an 8x8 worked example with checkable numbers - got rejected too:
   *"with these small examples you cannot see lane utilization. I want a
   diagram that is easy to understand, not one I have to hand-compute. You
   have to make people see where the problem is."*

**Why:** the figure has to carry the *problem*, and here the problem was
proportion - 32 of 128 lanes busy, 1 of 64 outputs advancing. Shrinking to a
toy size destroys exactly that. Numbers a reader must add up are work, not
explanation.

**How to apply:**

- Draw at the machine's real dimensions. 128 lanes means 128 lane slots; a
  64x128 tile means a 2:1 box. The empty space then *is* the waste.
- Encode the point as **area, count and colour**, never as arithmetic. A bar
  25% filled, a dot matrix with 1 of 64 lit, a shaded sliver in a big grid.
- Put the comparison in one figure, one row per variant, same axes - the
  reader sees the improvement without reading a single number.
- Values inside cells are usually noise. Show *how many* and *where*, not
  *what*.
- Still generate everything from a script owning the constants, with tests
  that the drawn geometry matches the printed labels. `example.py` /
  `test_example.py` in the Q1_0 page scratchpad is the working pattern.
- Render each SVG to PNG (rsvg-convert with the CSS vars substituted) and
  look at it. Overlapping labels are invisible in source.
- SVG `<pattern>` instead of thousands of rects when a bar has hundreds of
  cells; it kept the page at 218 KB instead of 285 KB.

Related: [[q1_0-wide-vlen-repack-rowparallel]],
[[xandesvdot-nds-vd4dots-usable]], [[keep-writeups-scoped-to-the-optimization]]

**Third rejection, 2026-09-04 (layout page):** a 1152-byte strip at 0.75 px/byte
made the 2-byte scales 1.5 px wide - "圖沒有劃出 parameter and scale 的位置 我看不出來".
I answered with a byte map (8 px/byte, 32 B per row, every scale a visible
cell), a per-bit inset, legends on every figure, and a visible C-struct
section with types and byte offsets (he had asked "把他們的資料結構struct
include type 呈現出來"). He then said "退回上一版本好了" and I rolled the
artifact back to the first version, no reason given. So: the complaint stands
(scale positions were not visible) but the byte-map + structs page is NOT an
accepted answer either. Ask what he wants to see before redrawing; the v2
generator is kept in the session scratchpad `q1_layout/v2/` only.

**Fourth round, 2026-09-04, accepted direction:** "layout 1, 2, 3, 用圖搭配
instruction 解說, 請再做細緻一點 變數要對的起來". For per-layout kernel
explanations he wants a numbered step ladder: one instruction (verbatim from
the kernel) + one picture of the registers it touches + one plain sentence,
and every name drawn in the picture must be the kernel's own variable name
(is_not_zero, qy, neg_qy, sy, red / sign, yc, sumi, facc, dx, sumf / planes,
p, aw, w0..w3, s0, s1, acc). Guard it: a test that every <text data-role=var>
appears in that step's code and every __riscv_*() call is verbatim in the
extracted source. Built as steps_upstream/steps_rvv/steps_vd4 in
q1_0_layout_page/build_page.py.
