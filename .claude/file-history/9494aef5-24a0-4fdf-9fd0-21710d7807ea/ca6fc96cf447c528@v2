#!/usr/bin/env bash
# cc-log.sh - Lightweight Claude Code behavior logger
# Called by hooks with: cc-log.sh <log_name>
# Receives hook event JSON via stdin
# Appends structured JSONL to ~/.claude/logs/<log_name>.jsonl

LOG_NAME="${1:-$(date +%Y-%m-%d)}"
LOG_DIR="$HOME/.claude/logs"
LOG_FILE="$LOG_DIR/$LOG_NAME.jsonl"

mkdir -p "$LOG_DIR"

# Read full JSON from stdin; exit gracefully if empty
INPUT="$(cat)" || true
[ -z "$INPUT" ] && exit 0

# Extract fields with jq - single pass, omit nulls/empties
ENTRY=$(echo "$INPUT" | jq -c '{
  ts: (now | todate),
  session_id: .session_id,
  event: .hook_event_name,
  tool: .tool_name,
  tool_use_id: .tool_use_id,
  input: .tool_input,
  output: .tool_response,
  prompt: .prompt,
  source: .source,
  model: .model,
  agent_id: .agent_id,
  agent_type: .agent_type,
  cwd: .cwd,
  permission_mode: .permission_mode
} | with_entries(select(.value != null and .value != ""))' 2>/dev/null) || true

[ -z "$ENTRY" ] && exit 0

echo "$ENTRY" >> "$LOG_FILE"

exit 0
