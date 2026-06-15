---
name: feedback_limitations_notebook_routing
description: "A current capability gap belongs in docs/andes_sim_limitations.ipynb as an L-id, not only in the design/roadmap doc"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6086fd68-869d-4527-a614-a165ec39b449
---

When a cosim/hybrid capability gap is identified, document it in
`docs/andes_sim_limitations.ipynb` as a new L-numbered entry (add to the
right Tier cell AND the Quick-reference table at the end), even if a design
doc like `cosim_redesign.md` already describes the planned fix.

**Why:** the user treats the limitations notebook as the canonical,
user-facing "what does not work today" list (the source of L-ids); a
roadmap/design doc is the *plan to fix*, not the *current-limitation*
record. Putting a gap only in the design doc means it is invisible where
people actually look for limits. Twice in one session I scoped a cosim doc
change to `cosim_redesign.md` alone and the user asked why it was not in the
limitations notebook.

**How to apply:** a "current limitation" change usually touches several
docs at once - `docs/andes_sim_limitations.ipynb` (the L-id entry, framed as
OPEN/PARTIAL/etc.), the design doc (the fix plan, as F-features), and
`docs/USER_GUIDE.md` (always, per CLAUDE.md). Cross-link them (cite the
F-features and the design-doc section from the L entry). New entries take
the next free L number (L16/L17 are removed, so the max in use is the
ceiling). See [[project_cosim_roi]] and [[feedback_roadmap_in_repo]].
