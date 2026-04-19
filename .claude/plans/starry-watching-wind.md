# Plan: Human/LLM-readable cc-log format

## Context

Current cc-log outputs JSONL - dense single-line JSON that's hard to scan and wastes tokens when an LLM reads it. The PostToolUse entries include entire file contents in the output field (e.g., a 216-line settings.json fully serialized). The purpose of this log is for an LLM to read session behavior and improve harness code, so the format should be concise, scannable, and focused on the action flow.

## Format Design

No timestamps. Plain text. One line per event. Tool-specific input summarization. Truncated outputs.

```
== SessionStart | session=2d7369bd | model=claude-opus-4-6[1m] | cwd=/home/nick/personal_git ==

UserPromptSubmit | "/cc-log enable test2"

PreToolUse Read | file="/home/nick/.claude/settings.json"
PostToolUse Read | ok | file="/home/nick/.claude/settings.json" | 216 lines

PreToolUse Bash | cmd: jq '...' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv ...
  desc: Switch cc-log hooks from "test" to "test2"
PostToolUse Bash | ok

PostToolUseFailure Bash | cmd: invalid_command
  stderr: command not found

PreToolUse Agent | desc="Print hello" | type=general-purpose
  prompt: Print "hello" using the Bash tool.
SubagentStart | id=a4aec043c | type=general-purpose
  [subagent] PostToolUse Bash | ok | cmd: echo "hello" | stdout: hello
SubagentStop | id=a4aec043c

Stop

== SessionEnd ==
```

### Tool input summarization rules (in cc-log.sh)

| Tool | Key fields shown |
|------|-----------------|
| Bash | `command` (truncated 200 chars), `description` on next line if present |
| Read | `file_path` |
| Edit | `file_path` |
| Write | `file_path` |
| Grep | `pattern`, `path` |
| Glob | `pattern`, `path` |
| Agent | `description`, `subagent_type`, and **full `prompt`** on next line (never truncated - this is the key data for understanding subagent behavior) |
| Other | full input JSON, truncated 200 chars |

### Subagent nesting

Events with `agent_id` field are from subagents. Prefix with `[subagent:<short_id>]` so the hierarchy is visible.

### Tool output summarization rules

| Case | What to show |
|------|-------------|
| Read ok | line count from output |
| Bash ok | stdout first 200 chars if non-empty, stderr if non-empty |
| Edit/Write/Grep/Glob ok | just "ok" |
| Any failure | error text, truncated 500 chars |

## Files to modify

1. **`~/.claude/skills/cc-log/cc-log.sh`** - Rewrite output formatting from JSONL to plain text
   - Drop `jq -c` JSON construction
   - Use bash string formatting with case/switch for tool-specific summarization
   - Truncate long strings with `cut -c1-200`
   - File extension: `.log` instead of `.jsonl`

2. **`~/.claude/skills/cc-log/SKILL.md`** - Update:
   - Log Entry Schema section - replace JSON schema with plain text format description
   - File extension refs: `.jsonl` -> `.log`
   - List procedure: glob `*.log` instead of `*.jsonl`
   - Analyze procedure: use grep/awk instead of jq (or note it's designed for LLM reading, not programmatic analysis)
   - Tail procedure: plain `tail -20` instead of `tail | jq`
   - Enable confirmation message: `.log` extension

## Verification

1. Enable logging: `/cc-log enable format-test`
2. Perform a few tool calls (Read, Bash, Agent)
3. Read `~/.claude/logs/format-test.log` and verify human readability
4. Confirm no timestamps in output
