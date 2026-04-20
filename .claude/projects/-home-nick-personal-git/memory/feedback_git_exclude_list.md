---
name: Git commit exclusion list
description: Files and directories that must never be staged or committed to git in this repo
type: feedback
originSessionId: 785f3a62-2fbd-44b9-9f52-72eaae6b710f
---
Never commit any of the following to git:

- `.claude.json`
- `cache`
- `debug`
- `file-history`
- `logs`
- `paste-cache`
- `plans`
- `plugins`
- `projects`
- `session-env`
- `sessions`
- `shell-snapshots`
- `statsig`
- `tasks`
- `telemetry`
- `todos`

**Why:** User explicitly requested exclusion of all items above. These are local artifacts that don't belong in version control.

**How to apply:** When staging files for a commit, check every file path against this list. Exclude any file or directory matching these names. Use specific `git add <file>` commands rather than `git add -A` or `git add .`.
