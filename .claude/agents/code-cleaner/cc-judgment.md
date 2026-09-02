# When the numbers are not a problem

Read this when `crap.sh` says `FLAT` or `SPLIT IT`, when a function's CC looks
alarming and you are about to restructure it, or when the coverage a function
needs looks impossible to reach.

Both metrics measure the source text. Neither can tell whether a branch is a real
decision a reader has to hold in their head, or whether a test could ever take
it. Restructuring working code, or faking a test, to satisfy a number that was
never measuring risk makes the code worse and costs the user time.

## Complexity: CC versus cog

Cyclomatic complexity (CC) counts decision points. Cognitive complexity (cog,
from clang-tidy) counts how hard they are to follow: nesting is penalised, a flat
`switch` costs 1 no matter how many cases, `a && b && c` costs 1. So the two
numbers disagree exactly on the shapes that fool CC:

```
$ cc.sh src/dispatch.cpp
  CC  cog  ...  function
  16   22       dispatch_event     <- nested else-if with state: a tangle
$ cc.sh src/opcode.cpp
  11    1       opcode_name        <- 10 case labels: a table
```

**The rule: cog <= 15 is not a tangle, whatever CC says.** `crap.sh` applies it
for you - a function over budget with cog <= 15 gets `FLAT`, not `SPLIT IT`.

If clang-tidy is missing (cog shows `-`), fall back to counting by hand:

```sh
sed -n '<start>,<end>p' <file> | grep -cE '^\s*case '                  # switch cases
sed -n '<start>,<end>p' <file> | grep -cE '^\s*#\s*(if|elif|ifdef)'    # preprocessor
sed -n '<start>,<end>p' <file> | grep -cE '^\s*(if|for|while)\s*\('    # real branches
```

### Shapes that inflate CC without adding risk

**Lookup switch.** Every case is a flat `case X: return Y;`. A table spelled as a
switch. Adding a row costs +1 CC and +0 risk. Real example: a CSR-to-capability
mapping with 38 cases scored CC 70, cog 1.

**Preprocessor conditionals, and `if constexpr`.** A high `#if` count with zero
runtime branches means the compiled function is straight-line code. The other arm
does not exist in this build, so no test can cover it and no restructuring
changes what runs. Real example: 27 `#if` blocks, 0 runtime branches, CC 28.

**Flat guard clauses.** A run of independent `if (!x) return err;` at the top.
Each costs +1 CC but they do not interact. This is *good* practice.

**`&&` / `||` inside one condition.** `if (a && b && c && d)` is one decision
point that costs 4 CC and 1 cog.

**Macro-expanded bodies.** An X-macro list expanding to N copies of the same `if`
is one branch you wrote once and maintain once.

### What a real signal looks like

The CC comes from nested, interacting `if`/`for`/`while` that carry state across
the function - variables set in one branch and read in another, loops whose exit
condition depends on what happened inside. cog is high there because that is
exactly what it penalises. If you drew the paths, would they be parallel lines or
a tangle? Parallel is fine at any width. A tangle is a problem at CC 12.

## Coverage: branches no test can take

A function inside the CC budget can still be over CRAP because of branches that
are genuinely unreachable from a test. Recognise them before you write anything:

- **Allocation failure.** `if (!buf) return -ENOMEM;` after `malloc`. Forcing it
  needs a malloc shim in production code or `--wrap` in the link, and both change
  what ships.
- **The other `#ifdef` arm.** `#ifdef _WIN32` on Linux does not compile, so it
  has no counters at all. It is not uncovered; it does not exist in this build.
- **Syscall errors you cannot provoke.** `fclose` failing, `write` returning
  `EIO`, `clock_gettime` failing.
- **`default:` over a closed enum**, and `assert`/`unreachable()` arms.
- **Hardware fault paths** in embedded code - a bus error, a watchdog reset.

What to do: cover every branch that *is* reachable (bad arguments, missing file,
truncated input, bad checksum - these are also where real bugs live), then name
the leftover branch in the report with its line and the reason. CC 12 needs 50%
branch coverage for CRAP 30; the reachable branches nearly always exceed that.

What never to do: delete the defensive branch, add a fault-injection macro or
global to production code, `#if 0` it under test, or raise `--max`. If the
reachable branches are all covered and the function is still over budget, that
is a justified leftover - report it as such, with the numbers.

## Writing it up

One line per leftover, with the evidence:

> `opcode_name` CC 41 / cog 1: 40 flat `case X: return Y;` labels - a lookup
> table, not a tangle. Leaving it.

> `store_open` CC 12 / cog 9, branch cov 89%: the one uncovered branch is
> `malloc` failing at line 31; not reachable from a test. Leaving it.

Never widen `--max` to make the gate pass. The threshold is not the thing that
was wrong; adjusting it hides the genuine failures alongside the false ones, and
whoever inherits the gate will no longer trust it.
