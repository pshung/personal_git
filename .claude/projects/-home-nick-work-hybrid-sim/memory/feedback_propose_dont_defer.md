---
name: feedback-propose-dont-defer
description: "When a design question has a clear best answer, propose it; do not defer to the user via multiple AskUserQuestion rounds"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: aaa0233d-e63b-482c-aef4-485612957b50
---

Propose a decisive recommendation when you have enough information to do so. Do not stack `AskUserQuestion` rounds for design questions whose answer you should already know.

**Why:** During F13 planning the user said "I didn't get a sound solution. think hard" after I asked them to pick between fallback policies (probe vs env-only vs best-effort) without first stating which one I recommended. They wanted me to do the thinking, then offer a clear position they could push back on, not to act as a menu.

**How to apply:**
- For design choices, the format is: state the recommendation as line 1, then the reasoning, then "objections?" -- not 3 options of equal weight.
- `AskUserQuestion` is for choices where the user has private info I cannot infer (their disk layout, their team's preferences, their priorities). It is NOT for choices where I can reason from first principles.
- If I find myself asking the same kind of question twice in a turn, that is the signal to stop and propose.
- When the user says "think hard" or "propose a comprehensive solution," they are explicitly asking me to commit to a position. Honor it.
