---
name: refactor-means-rewrite-history
description: "When the user says \"refactor commits from X to HEAD, one commit per feature\", they mean REWRITE the range's history, not add new commits on top."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 74703997-b28c-4574-b276-0458d50a0379
---

When this user asks to "refactor the commits from <sha> to HEAD" with "one
commit for one feature", they want the existing range **rewritten** -- the
messy commits squashed/regrouped into one clean commit per feature -- NOT
additive commits stacked on top of the original history.

**Why:** I first read it as "additive" (keep the original 95 commits, stack new
`simplify(...)` commits on top). The user corrected: "you misunderstand... I
want you refactor the commits... Separate each feature as a commit." The end
state they want is a clean linear history of feature commits, not the original
mess plus extras.

**How to apply:** For "refactor range into one-commit-per-feature": reset a
working branch to the range's base, then lay down one commit per feature with
content checked out from the verified-green tip, so the rewritten tip tree is
byte-identical to the tip you trust (assert `git diff --quiet <tip> <branch>`).
Always keep backup refs of the original history before rewriting. If a follow-up
step is "run /simplify per feature", fold its cleanup into each feature commit
(unless the user wants a separate before/after pair). See [[ask-before-destructive-history-rewrite]].
