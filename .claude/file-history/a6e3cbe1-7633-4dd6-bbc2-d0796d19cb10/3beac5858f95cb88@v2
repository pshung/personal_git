# When high complexity is not a problem

Read this when `crap.sh` says `SPLIT IT`, or when a function's CC looks alarming
and you are about to restructure it.

Cyclomatic complexity counts decision points **in the source text**. It cannot
tell the difference between paths that genuinely interact and paths that are
flat, repetitive, or resolved before the program even runs. Restructuring working
code to satisfy a number that was never measuring risk makes the code worse and
costs the user time.

So before you touch anything, find out what the CC is actually made of:

```sh
sed -n '<start>,<end>p' <file> | grep -cE '^\s*case '                  # switch cases
sed -n '<start>,<end>p' <file> | grep -cE '^\s*#\s*(if|elif|ifdef)'    # preprocessor
sed -n '<start>,<end>p' <file> | grep -cE '^\s*(if|for|while)\s*\('    # real branches
```

(`cc.sh` prints the line range you need for `<start>,<end>`.)

## The patterns that inflate CC without adding risk

**Lookup switch.** Most of the CC is `case` labels and every case is a flat
`case X: return Y;`. This is a table that happens to be spelled as a switch.
Adding a row costs +1 CC and +0 risk; there is no state, no fall-through, no
interaction between cases. Real example: a CSR-to-capability mapping with 38
cases scored CC 70 and had not been meaningfully edited in months.

**Preprocessor conditionals, and `if constexpr`.** A high `#if` count with zero
runtime branches means the compiled function is straight-line code. The other arm
does not exist in this build, so no test can ever cover it and no amount of
restructuring changes what runs. Real example: a config-to-capabilities function
with 27 `#if` blocks and 0 runtime branches scored CC 28.

**Flat guard clauses.** A run of independent `if (!x) return err;` at the top of a
function. Each costs +1 CC but they do not interact - the reader checks them one
at a time and moves on. This shape is *good* practice, not a defect.

**`&&` / `||` inside one condition.** `if (a && b && c && d)` is one decision
point that costs 4 CC.

**Macro-expanded bodies.** An X-macro list expanding to N repetitions of the same
`if` is one branch that you wrote once and will maintain once.

## What a real signal looks like

The CC comes from nested, interacting `if`/`for`/`while` that carry state across
the function - variables set in one branch and read in another, loops whose exit
condition depends on what happened inside. That is the case where a reader cannot
hold the function in their head and where tests genuinely cannot reach every
combination.

The check that separates the two cases: **if you drew the paths, would they be
parallel lines or a tangle?** Parallel is fine at any width. A tangle is a
problem at CC 12.

## What to do

If it is a false positive, say so in one line with the three counts that support
it, then move on:

> `andes_gate_for` CC 70 is 38 flat `case X: return Y;` labels and 2 real
> branches - a lookup table, not a tangle. Leaving it.

If it is real, split it - and split along a seam you can name, not to make the
number smaller.

Never widen `--max` to make the gate pass. The threshold is not the thing that
was wrong; adjusting it hides the genuine failures alongside the false ones, and
whoever inherits the gate will no longer trust it.
