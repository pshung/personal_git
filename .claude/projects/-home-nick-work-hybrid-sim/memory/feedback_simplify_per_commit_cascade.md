---
name: feedback_simplify_per_commit_cascade
description: "Folding /simplify per-commit into a rebuilt history cascade-conflicts on hot files; this repo's code was already /simplify'd in dev so re-running yields little"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c9e7c269-d1c6-4820-a412-85e9970b1127
---

When asked to split commits one-purpose-per-commit AND run /simplify "for each commit":
the split is safe (cherry-pick -n + per-file/hunk staging from main, verify each split's
tree == the original commit's tree, final tree == original HEAD tree). But folding a
/simplify cleanup *into each commit* is usually the wrong tool here.

**Why:** (1) hot files (e.g. `hsim`, touched by ~8 commits) make a per-commit amend/cascade
rebuild conflict on every later commit that touches the same file. (2) This repo's branches
were ALREADY /simplify'd during development -- `df695d5`'s message says "fixes surfaced by
/simplify on the mode-consolidation branch" -- so a second pass finds almost nothing.

**How to apply:** prefer ONE /simplify pass over the final branch tip (`git diff main...HEAD`,
4 reviewers reuse/simplification/efficiency/altitude), land real cleanups as a single
`simplify:` commit. Conflict-free, catches cross-cutting issues, no wasted per-commit grind.
Only fall back to per-commit fold if the user insists and the code is genuinely un-cleaned.
The 2026-06 code-review refactor did exactly this (27->48 commits; split verified
byte-identical; one-pass simplify -> 2 hsim cleanups). Related: [[reference_hybrid_unit_test_host_build]].
