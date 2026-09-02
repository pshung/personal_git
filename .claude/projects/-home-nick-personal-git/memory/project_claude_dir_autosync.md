---
name: claude-dir-autosync
description: "~/.claude is a symlink into ~/personal_git/.claude and an hourly cron commits \"Sync all local changes\" - anything left on disk gets committed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04c1f324-fd43-4ce3-9d97-b88baf6949a8
  modified: 2026-09-02T08:06:57.709Z
---

`/home/nick/.claude` is a symlink to `/home/nick/personal_git/.claude`. The
`personal_git` repo has an hourly job (observed 14:30, 15:00, 16:00 on
2026-09-02) that runs `git add -A` and commits "Sync all local changes".

**Why:** Any file left in the tree - `__pycache__/`, build output, scratch
copies - is committed within the hour, with no review. Conversely, I never need
to commit agent/skill edits myself; the sync does it.

**How to apply:** Keep scratch work in the session scratchpad, not under
`~/.claude`. Delete `__pycache__` after running Python tests there, or make sure
a `.gitignore` covers it (the code-cleaner agent dir has one). Do not run
`git commit` in this repo unless asked. See also [[git-exclude-list]].
