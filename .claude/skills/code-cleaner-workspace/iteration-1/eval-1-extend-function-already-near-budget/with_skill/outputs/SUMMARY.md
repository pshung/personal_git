# dispatch_event: TIMER + SHUTDOWN

## What changed

- `src/dispatch.hpp` - added `TIMER` and `SHUTDOWN` to `EventKind`. Nothing else;
  `Event`/`Queue` already carried `periodic` and `draining`.
- `src/dispatch.cpp` - restructured the `else if (e.kind == ...)` chain into
  per-kind handler functions plus a `constexpr` dispatch table, then added
  `apply_timer` and `apply_shutdown` as two more rows.
- `tests/dispatch_test.cpp` - rewrote as 13 named cases, one per decision
  outcome, including every reject path. The 5 original assertions are all still
  there, unchanged in meaning.
- `CMakeLists.txt` - **not modified** (copied to outputs unchanged for reference).

New behaviour, exactly as specified:

- `TIMER`: `e.a < 0` -> `-1`; `periodic` -> pushes the event back onto
  `q.pending` and returns 2; otherwise returns 1 and queues nothing.
- `SHUTDOWN`: `e.a < 0` -> `-1` and the queue is left open; otherwise it drains
  `q.pending`, sets `q.draining`, and returns the number it drained. The
  pre-existing `if (q.draining) return -1;` guard at the top of `dispatch_event`
  then rejects everything that arrives afterwards - covered by a test.

## Whether/how I restructured dispatch_event, and why

Yes - restructured first as a separate, behaviour-preserving step, then added the
two kinds on top.

The reason is a measured number, not a preference. The original function was
already at **CC 16**. Appending the two new kinds to the chain in place gives
**CC 21** (I wrote that version out and measured it; see `measurement.txt`,
"COUNTERFACTUAL" section). CC 21 needs **73% line coverage** just to stay under
the CRAP 30 budget, and it leaves the next person who adds an event kind with a
function that is one or two kinds away from being unfixable by testing at all
(CC >= 30 can never pass).

The chain was the specific shape the skill calls out: every arm compared the same
variable (`e.kind`) against a constant, and no arm shared state with any other -
data written as control flow. So the seam was real, not metric-gaming: each
extracted piece is nameable without an "and" (`apply_key`, `apply_mouse`,
`apply_resize`, `apply_paint`, `apply_focus`, `apply_timer`, `apply_shutdown`),
and adding an eighth kind is now a new function plus one table row, costing
`dispatch_event` **0 additional CC**.

`dispatch_event` keeps its public signature and its two genuinely global
concerns: the draining guard and picking a handler. The handlers live in an
anonymous namespace - they are implementation detail, so the header's API is
unchanged and the tests drive them through `dispatch_event`.

Order of work (structural before behavioural, verified at each step):

1. Measured the baseline.
2. Extracted the 5 existing arms into handlers + table. Rebuilt, ran the existing
   test suite - green, no behaviour change.
3. RED: added the enumerators and the TIMER/SHUTDOWN tests with no handlers
   behind them. Confirmed the failure was for the right reason -
   `dispatch_test.cpp:59`, `dispatch_event` fell through the table and returned 0
   instead of 2.
4. GREEN: added `apply_timer` + `apply_shutdown` + their two table rows.
5. Re-measured.

The two steps are separate in intent but the repo is left with a single
uncommitted working tree, as instructed.

## Numbers

All measured with the code-cleaner scripts. Raw output in `measurement.txt`.

```sh
SK=/home/nick/.claude/skills/code-cleaner/scripts

# complexity
$SK/cc.sh src/dispatch.cpp

# coverage build + test run (cmake detected, writes .crap.conf)
$SK/cov_build.sh

# CRAP over the functions this change touched (default --diff HEAD)
$SK/crap.sh --filter 'src/'
```

Baseline (git HEAD `2916c02`), measured with
`$SK/crap.sh --filter 'src/' --min-churn 0`:

| function | CC | cov | CRAP |
|---|---|---|---|
| `dispatch_event` (5 kinds) | 16 | 90.0% | 16 |

Counterfactual - the same two kinds appended to the chain, measured with
`$SK/cc.sh <scratch>/naive_dispatch.cpp dispatch_event`:

| function | CC | coverage it would then need |
|---|---|---|
| `dispatch_event` (7 kinds, one function) | 21 | 73% |

After (this change), `$SK/crap.sh --filter 'src/'`, budget 30:

| function | CC | cov | CRAP |
|---|---|---|---|
| `apply_mouse` | 4 | 100.0% | 4 |
| `dispatch_event` | 4 | 100.0% | 4 |
| `apply_timer` | 3 | 100.0% | 3 |
| `apply_resize` | 3 | 100.0% | 3 |
| `apply_key` | 3 | 100.0% | 3 |
| `apply_shutdown` | 2 | 100.0% | 2 |
| `apply_paint` | 2 | 100.0% | 2 |
| `apply_focus` | 2 | 100.0% | 2 |

`8 gated, 0 over budget`, `crap.sh` exit status 0. Worst function in the change:
CC 4, CRAP 4. Every function is at 100% line coverage, including all seven
reject-with-`-1` paths and the unknown-kind fallthrough (reached with
`static_cast<EventKind>(99)`, which is well defined for a scoped enum with a
fixed underlying type).

Test suite: `ctest --test-dir build-coverage --output-on-failure` -> 1/1 passed.

Note on the test file: it starts with `#undef NDEBUG` before `<cassert>`, so the
assertions cannot be silently compiled out in a release-flavoured build.
`crap.py` excludes `/tests?/` from scoring by default, so no test-side numbers
appear above.
