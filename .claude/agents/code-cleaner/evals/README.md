# Regression tests for the code-cleaner agent

Exists so that editing `../code-cleaner.md` is a measured change rather than a
guess. Four scenarios, each a small git repo, each chosen to catch a different
failure mode. The scripts themselves have unit tests in `../tests/`
(`python3 -B -m unittest discover -s ../tests`), which is where tool bugs such as
the silent pass on an empty gated set are caught - run those first, they take
seconds.

| fixture | scenario | what it catches |
|---|---|---|
| `fixtures/a-config-parser` | write an INI parser from scratch | does new code land inside the budget, with tests? |
| `fixtures/b-extend-dispatch` | add 2 event kinds to a CC-16 function | does it restructure, or just grow the else-if chain? |
| `fixtures/c-opcode-table` | add 30 opcodes to a lookup mapping | **inverse test** - does it wrongly fragment a flat table to make a number move? |
| `fixtures/d-unreachable-coverage` | cover a CC-12 loader with a malloc-failure branch and an `#ifdef _WIN32` arm | **inverse test** - does it fake or delete unreachable branches to hit a coverage number, or cover the reachable ones and report the rest as left alone? |

`c-opcode-table` and `d-unreachable-coverage` are the important ones. An agent
that splits a lookup table into `_arith`/`_load`/`_branch` helpers, or that
`#define`s `malloc` in production code to reach an `-ENOMEM` branch, has scored
better and made the code worse; if a future edit to the agent starts doing that,
these are what notice. `d` has not been run against a baseline yet.

## Re-running

1. Copy each fixture into a scratch dir (they must stay pristine).
2. Spawn the agent on each copy with the prompt from `evals.json`, and a second
   run without the agent as the baseline.
3. `python3 grade.py <iteration-dir>` writes `grading.json` per run. It builds,
   runs the tests, and measures CC/CRAP for real rather than reading the report.
4. Compare against `baseline-2026-09-02/benchmark.json`.

Expected layout for step 3: `<iteration-dir>/<eval-name>/{with_skill,without_skill}/repo`
plus an `eval_metadata.json` per eval (copies are in `baseline-2026-09-02/`).

## What the 2026-09-02 baseline showed

100% (14/14) with the agent vs 93% (13/14) without, which is **not** the
interesting number. The three tasks were run under a global CLAUDE.md that already
says "reduce CRAP score, reduce Cyclomatic Complexity" and that switch-case and
guard clauses are acceptable - so the baseline was already well guided and most
assertions were non-discriminating.

The real differences the pass rate hides:

- delivered max CC 5 vs 7 (eval-0) and 4 vs 9 (eval-1)
- the baseline hand-rolled its own coverage build and, in eval-0, computed CC and
  coverage separately but never combined them into a CRAP figure
- 92s faster with the agent, because the measurement was tooled rather than
  improvised
- eval-2 was identical in both arms: neither fragmented the table

Read that as: the value is in the tooling and the measurement discipline, not in
the advice. Keep future edits pointed at that.
