---
name: code-cleaner
description: Write C/C++ that stays cheap to maintain - keep each new function inside a complexity budget, land its unit test in the same change, and then prove it with a real gcov measurement instead of guessing. Use this skill whenever you are about to write or substantially rewrite C or C++ code (a new function, a new module, a refactor, a bug fix that adds branches), and whenever the user mentions complexity, cyclomatic complexity, CRAP score, code coverage, gcov/lcov/gcovr, "make this testable", "this function is getting long", "clean this up", or asks why something is hard to test. Also use it when a project has a coverage or CRAP gate in CI or in a Claude Code hook that has to pass before the work counts as done.
---

# code-cleaner

Code you write today gets read, debugged and changed by someone else - often you,
six months later, with none of the context. Two properties decide how expensive
that will be: how many paths the function has, and whether anything exercises
them. This skill keeps both under control **while you write**, not as a cleanup
pass afterwards.

## The one number

```
CRAP(f) = CC(f)^2 * (1 - coverage(f))^3 + CC(f)
```

`CC` = cyclomatic complexity (independent paths through the function).
`coverage` = fraction of the function's lines a test actually executed, 0.0-1.0.

Read it as: **complexity is a debt, tests are how you pay it down.** The cubic
term means a little coverage buys a lot of forgiveness, and the squared term
means complexity gets expensive fast. A function simple enough needs no tests at
all; a complicated one can never be paid off.

Budget: **CRAP <= 30 per function** (the conventional threshold). What that costs:

| CC of your function | coverage you then need |
|---|---|
| <= 5 | none - it passes untested |
| 6 | 13% |
| 8 | 30% |
| 10 | 42% |
| 15 | 59% |
| 20 | 71% |
| 25 | 80% |
| 30 | 100% |
| 31+ | **impossible** - no amount of testing helps |

The practical target when writing new code: **CC <= 10, with its test in the same
change.** That lands around CRAP 10-15 and leaves headroom for the next person
who has to add a branch.

## While you write

**Give each function one job.** The reliable way to lower CC is to move a
coherent piece of work out, not to shuffle branches around. If you can name the
extracted piece without using "and", it was a real seam.

**Extract loop bodies.** A loop wrapping 20 lines of conditional work is two
functions pretending to be one: the iteration, and the per-item decision. Split
that way and the per-item function becomes directly testable with no loop setup.

**Prefer a table to a branch chain.** Five `else if`s comparing the same variable
against constants is data written as control flow. A `static constexpr` array or
a map costs CC 1 plus a loop, and adding a case later costs nothing.

**Push branching to the edges.** Validate and normalise inputs at the boundary,
then let the core run straight through. Deep functions that take already-clean
data have few paths and are easy to test; functions that re-check their inputs at
every level multiply paths.

**Do not fragment to game the metric.** Splitting one coherent 12-branch function
into four 3-branch functions that only ever call each other in sequence makes the
number look better and the code worse - the reader now has to reassemble it. If
the complexity is genuinely irreducible, keep the function and cover it properly.
Some structures inflate CC without adding risk at all (lookup switches,
preprocessor blocks, flat guard clauses); when you hit one, read
`references/cc-judgment.md` before restructuring anything.

## Write the test in the same edit

Coverage is half the score and it is never cheaper than at the moment you write
the function - the branches are still in your head. Ten minutes later you will be
guessing at your own code.

The arithmetic is stark. A `CC = 10` function:

- with its test, hitting ~60% of lines: **CRAP 16** - fine
- with no test at all: **CRAP 110** - nearly four times over budget

So a "small, safe, untested helper" only stays small if CC <= 5. Above that,
write the test now.

Aim the test at the branches, not the line count. One call per distinct decision
outcome (including the error paths) covers far more than three calls down the
happy path. Error branches are usually the cheapest coverage available and the
most valuable, because they are the ones nobody exercises by hand.

## Verify before you call it done

Do not estimate CC or coverage - measure. The scripts are portable; they work in
any C/C++ repo, not just the one you are in.

```sh
SKILL=~/.claude/skills/code-cleaner

# 1. complexity of what you just wrote (no build needed, instant)
$SKILL/scripts/cc.sh path/to/file.cpp my_new_function

# 2. build with --coverage and run the tests (detects cmake/make/single-file,
#    caches its answer in .crap.conf so later runs need no thinking)
$SKILL/scripts/cov_build.sh

# 3. score only the functions this change touched
$SKILL/scripts/crap.sh --filter 'src/'
```

`crap.sh` defaults to `--diff HEAD`, i.e. exactly the functions in your
uncommitted work. That is the right scope: you are accountable for what you just
wrote, not for the whole repository.

Its output tells you which lever to pull:

```
FAIL: 1 function(s) over CRAP 30
  src/parser.cpp:88  parse_header  CRAP=63  ADD TESTS: 20% -> 55% coverage needed
  src/parser.cpp:210 dispatch_all  CRAP=45  SPLIT IT: CC=45 alone exceeds 30
```

`ADD TESTS` gives you the exact target. `SPLIT IT` means coverage cannot save it -
but check `references/cc-judgment.md` first, because a lookup switch or a block of
`#if` can produce that message while being perfectly healthy code.

Report the real numbers when you finish. "`parse_header` CC 8, 71% covered,
CRAP 12" is a fact the user can check; "cleaned up and added tests" is not.

## When the build fights you

Injecting `--coverage` is where this usually goes wrong, and the failures are
quiet rather than loud - you get 0% coverage and a CRAP score four times too
high, with no error message. `scripts/cov_build.sh` handles the common cases and
detects the classic traps. If it cannot work out how to build the project, or the
numbers look impossible, read `references/build-systems.md` - it covers per-build-
system flag injection, the stale-`.gcda` stamp mismatch, counter accumulation
across runs, and why `-O0` matters.

## Languages other than C/C++

The formula and the writing guidance are language-independent; only the
measurement tooling here is C/C++-specific (gcov + lizard). `lizard` already
handles Python, Java, JS/TS, Go, Rust and more, so `cc.sh` works unchanged - it is
the coverage half that needs the language's own tool (`coverage.py`, `jacoco`,
`c8`, `go test -cover`). If you are in another language, still hold the budget and
still write the test in the same change; substitute the coverage tool and compute
CRAP by hand from the two numbers.
