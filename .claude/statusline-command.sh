#!/bin/sh
# Claude Code status line - mirrors Powerlevel10k p10k prompt style
# Shows: user@host  dir  git-branch  model  context%

input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
model=$(echo "$input" | jq -r '.model.display_name')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# Shorten home directory to ~
home="$HOME"
short_cwd=$(echo "$cwd" | sed "s|^$home|~|")

# Git branch (skip optional locks to avoid blocking)
git_branch=""
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" -c core.fsmonitor=false symbolic-ref --short HEAD 2>/dev/null \
           || git -C "$cwd" -c core.fsmonitor=false rev-parse --short HEAD 2>/dev/null)
  if [ -n "$branch" ]; then
    git_branch=" \033[0;33m $branch\033[0m"
  fi
fi

# Context percentage with progress bar
ctx_part=""
if [ -n "$remaining" ]; then
  remaining_int=$(printf "%.0f" "$remaining")
  used_int=$((100 - remaining_int))
  if [ "$remaining_int" -le 20 ]; then
    ctx_color="\033[0;31m"   # red when low
  elif [ "$remaining_int" -le 40 ]; then
    ctx_color="\033[0;33m"   # yellow when medium
  else
    ctx_color="\033[0;32m"   # green when plenty
  fi
  # 10-char bar: filled blocks for used, dashes for remaining
  filled=$((used_int / 10))
  empty=$((10 - filled))
  bar=""
  i=0
  while [ $i -lt $filled ]; do
    bar="${bar}#"
    i=$((i + 1))
  done
  i=0
  while [ $i -lt $empty ]; do
    bar="${bar}-"
    i=$((i + 1))
  done
  ctx_part=" ${ctx_color}[${bar}] ${used_int}%\033[0m"
fi

printf "\033[0;36m$(whoami)@$(hostname -s)\033[0m  \033[0;34m${short_cwd}\033[0m${git_branch}  \033[0;35m${model}\033[0m${ctx_part}"
