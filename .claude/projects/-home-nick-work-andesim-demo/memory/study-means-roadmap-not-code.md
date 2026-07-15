---
name: study-means-roadmap-not-code
description: "When Nick asks to \"study\" something, deliver ROADMAP.md entries, not an implementation plan or code"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 798f9a59-fde8-4df6-abe5-7a5c54809031
---

2026-07-15: Asked to "study what demos we could move" into andesim-demo, I planned to port two demos in one session. Nick rejected the plan with "write a testing demo ROADMAP file" and "don't implement any item."

**Why:** His global convention is ROADMAP-driven work - a study produces entries (name, description, key files, deps, state); implementation happens later, strictly ONE entry per session.

**How to apply:** For "study/evaluate/compare" requests in andesim-demo, write findings as entries in the existing [[ROADMAP.md]]-style file (andesim-demo/ROADMAP.md, numbered entries with State/Modes/Key files/Pass/Deps) and record not-portable/no-port verdicts so the study is not redone. Do not start implementation, do not bundle multiple features.
