# Plan: Meta-Harness Redesign of `/optimize` (Self-Improving Skill)

## Context

The current `/optimize` skill runs a 7-step FSM (validate -> select -> analyze -> implement -> verify -> measure -> learn) that optimizes one libnn function per pass. It logs per-function outcomes to `state.json` and wiki pages, but **it never improves itself**: the subagent prompts, the uarch reference, the intrinsic docs, the FSM transition rules are all frozen human-written text. Every new function starts the same way with the same priors.

**Meta-Harness concept:** the skill (= the "harness" around a fixed LLM) is itself the optimization target of an outer loop.

- Inner loop: optimize a libnn function. Unchanged.
- Outer loop: log every subagent decision + trace + score to the filesystem; a meta-agent reads the traces, diagnoses failure patterns, and rewrites the skill source (SKILL.md, subagent prompts, references). Pareto-dominant proposals are accepted; regressions are git-reverted.
- Flywheel: better skill -> better hypotheses -> better traces -> sharper meta-diagnosis.
- Compound effect: `references/learned_heuristics.md` grows over generations, Pareto frontier preserves wins, trace corpus accumulates evidence.

The LLM is fixed. Only the harness evolves.

---

## Core Architecture (review this section)

### A. Instrumented inner loop (trace emission)

No FSM change. Each existing step also writes structured trace files.

```
.claude/skills/optimize/
├── SKILL.md                          (live harness; modified by meta-agent)
├── config.toml                       (+ new [meta_loop] section)
├── script/
│   ├── emit_trace.sh                 NEW: structured subagent-I/O capture
│   ├── meta_evaluate.sh              NEW: run eval_set with a given harness
│   ├── aggregate_traces.py           NEW: summarize trace_corpus for critic
│   ├── meta_pareto.py                NEW: Pareto frontier maintenance
│   └── meta_guard.sh                 NEW: auto-revert watchdog
├── references/
│   ├── uarch/andes_45_series.md      (existing; meta-agent may append)
│   ├── intrinsic_api/nds_vec_macros.md (existing)
│   └── learned_heuristics.md         NEW: cross-function lessons (grows over time)
├── fpga_config/                      (existing, untouched)
├── harness_eval_set.toml             NEW: 3-5 canonical functions + baseline cycles
├── harness_generations/              NEW: versioned skill snapshots
│   ├── gen_000/                      initial snapshot (bootstrap)
│   │   ├── SKILL.md
│   │   ├── references/ (full copy)
│   │   └── fitness.json
│   ├── gen_001/ ...
│   └── pareto.json                   non-dominated frontier
├── trace_corpus/                     NEW: per-function per-round traces
│   └── <fn>/round_<N>/
│       ├── analyze_agent.md          proposer I/O
│       ├── implement_agent.md        implementer diff + reasoning
│       ├── verify_result.json        PASS/FAIL + stderr if any
│       ├── measure_result.json       cycles/instrs/IPC
│       ├── fail_reason.md            tagged failure class (if any)
│       └── step_timings.json         wall-clock per step
├── state.json                        (extended with trace_dir, current_gen)
└── meta_history.json                 NEW: outer-loop decisions audit log
```

### B. Outer loop (new FSM step `evolve`)

Triggered after `learn`, gated by `[meta_loop].enabled` (default false; opt-in).

1. **Aggregate**: `aggregate_traces.py` reads `trace_corpus/` -> summary stats per hypothesis type, per failure class.
2. **Critique**: spawn `harness-critic` subagent with: current `SKILL.md`, summary stats, recent failure examples, fitness of current gen. Critic writes proposal to `harness_generations/gen_<N+1>/SKILL.md` + optional `references/` edits. Critic CANNOT write to live paths.
3. **Evaluate**: `meta_evaluate.sh` runs the held-out eval set with the proposed harness vs. current; emits `fitness.json = {avg_speedup, avg_rounds_to_plateau, hypothesis_success_rate, regression_rate}`.
4. **Accept**: if Pareto-dominates on (speedup, rounds): replace live `SKILL.md`/`references/` with gen_<N+1> contents, git-tag `harness/gen_<N+1>`, update `pareto.json`. Else archive under `harness_generations/rejected/` and append to `meta_history.json` with reason.
5. **Guard**: next K inner runs monitored; if regression >threshold, `meta_guard.sh` auto-reverts to previous git tag.

### C. Harness-critic subagent (new)

- **Role**: diagnose failure patterns; propose targeted edits to SKILL.md text and reference docs.
- **Tools**: Read, Grep, Glob, Write (scoped to `harness_generations/gen_<N+1>/` only).
- **Input**: aggregated trace stats, top-3 failing rounds verbatim, top-3 successful rounds verbatim, current SKILL.md, eval fitness target.
- **Output**: diff-style proposal + rationale, written to `harness_generations/gen_<N+1>/RATIONALE.md`.
- **Scope limit (gen 1)**: may edit SKILL.md prose + subagent prompts embedded in SKILL.md + `references/*.md`. May NOT edit scripts, config schema, or FSM topology. Widen in future generations only after critic's track record is established.

### D. Fitness (multi-objective, Pareto)

Per harness generation, evaluated on `harness_eval_set.toml`:

| Axis | Direction | Source |
|---|---|---|
| avg_speedup | higher | measure_result.json across eval functions |
| avg_rounds_to_plateau | lower | state.json round counter at plateau |
| hypothesis_success_rate | higher | fraction of rounds where measured cycles improved |
| regression_rate | lower | fraction of rounds where measured cycles regressed |

Primary Pareto axes: (avg_speedup, avg_rounds_to_plateau). Tiebreakers: success_rate > regression_rate inverse.

### E. Safety invariants

- Live `SKILL.md` is never edited directly by the critic — only by the accept-step after Pareto check.
- Every accept creates a git tag `harness/gen_<N>`; rollback is one `git checkout <tag>`.
- `meta_guard.sh` watches next K=3 inner runs after accept; auto-revert on regression >15%.
- `[meta_loop].enabled = false` by default. User opts in per run.
- Meta-agent cannot delete trace_corpus/ or harness_generations/ (enforced by permission scoping).

### F. Compound effect / flywheel (explicit)

- Trace corpus accumulates monotonically -> more evidence each meta-iteration.
- `learned_heuristics.md` grows; referenced by analyze/implement agents on every future function.
- Pareto frontier preserved -> no loss of past wisdom.
- Each accepted gen compounds: sharper analyze hypothesis -> faster convergence -> more function throughput per wall-clock hour -> more traces per hour.

---

## ROADMAP (materialize as `ROADMAP.md` at execution)

Each phase is independently valuable and testable. Later phases assume earlier phases landed.

### Phase 0 - trace-emission

- **Description**: instrument every existing FSM step to write its I/O + timing to `trace_corpus/<fn>/round_<N>/`. Zero behavior change to the optimization loop. This is the foundation — without traces, no meta-loop.
- **Key files**:
  - `.claude/skills/optimize/SKILL.md` (modify: add trace-write step to each of analyze/implement/verify/measure/learn)
  - `.claude/skills/optimize/script/emit_trace.sh` (new: shell helper `emit_trace <step> <fn> <round> <payload_file>`)
  - `.claude/skills/optimize/state.json` (extend: add `trace_dir`, `current_trace_round`)
- **Test cases**:
  - Run `/optimize` on `relu_s8` for 1 round.
  - Assert `trace_corpus/relu_s8/round_0/{analyze_agent,implement_agent,verify_result,measure_result}.*` exist and are non-empty.
  - Assert `step_timings.json` parses as JSON with numeric `wall_seconds` per step.
  - Run on a deliberately-broken source to trigger compile error; assert `fail_reason.md` created with tag `compile_error`.
- **Dependencies**: none.

### Phase 1 - eval-set-fitness

- **Description**: define a small held-out eval set (3 functions covering distinct kernel regimes) and the fitness scorer.
- **Key files**:
  - `.claude/skills/optimize/harness_eval_set.toml` (new: list of 3 functions + their golden baseline cycles from `build_perf_baseline/`)
  - `.claude/skills/optimize/script/meta_evaluate.sh` (new: take a harness snapshot dir, run inner loop on each eval fn with max_rounds=3, emit `fitness.json`)
  - `.claude/skills/optimize/harness_generations/gen_000/` (bootstrap: copy current SKILL.md + references/)
- **Proposed eval set** (diverse pressure profiles; user may override):
  - `conv_HWC_s8_s8_s8_sym_bias_fast` (dense conv, compute-bound)
  - `conv_dw_HWC_u8_u8_u8_asym_bias_any` (depthwise, memory-bound)
  - `relu_s8` (elementwise, tiny kernel)
- **Test cases**:
  - Run `meta_evaluate.sh harness_generations/gen_000 harness_eval_set.toml`.
  - Assert `gen_000/fitness.json` has all 4 keys (avg_speedup, avg_rounds_to_plateau, hypothesis_success_rate, regression_rate).
  - Assert reproduced speedups within +/-5% of `build_perf_baseline/performance.csv` values.
- **Dependencies**: Phase 0 (uses traces to compute success_rate).

### Phase 2 - harness-critic

- **Description**: new subagent that reads aggregated traces + current SKILL.md and writes a revised SKILL.md + RATIONALE to a fresh `gen_<N+1>/` directory.
- **Key files**:
  - `.claude/skills/optimize/script/aggregate_traces.py` (new: produce `trace_summary.json` with per-hypothesis-tag success rate, top failure classes, average round duration)
  - `.claude/skills/optimize/SKILL.md` (add: harness-critic invocation block under new `evolve` section — code stays inert until Phase 5 enables it)
  - Subagent definition (option A: embedded agent block in SKILL.md; option B: new `.claude/agents/harness-critic.md`)
- **Test cases**:
  - Seed `trace_corpus/` with 5 synthetic rounds where LMUL=8 tiling consistently regresses; invoke harness-critic manually.
  - Assert `harness_generations/gen_001/SKILL.md` exists and diff vs gen_000 mentions LMUL or register-pressure.
  - Assert critic did NOT touch any script or config file (scope enforcement).
  - Assert `gen_001/RATIONALE.md` references specific trace rounds by path.
- **Dependencies**: Phase 0, Phase 1.

### Phase 3 - pareto-frontier

- **Description**: maintain non-dominated harness generations and tag accepted gens in git.
- **Key files**:
  - `.claude/skills/optimize/script/meta_pareto.py` (new: scan all `harness_generations/gen_*/fitness.json`; compute Pareto frontier on (speedup, rounds); write `pareto.json`)
  - `.claude/skills/optimize/harness_generations/pareto.json` (output)
- **Test cases**:
  - Create 5 mock fitness.json with varied (speedup, rounds) tradeoffs; run `meta_pareto.py`.
  - Assert `pareto.json.frontier` lists exactly the non-dominated gens.
  - Accept gen_002 manually; assert git tag `harness/gen_002` exists.
  - Re-run with a dominated gen_003; assert it does NOT appear in frontier.
- **Dependencies**: Phase 1 (reads fitness.json schema).

### Phase 4 - auto-revert

- **Description**: watchdog that monitors first K=3 real (non-eval) inner runs after an accept; reverts to previous tag on regression >threshold.
- **Key files**:
  - `.claude/skills/optimize/script/meta_guard.sh` (new)
  - `.claude/skills/optimize/config.toml` (extend `[meta_loop]` with `regression_threshold = 0.15`, `guard_window = 3`)
  - `.claude/skills/optimize/meta_history.json` (appended on accept/revert)
- **Test cases**:
  - Install a deliberately-bad gen (e.g., strip proposer's "check register pressure" line); run `/optimize` on an eval fn.
  - Assert regression detected within 1 run; assert `git checkout harness/gen_<prev>` executed; assert `meta_history.json` records the revert with reason.
- **Dependencies**: Phase 3.

### Phase 5 - evolve-step (closed loop)

- **Description**: wire phases 1-4 into the FSM as new step `evolve`, triggered after `learn`; gated by config.
- **Key files**:
  - `.claude/skills/optimize/SKILL.md` (add evolve step + transition rules; update ASCII FSM diagram)
  - `.claude/skills/optimize/config.toml` (add `[meta_loop] enabled = false` by default)
- **Flow (evolve)**:
  1. aggregate_traces.py -> trace_summary.json
  2. invoke harness-critic -> gen_<N+1>/
  3. meta_evaluate.sh gen_<N+1> eval_set -> fitness.json
  4. meta_pareto.py -> accept or archive
  5. on accept: copy to live, git tag, arm meta_guard
  6. FSM returns to `idle` (next function run picks up new harness)
- **Test cases**:
  - Enable `[meta_loop]`; run `/optimize` on 3 functions back-to-back.
  - Assert `evolve` fires after each `learn`.
  - Assert at least one gen promoted (if critic found anything) or all archived with documented reasons.
  - 24h autonomous run: assert avg eval-set speedup is monotone non-decreasing across accepted gens.
- **Dependencies**: Phase 0-4.

---

## Open design choices (defaults chosen; user can override at execution)

| Decision | Default | Rationale |
|---|---|---|
| Scope of meta-agent edits (gen 1) | SKILL.md prose + references/ only | Safety. Widen after track record. |
| Trigger cadence | After each function completes (post-`learn`) | Max data per wall-clock hour; cheap. |
| Rollback mechanism | git tags `harness/gen_<N>` | Atomic, inspectable, one-command revert. |
| Eval set size | 3 functions (conv / dw-conv / relu) | Covers compute/memory/trivial regimes; fast enough for 24h loop. |
| Accept criterion | Strict Pareto dominance on (speedup, rounds) | Prevents drift; tiebreakers handle ties. |
| `[meta_loop].enabled` default | `false` (opt-in) | Don't mutate the skill on users who didn't ask for it. |

---

## End-to-end verification

Executed in order after all phases land:

1. Baseline: `meta_evaluate.sh harness_generations/gen_000` -> record gen_000 fitness.
2. Enable `[meta_loop]`; run `/optimize` on all 3 eval functions.
3. Assert `harness_generations/gen_001/` produced and evaluated.
4. Inspect `gen_001/RATIONALE.md` for sane diagnosis.
5. If accepted: compare gen_001 fitness vs gen_000 — must Pareto-dominate.
6. Trigger regression manually (break one line of SKILL.md); assert `meta_guard.sh` reverts.
7. After 3 more funcs: assert `pareto.json` has >=2 entries and `references/learned_heuristics.md` has grown.
8. Run on a 4th function NOT in eval set; assert updated harness converges in equal-or-fewer rounds vs gen_000 on the same function.
