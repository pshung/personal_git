---
name: guards-not-arithmetic
description: When code computes a value to satisfy a threshold, check whether the threshold was a guard - satisfying it every time deletes it.
metadata:
  type: feedback
---

While sizing a container's `/dev/shm` from `--mem-size` (issue #20), I treated
the driver's 256 MiB `kMmapSafetyMargin` as arithmetic to satisfy. Nick asked
"速度會變慢?" and then "我在意的是什麼?" — twice — because I kept answering the
surface question with measurements.

What he cared about: the margin is the trigger for the driver's **tier
fallback** (`/dev/shm` -> `~/.cache/andesim` on disk). Feeding it exactly what
it asks for, every time, means the fallback can never fire. A run too big for
RAM stopped degrading to slow and started OOM-killing the machine. That became
issue #28.

**Why:** a threshold that is always satisfied is not a threshold. The
protection lived in the *possibility of failing the check*, not in the number.

**How to apply:** before writing code that computes an input to someone else's
check, ask what that check does when it FAILS. If failing has a designed
consequence (fall back, refuse, warn), preserve a path to it — cap, or leave
the check a real decision. Applies to disk/memory budgets, retry limits,
timeouts, quota checks.

Nick's questions are usually about the mechanism, not the number. When he asks
the same thing twice, stop measuring and re-read what the number protects.
See [[log-first-debugging]].
