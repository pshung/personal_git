# Agentic AutoIREE Integration Design

## Context

AutoIREE's current GA tuner (`GATuner`) blindly searches a tile-size-only space. Each iteration:
1. GA samples tile size vector from `ConfigSpace`
2. `task.generate_script()` produces annotation-only .mlir (just sets `lowering_config<tile_sizes=...>`)
3. IREE compiler applies builtin codegen passes
4. Benchmark on FPGA, feed cycle count back to GA evolution

**Problem**: The GA cannot explore qualitatively different codegen strategies - it only permutes tile sizes. All transformation decisions (fusion, vectorization, promotion, bufferization, GPU mapping) are locked to IREE's builtin pass defaults.

**Solution**: Replace GA with an LLM-driven optimization loop following the libnn-optimizer pattern (deterministic harness + LLM reasoning). The LLM reads the dispatch IR, proposes full `TransformDialectCodegen` strategies, generates scripts via the `mlir-transform-writer` skill, and iterates based on compilation/performance feedback.

**Decisions made**:
- Invocation: Claude Code skill only (no Python API)
- MVP: Full TransformDialectCodegen from start (not annotation-only)
- Scripts: `opt/script/` in model working directory

---

## Architecture

```
User: "/iree-optimizer dispatch_3"
         |
   iree-optimizer skill (SKILL.md)
   reads opt/state.json, determines phase
         |
   +-----+------+-----+
   |              |              |
 GATHER        ITERATE        EVALUATE
 (harness)     (LLM + harness) (harness)
   |              |
   |     LLM reads: ir_analysis + history
   |     LLM proposes: codegen strategy
   |     LLM invokes: /mlir-transform-writer
   |     Harness: compile_dispatch.py
   |     Harness: benchmark_dispatch.py  
   |     LLM evaluates: accept/reject
   |              |
   +-----+-------+
         |
   opt/state.json (persisted)
```

### Harness vs LLM Split

| Harness (deterministic scripts) | LLM (reasoning) |
|---|---|
| Parse dispatch .mlir -> structured JSON | Analyze computation structure |
| Compile with transform library | Propose codegen strategy |
| Run on device, extract cycles | Invoke mlir-transform-writer |
| State management (read/write JSON) | Diagnose compiler errors |
| Error capture (stderr) | Evaluate results, adjust approach |
| | Detect convergence |

---

## Phase FSM

```
GATHER -> BASELINE -> ITERATE (loop) -> EVALUATE -> DONE
```

### GATHER (harness only)
- Run `extract_dispatch_info.py` on dispatch .mlir + tile_config.json
- Produces `ir_analysis` section: ops, shapes, dtypes, target, iteration_space
- Write initial state.json with phase="baseline"

### BASELINE (harness only)
- Run `profile_dispatch.py` - compile with IREE defaults, benchmark
- Record baseline cycles in state.json
- Advance to phase="iterate"

### ITERATE (LLM + harness loop)
Per iteration:
1. LLM reads state.json (ir_analysis, baseline, best, history)
2. LLM formulates TransformDialectCodegen strategy
3. LLM invokes `/mlir-transform-writer` to generate .mlir
4. Save to `opt/transforms/iter_N_dispatch_M.mlir`
5. Run `compile_dispatch.py` - if fails, record error, feed stderr to LLM
6. Run `benchmark_dispatch.py` - get cycle count
7. LLM evaluates: `accepted = (cycles < best.cycles)`
8. Update state.json: append to history, update best if accepted
9. Convergence check: max_iterations or N consecutive non-improvements

### EVALUATE (harness + LLM)
- Re-compile and re-benchmark best strategy for confirmation
- LLM generates summary report

### DONE
- Output: baseline cycles, best cycles, speedup, winning strategy path

---

## State Schema

Location: `opt/dispatch_N/state.json` (one per dispatch)

```json
{
  "version": 1,
  "dispatch_id": 3,
  "func_name": "main_dispatch_3_matmul_128x256x512_i8xi8xi32",
  "phase": "iterate",
  
  "ir_analysis": {
    "mlir_file": "benchmarks/module_main_dispatch_3_static_benchmark.mlir",
    "tile_config_file": "benchmarks/module_main_dispatch_3_static_tile_config.json",
    "pipeline": "CPUDoubleTilingExpert",
    "operations": [
      {
        "name": "linalg.matmul-0",
        "op_type": "linalg.matmul",
        "iteration_space": [128, 256, 512],
        "iteration_type": ["parallel", "parallel", "reduction"],
        "tiling_levels": [3, 1],
        "default_tile_sizes": [[64,64,0],[32,32,0],[0,0,0],[8,32,0],[0,0,16],[0,0,0]]
      }
    ],
    "target": {
      "cpu": "generic-rv64",
      "vlen": 512,
      "features": ["+m","+a","+f","+d","+v"]
    }
  },
  
  "baseline": {
    "cycles": 4500000,
    "compile_time_s": 12.5,
    "run_time_s": 3.2
  },
  
  "best": {
    "cycles": 3200000,
    "iteration": 4,
    "transform_file": "opt/transforms/iter_4_dispatch_3.mlir",
    "description": "TransformDialectCodegen: tile [64,64] blocks, K-tile=16, vectorize for RVV"
  },
  
  "iteration": 7,
  "max_iterations": 15,
  "max_consecutive_non_improvements": 3,
  "consecutive_non_improvements": 2,
  
  "history": [
    {
      "iteration": 1,
      "description": "Tile [128,128] to blocks, K=32, vectorize, bufferize",
      "transform_file": "opt/transforms/iter_1_dispatch_3.mlir",
      "cycles": 4200000,
      "accepted": true,
      "error": null
    },
    {
      "iteration": 2,
      "description": "Tile [64,64], fuse fill, K=16, vectorize for RVV LMUL=2",
      "transform_file": "opt/transforms/iter_2_dispatch_3.mlir",
      "cycles": null,
      "accepted": false,
      "error": "compile_error: handle consumed before use at line 23 (truncated)"
    }
  ]
}
```

---

## Script Catalog

All scripts at `opt/script/` in model working directory. Each wraps existing `auto_iree` functions.

### 1. `extract_dispatch_info.py`
- **Input**: `--dispatch-id N --benchmarks-dir DIR`
- **Output**: JSON to stdout (the `ir_analysis` object)
- **Wraps**: `TilingJSON` (utils.py:30-76), MLIR regex parsing from `MLIRTask.__init__()` (task.py:118-164)
- Extracts: ops, shapes, dtypes, iteration_space, iteration_type, tiling_levels, target, pipeline

### 2. `profile_dispatch.py`
- **Input**: `--dispatch-id N --benchmarks-dir DIR`
- **Output**: JSON `{"cycles": N, "compile_time_s": N, "run_time_s": N}`
- **Wraps**: `build_subgraph()` (task.py:326-360) + `run_subgraph()` (task.py:363-373) with `use_transform=False`
- Requires Context singleton initialized

### 3. `compile_dispatch.py`
- **Input**: `--dispatch-id N --benchmarks-dir DIR --transform-file FILE --work-dir DIR --timeout N`
- **Output**: JSON `{"success": bool, "exe_path": str, "compile_time_s": float, "error": str|null}`
- **Wraps**: `build_subgraph()` (task.py:326-360) with `use_transform=True`
- Places transform file in `work_dir/transform_library/` before calling build

### 4. `benchmark_dispatch.py`
- **Input**: `--exe-path FILE --timeout N`
- **Output**: JSON `{"cycles": N, "run_time_s": float}`
- **Wraps**: `run_subgraph()` (task.py:363-373)
- Uses Device from Context singleton

### Context initialization
All scripts that need the Context singleton accept `--model PATH --config PATH` and call `ctx.lazy_init(model, config)`. This mirrors how `iree_tuner.py` initializes context.

---

## Skill Structure

```
~/.claude/skills/iree-optimizer/
  SKILL.md              -- orchestration instructions
  references/
    state_schema.md     -- state.json schema reference
    strategy_guide.md   -- CPU codegen strategy knowledge (RISC-V specific)
```

### SKILL.md Key Sections

1. **Commands**: `/iree-optimizer <dispatch_id>`, `/iree-optimizer all`, `/iree-optimizer status`
2. **Phase execution**: What to do in each phase, which scripts to call
3. **Strategy formulation guide**: How to analyze IR and propose strategies
   - Read ops, shapes, dtypes from ir_analysis
   - Consider target (VLEN, cache sizes, ISA features)
   - Consider what failed in history (error messages, performance regressions)
   - Invoke `/mlir-transform-writer` with structured description
4. **Escalation protocol**: If 3 consecutive compile failures, simplify strategy
5. **Cross-dispatch learning**: Read other dispatches' state.json for similar ops

### Skill composition
The iree-optimizer skill invokes mlir-transform-writer via `/mlir-transform-writer` during the ITERATE phase. It passes:
- Operation type and shapes
- Target backend (CPU, RISC-V, VLEN)
- Desired strategy description
- Whether TransformDialectCodegen or tuning spec format

---

## Files to Create/Modify

### NEW files
| File | Purpose |
|---|---|
| `~/.claude/skills/iree-optimizer/SKILL.md` | Agentic optimization skill |
| `~/.claude/skills/iree-optimizer/references/state_schema.md` | State JSON schema |
| `~/.claude/skills/iree-optimizer/references/strategy_guide.md` | CPU codegen strategy knowledge |
| `opt/script/extract_dispatch_info.py` | IR analysis harness |
| `opt/script/profile_dispatch.py` | Baseline profiling harness |
| `opt/script/compile_dispatch.py` | Compilation harness |
| `opt/script/benchmark_dispatch.py` | Benchmarking harness |

### UNCHANGED files (reused as-is)
| File | Why |
|---|---|
| `python/auto_iree/task.py` | `build_subgraph()`, `run_subgraph()`, `generate_script()` called by harness scripts |
| `python/auto_iree/iree_helper.py` | Low-level compilation functions |
| `python/auto_iree/context.py` | Context singleton for config/device |
| `python/auto_iree/space.py` | Not used by agentic tuner |
| `python/auto_iree/tuner.py` | GA tuner stays for --tune mode |
| `iree_tuner.py` | No changes needed - skill is invoked from Claude Code, not from CLI |

---

## Implementation Features (ordered by dependency)

### Feature 1: Harness Scripts
- Create `opt/script/` with all 4 scripts
- Each wraps existing auto_iree functions with JSON I/O
- Test: run each script standalone against a test dispatch
- **Key files**: task.py:326-373 (build_subgraph, run_subgraph), utils.py:30-76 (TilingJSON)
- **Dependencies**: none

### Feature 2: State Management
- Create state.json schema and read/write logic
- Phase FSM transitions
- History append with strategy description, cycles, error
- **Dependencies**: Feature 1 (scripts produce data that goes into state)

### Feature 3: iree-optimizer Skill (GATHER + BASELINE phases)
- Write SKILL.md with phase instructions
- GATHER: call extract_dispatch_info.py, write state.json
- BASELINE: call profile_dispatch.py, record baseline
- Test: run `/iree-optimizer <dispatch_id>` through GATHER and BASELINE
- **Dependencies**: Features 1, 2

### Feature 4: ITERATE Phase (full codegen)
- LLM reads ir_analysis + history, proposes strategy
- Invokes mlir-transform-writer to generate .mlir
- Calls compile_dispatch.py + benchmark_dispatch.py
- Evaluates results, updates state
- Convergence detection
- Test: run full optimization loop on a test dispatch
- **Dependencies**: Feature 3, mlir-transform-writer skill

### Feature 5: EVALUATE + Cross-dispatch
- Re-benchmark best strategy for confirmation
- Cross-dispatch learning (read sibling state.json files)
- `all` command: optimize all dispatches sorted by weight
- **Dependencies**: Feature 4

---

## Risks and Mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Transform script compile failures | HIGH | Feed compiler stderr to LLM for self-correction. After 3 consecutive failures, simplify strategy. |
| Slow iteration (10-240s compile per attempt) | MEDIUM | Budget 10-15 iterations per dispatch. Sort dispatches by cycle weight. Skip dispatches < 1% of total. |
| LLM context growth from history | LOW | History entries are compact JSON. Truncate error messages to 500 chars. Each dispatch gets fresh invocation. |
| Regression vs GA | LOW | Always record GA best as floor. Annotation-only fallback available. |
| Device connectivity | MEDIUM | Reuse existing Device.run_exec() retry logic. Device errors don't count toward convergence limit. |

---

## Verification Plan

1. **Unit test harness scripts**: Create a test dispatch (the existing `tests/files/model/test/model/benchmarks/module_main_dispatch_0_static_benchmark.mlir`). Run each script and verify JSON output.

2. **Smoke test skill**: Run `/iree-optimizer 0` on the test dispatch through GATHER and BASELINE phases. Verify state.json is correct.

3. **End-to-end test**: Run full ITERATE loop on a real dispatch. Verify:
   - mlir-transform-writer produces valid .mlir
   - compile_dispatch.py compiles successfully (or captures error cleanly)
   - benchmark_dispatch.py returns cycle count
   - state.json history is updated correctly
   - Convergence detection works

4. **Comparison test**: On the same dispatch, compare:
   - IREE default baseline cycles
   - GA best (from existing --tune history if available)
   - Agentic best (from the new optimizer)
