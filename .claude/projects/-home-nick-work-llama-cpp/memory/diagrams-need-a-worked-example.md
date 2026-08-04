---
name: diagrams-need-a-worked-example
description: Nick rejects schematic/abstract diagrams; every technical figure must be a small worked example with real numbers he can verify by hand
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8e533375-c955-49b0-8814-eb9d2ab88fa2
  modified: 2026-08-04T01:43:27.558Z
---

When I draw a diagram for Nick, a schematic (random-looking cells, "a vector of
weights", greyed grids showing shape only) is rejected as "so crude nobody can
understand it". What he wants instead, in this order:

1. Shrink the real problem to a size that fits on one screen (the 64x128 Q1_0
   tile became 8x8), keeping every structural property intact.
2. Put **real numbers** in it and state the answer, so a reader can check one
   row by hand.
3. Show the *problem* with those same numbers before showing the fix.
4. Only then draw the precise figure - and every later figure must reuse the
   same numbers so they cross-check each other.

**Why:** he reads a figure to verify a mechanism, not to get a vibe. Numbers he
can re-derive are the proof; a shape-only picture gives him nothing to check.

**How to apply:** generate figure values from a script that owns the ground
truth (one bit matrix + one input vector), never type them into the SVG by
hand, and add tests asserting each layout reproduces the same result. See
`example.py` / `test_example.py` in the Q1_0 page scratchpad for the pattern.
Also render the SVG to PNG (rsvg-convert with the CSS vars substituted) and
actually look at it - overlapping labels are invisible in source.

Related: [[q1_0-wide-vlen-repack-rowparallel]],
[[xandesvdot-nds-vd4dots-usable]], [[keep-writeups-scoped-to-the-optimization]]
