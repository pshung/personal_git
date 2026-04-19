---
name: cc-log
description: >
  Lightweight system log to record all Claude Code behavior (tool use, subagent creation,
  compaction, permissions, session lifecycle) for analysis. Use when the user wants to
  enable/disable behavior logging, analyze Claude Code session logs, list saved logs,
  or understand Claude Code's tool usage patterns. Trigger on: "cc-log", "behavior log",
  "system log", "record behavior", "log enable", "log disable", "analyze log".
argument-hint: "enable [name] | disable | status | list | analyze [name] | tail [name]"
allowed-tools: Read, Bash, Edit, Write, Glob, Grep, Agent
---

# cc-log: Claude Code Behavior Logger

Records all Claude Code behavior via async hooks for offline analysis.

## Commands

- `/cc-log enable [name]` - Start logging. Name defaults to today's date (YYYY-MM-DD).
- `/cc-log disable` - Stop logging (removes hooks from settings.json).
- `/cc-log status` - Show whether logging is active and current log name.
- `/cc-log list` - List all saved logs with sizes and line counts.
- `/cc-log analyze [name]` - Analyze a named log (tool frequency, agent stats, timelines).
- `/cc-log tail [name]` - Show last 20 entries of a log.

Arguments received: `$ARGUMENTS`

## Argument Dispatch

Parse `$ARGUMENTS`:

1. `enable [name]` - run Enable procedure
2. `disable` - run Disable procedure
3. `status` - run Status procedure
4. `list` - run List procedure
5. `analyze [name]` - run Analyze procedure
6. `tail [name]` - run Tail procedure
7. Empty - run Status procedure

## Constants

```
LOGGER_SCRIPT="$HOME/.claude/skills/cc-log/cc-log.sh"
SETTINGS_FILE="$HOME/.claude/settings.json"
LOG_DIR="$HOME/.claude/logs"
HOOK_TAG="cc-log"
```

## Hook Events

The following events are logged. All use the same hook entry pattern:

**Core lifecycle**: SessionStart, SessionEnd
**Per-turn**: UserPromptSubmit, Stop, StopFailure
**Per-tool-call**: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied
**Agent**: SubagentStart, SubagentStop, TaskCreated, TaskCompleted
**Context**: PreCompact, PostCompact
**Reactive** (optional - not enabled by default): FileChanged, CwdChanged, Notification, WorktreeCreate, WorktreeRemove, InstructionsLoaded, ConfigChange, Elicitation, ElicitationResult, TeammateIdle

The Enable procedure installs the core, per-turn, per-tool-call, agent, and context events (16 hooks). Reactive events can be added manually if needed.

## Enable Procedure

1. Parse the log name from arguments. If none given, use today's date (`date +%Y-%m-%d`).
2. Read `$SETTINGS_FILE` with the Read tool.
3. If a `hooks` key already has entries with `cc-log` in the command, inform user logging is already active and show current log name. Offer to switch to the new name.
4. Build the hooks object. Every hook entry follows this pattern:

```json
{
  "type": "command",
  "command": "$LOGGER_SCRIPT \"<LOG_NAME>\"",
  "async": true
}
```

5. Use Bash with jq to atomically merge hooks into settings.json (see Merge Strategy below). The 16 default events are:

SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, Stop, StopFailure, PermissionRequest, PermissionDenied, TaskCreated, TaskCompleted

6. CRITICAL: Preserve all existing settings (permissions, model, statusLine, plugins, etc.). Only add/replace the `hooks` key. If `hooks` already exists with non-cc-log entries, merge - do NOT overwrite other hooks.
7. Confirm to user: "Logging enabled. Log: `~/.claude/logs/<LOG_NAME>.jsonl`"
8. Note: hooks take effect on next session or after `/hooks refresh`.

## Disable Procedure

1. Read `$SETTINGS_FILE`.
2. Use Bash with jq to atomically remove all hook entries whose `command` contains `cc-log`.
3. If a hook event array becomes empty after removal, remove the entire key.
4. If `hooks` object becomes empty, remove the `hooks` key entirely.
5. Confirm: "Logging disabled. Existing logs preserved in `~/.claude/logs/`."

## Status Procedure

1. Read `$SETTINGS_FILE`.
2. Check if any hook entry contains `cc-log` in its command.
3. If found, extract the log name from the command string and report:
   - Active: yes/no
   - Log name: <name>
   - Log file: <path>
   - Log size: <bytes/lines>
4. If not found, report logging is inactive.

## List Procedure

1. Run: `ls -lh $LOG_DIR/*.jsonl 2>/dev/null`
2. For each file, count lines: `wc -l`
3. Display as table: Name | Lines | Size | Last Modified

## Analyze Procedure

1. If no name given, use the most recent log file.
2. Read the JSONL file.
3. Produce analysis with jq:
   - **Event distribution**: count per event type
   - **Tool usage**: frequency of each tool, sorted descending
   - **Subagent stats**: count, agent types
   - **Compaction events**: count
   - **Timeline**: first and last event timestamps, total duration
   - **Permission events**: what was requested, what was denied
   - **Error rate**: PostToolUseFailure / total PostToolUse
   - **Session count**: unique session_ids

4. Present as a concise markdown report.

## Tail Procedure

1. If no name given, use the most recent log or active log.
2. Run: `tail -20 $LOG_DIR/<name>.jsonl | jq .`
3. Display formatted output.

## Merge Strategy for settings.json

Use jq in Bash for atomic read-modify-write. This is safer than manual Edit for complex JSON merges.

**Enable** - add cc-log hooks (preserving existing non-cc-log hooks):

```bash
LOGGER_SCRIPT="$HOME/.claude/skills/cc-log/cc-log.sh"
SETTINGS_FILE="$HOME/.claude/settings.json"
LOG_NAME="<LOG_NAME>"
EVENTS="SessionStart SessionEnd UserPromptSubmit PreToolUse PostToolUse PostToolUseFailure SubagentStart SubagentStop PreCompact PostCompact Stop StopFailure PermissionRequest PermissionDenied TaskCreated TaskCompleted"

CMD="$LOGGER_SCRIPT \"$LOG_NAME\""
FILTER='.hooks //= {}'
for evt in $EVENTS; do
  FILTER="$FILTER | .hooks.${evt} //= [] | .hooks.${evt} += [{\"type\":\"command\",\"command\":\$cmd,\"async\":true}]"
done

jq --arg cmd "$CMD" "$FILTER" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
```

**Disable** - remove cc-log hooks (preserving other hooks):

```bash
jq '
  if .hooks then
    .hooks |= with_entries(
      .value |= map(select(.command | tostring | contains("cc-log") | not))
      | select(.value | length > 0)
    )
    | if (.hooks | length) == 0 then del(.hooks) else . end
  else . end
' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
```

## Log Entry Schema

Each line in the JSONL log:

```json
{
  "ts": "2026-04-19T14:32:01Z",
  "session_id": "abc123",
  "event": "PostToolUse",
  "tool": "Bash",
  "tool_use_id": "toolu_abc123",
  "input": {"command": "npm test", "description": "Run tests"},
  "output": "(tool response, may be truncated)",
  "prompt": "(user prompt text, UserPromptSubmit only)",
  "source": "(session source, SessionStart only: startup|resume|clear|compact)",
  "model": "(model name, SessionStart only)",
  "agent_id": "(subagent id, SubagentStart/SubagentStop only)",
  "agent_type": "(subagent type, SubagentStart/SubagentStop only)",
  "cwd": "/home/nick/project",
  "permission_mode": "default"
}
```

Fields are omitted when null/empty to keep logs compact. Most entries will only have a subset of these fields depending on the event type.

## Design Principles

- **Zero interference**: All hooks are async with exit code 0. No stdout. Claude never sees the logger. cc-log.sh uses graceful error handling (no `set -e`) so failures are silent.
- **Portable**: Uses `$HOME` everywhere. No hardcoded paths in SKILL.md.
- **Atomic**: jq read-modify-write prevents settings corruption.
- **Incremental**: Multiple enables with different names are allowed (just switches the active log name).
- **Non-destructive**: Disable never deletes log files. Only removes hooks.
