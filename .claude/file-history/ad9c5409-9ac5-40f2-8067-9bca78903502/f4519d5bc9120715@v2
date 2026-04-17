---
name: Never commit system.log
description: Never commit opt/log/system.log or rotated system.log.* files to git
type: feedback
originSessionId: ad9c5409-9ac5-40f2-8067-9bca78903502
---
Never commit system.log files (opt/log/system.log or opt/log/system.log.*) to git.

**Why:** These are ephemeral run logs, not source artifacts. User explicitly requested this.

**How to apply:** When staging files for commit, always exclude opt/log/system.log* files.
