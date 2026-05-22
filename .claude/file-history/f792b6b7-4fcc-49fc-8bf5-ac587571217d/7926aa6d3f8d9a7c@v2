---
name: feedback-roadmap-in-repo
description: "User reviews complex-task breakdowns as a task-named roadmap .md in the repo root, not the plan-mode plan file"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f792b6b7-4fcc-49fc-8bf5-ac587571217d
---

When planning a complex task in hybrid_sim, write the feature breakdown into a task-named roadmap markdown in the repo ROOT (e.g. `mode_consolidation.md`, sibling to `gemm_modes.md` and `driver_ROADMAP.md`), using their house format: per feature a `State` / `Depends on` / `Description` / `Key files` / `TDD`-or-`Verify` block; sections for Goal, Why, Scope (IN/OUT), Confirmed findings, Out of scope, Final verification, Risks, Progress log.

**Why:** The user reviews and edits the roadmap directly in-tree. A plan-mode plan file under `~/.claude/plans/` is hidden from them. In this session they rejected ExitPlanMode and said "write into a roadmap file for me to review," then edited the repo file heavily themselves.

**How to apply:** Even when invoked in plan mode, the reviewable deliverable is the repo roadmap file. Do not clobber the existing top-level `ROADMAP.md` (gem5-parity tracker) - create a new task-named file. One feature per session; update `State` as work lands.
