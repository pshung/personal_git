---
name: writeups-need-progressive-disclosure
description: "Nick reads technical pages top-down by level; each section must show a handful of blocks and hide the rest behind <details>, with support material at the end"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8e533375-c955-49b0-8814-eb9d2ab88fa2
  modified: 2026-08-04T06:29:57.255Z
---

On the Q1_0 write-up (2026-08-04): *"the whole thing is still very messy. Go
step by step. Do not add too much information at once. Give information from
high level to low level - that is how it becomes clear."*

Two separate rules came out of that:

**1. Order the document by level, not by chronology.** The page had opened
with machine specs and measurement methodology - a reader met ten numbers
before learning what was slow. The fix:

- hero: one claim, one number, one picture of the problem
- then: the N changes and what each one bought, in one section
- then: the setup they operate on (the data format)
- then: one section per change
- then: measurements
- last: an appendix with the machine spec and how the numbers were taken

**2. Cap what a section shows at once.** Stage 04 was showing 19 blocks
(summary, prose, figure, five panels, two assembly listings, a tally, three
cards, three sub-headings). Now every section shows at most 7 and the rest
sits in `<details class="more">` with a descriptive summary. Visible = what
changed, the picture, the number. Hidden = assembly, byte layouts, instruction
tallies, side notes.

**Why:** he scans for the shape of the argument first and only then drills in.
A flat wall of equally-weighted blocks gives him no way to do that, no matter
how good the individual blocks are.

**How to apply:** guard it with a test that counts, per section, the blocks
outside `<details>` and fails above the cap - otherwise the page silently
re-densifies on the next edit. `test_page.py::visible_blocks` in the Q1_0
scratchpad is the working version. Also confirm each disclosure has a real
summary, not "More".

Related: [[diagrams-need-a-worked-example]],
[[keep-writeups-scoped-to-the-optimization]]
