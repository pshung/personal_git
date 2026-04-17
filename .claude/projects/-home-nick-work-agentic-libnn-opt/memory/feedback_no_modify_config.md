---
name: Do not modify config.toml
description: config.toml is owned by the user - LLM must never edit it, only report issues and suggest fixes
type: feedback
originSessionId: ea12630e-be28-4c4f-8ea0-3ea6d12ea8a2
---
Never modify `opt/config.toml` directly. It is the user's configuration file and untouchable by the LLM.

**Why:** The user explicitly corrected this. Config files are user-owned; the LLM should diagnose and report problems, not silently fix them.

**How to apply:** When validation finds a bad path or value in config.toml, print a clear error message with the fix suggestion. Exit and let the user make the change. This applies to any user-owned config/settings files in the project.
