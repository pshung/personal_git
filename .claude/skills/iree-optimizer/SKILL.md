---
name: iree-optimizer
description: >
  Agentic IREE dispatch optimization - replaces brute-force GA tuning with
  LLM-driven codegen strategy exploration. Reads dispatch IR, proposes full
  TransformDialectCodegen strategies, generates transform scripts via
  mlir-transform-writer, compiles, benchmarks, and iterates. Use this skill
  whenever the user mentions optimizing IREE dispatches, agentic tuning,
  transform strategy search, dispatch performance optimization, or wants to
  replace GA-based tile size search with intelligent codegen exploration.
  Also trigger when the user says "iree optimize", "optimize dispatch",
  "agentic tune", or references dispatch .mlir files for performance tuning.
argument-hint: "[dispatch_id|all|status|reset] [--max-iter N]"
---

# IREE Dispatch Optimizer

An agentic optimization loop that replaces blind GA search with LLM-driven
codegen strategy exploration. You analyze dispatch IR, propose full
TransformDialectCodegen strategies, and iterate based on compilation and
performance feedback.

## Architecture: Harness + LLM

**You are the LLM reasoning engine.** Deterministic harness scripts handle
compilation, benchmarking, and state management. You never invoke the IREE
compiler directly - always use the harness scripts.

**Harness scripts** (in the AutoIREE repo at `opt/script/`):
- `extract_dispatch_info.py` - parse dispatch .mlir into structured JSON
- `profile_dispatch.py` - compile+benchmark with IREE defaults
- `compile_dispatch.py` - compile with a candidate transform library
- `benchmark_dispatch.py` - run a compiled dispatch, extract cycles
- `state.py` - state management (read/write/advance phase)

**Your responsibilities**:
- Analyze IR structure (ops, shapes, dtypes, target)
- Propose codegen strategies informed by hardware constraints and history
- Generate transform scripts by invoking the mlir-transform-writer skill
- Evaluate results: diagnose compiler errors, assess performance
- Decide when to accept, reject, or stop iterating

## Commands

### `/iree-optimizer <dispatch_id>`
Full auto: gather -> baseline -> iterate -> evaluate -> done for one dispatch.

### `/iree-optimizer all`
Optimize all dispatches in the benchmarks/ directory, heaviest first.

### `/iree-optimizer status`
Show current state of all dispatches being optimized.

### `/iree-optimizer reset <dispatch_id>`
Reset state for a dispatch to start over.

## Phase Execution

Read `references/state_schema.md` for the full state.json schema.

### Phase 1: GATHER

Run the extract script to analyze the dispatch IR:

```bash
python opt/script/extract_dispatch_info.py \
  --dispatch-id <N> \
  --benchmarks-dir benchmarks/
```

This produces the `ir_analysis` JSON. Create initial state:

```python
# Use state.py functions
from opt.script.state import create_state, save_state
state = create_state(dispatch_id, ir_analysis)
save_state(opt_dir, dispatch_id, state)
```

Or equivalently, write `opt/dispatch_N/state.json` directly using the schema.
Advance phase to "baseline".

### Phase 2: BASELINE

Run the profile script to establish default performance:

```bash
python opt/script/profile_dispatch.py \
  --dispatch-id <N> \
  --benchmarks-dir benchmarks/ \
  --model <model_path> \
  --platform <config.toml>
```

Record baseline cycles in state. Advance to "iterate".

### Phase 3: ITERATE (the core loop)

This is where your reasoning drives optimization. Each iteration:

1. **Read state** - Load state.json. Review ir_analysis, baseline, best, and
   the full history of past attempts (strategies, cycles, errors).

2. **Analyze and plan** - Before proposing a strategy, work through this
   checklist:
   - What computation is this? (matmul, conv, elementwise, reduction, fusion chain)
   - What are the shapes? (fit in registers? L1? L2?)
   - What data types? (i8xi8->i32 means 4:1 compute/load, f16->f32 means 2:1)
   - What target? (VLEN bits = VLEN/8 bytes per vector register)
   - What pipeline did IREE default to? (CPUDoubleTilingExpert, etc.)
   - What have past iterations tried? What worked, what failed?
   - If errors occurred, what was the compiler error? How to fix it?

3. **Propose strategy** - Describe what your TransformDialectCodegen script
   will do. Write this as a clear description, e.g.:
   > "2-level tiling: [64, 64] outer for cache blocking, [8, 32] inner for
   > vector registers. K-reduction tile = 16. Vectorize the inner loop.
   > Bufferize with IREE defaults."

4. **Generate transform script** - Invoke the mlir-transform-writer skill:

   Use `/mlir-transform-writer` or read and follow the skill at
   `~/.claude/skills/mlir-transform-writer/SKILL.md`.

   Provide it with:
   - The operation type and shapes from ir_analysis
   - Target backend: CPU, RISC-V, VLEN from target info
   - The strategy you've decided on
   - Format: TransformDialectCodegen (named_sequence with codegen_spec)
   - The func_name from ir_analysis

   Save the output to `opt/dispatch_N/transforms/iter_M.mlir`.

5. **Compile** - Run the compile script:

   ```bash
   python opt/script/compile_dispatch.py \
     --dispatch-id <N> \
     --benchmarks-dir benchmarks/ \
     --transform-file opt/dispatch_N/transforms/iter_M.mlir \
     --work-dir /tmp/agentic_compile_N_M \
     --model <model_path> \
     --platform <config.toml>
   ```

   If compilation fails, record the error in history and proceed to step 7.

6. **Benchmark** - If compilation succeeded:

   ```bash
   python opt/script/benchmark_dispatch.py \
     --exe-path <exe_path_from_compile> \
     --model <model_path> \
     --platform <config.toml>
   ```

7. **Record and evaluate** - Use state.py to record the iteration:
   - If cycles < best: accepted, update best, reset non-improvement counter
   - If cycles >= best or error: rejected, increment non-improvement counter

8. **Check convergence** - Stop if:
   - `iteration >= max_iterations`
   - `consecutive_non_improvements >= max_consecutive_non_improvements`
   - You've exhausted meaningful strategies to try

   If not converged, go to step 1 of the next iteration.

### Phase 4: EVALUATE

Re-compile and re-benchmark the best strategy for confirmation.
Generate a summary of the optimization.
Advance to "done".

### Phase 5: DONE

Print the final summary: baseline, best, speedup, winning strategy.

## Strategy Guide

Read `references/strategy_guide.md` for detailed CPU codegen strategy
knowledge, but here's the quick version:

### CPU (RISC-V with RVV) Strategy Space

**Tiling dimensions to explore**:
- Distribution tiles (outer): controls cache blocking. Try multiples of VLEN/element_size.
- Vector tiles (inner): should match VLEN for full utilization. For VLEN=512, i8: 64 elements, i32: 16 elements.
- Reduction tiles: controls accumulation granularity. Larger = more ILP but more register pressure.

**Key decisions**:
- Loop interchange: K-innermost vs M-innermost for matmul
- Vectorization axis: which dimension maps to the vector register
- Tiling level count: match the pipeline's expectations (CPUDoubleTilingExpert = 6 levels)

### Strategy Escalation

1. **First 2-3 iterations**: Try variations of tile sizes within the existing
   pipeline structure. Vary distribution tiles, vector tiles, K-tile.
2. **Middle iterations**: Try different loop orderings, vectorization axes.
3. **Later iterations**: Try fundamentally different approaches if earlier
   ones plateaued - different fusion strategies, explicit padding, etc.

### Error Recovery

If a transform script causes a compile error:
- Read the error message carefully
- Common issues: handle invalidation (consumed handle reused), type mismatch
  (wrong handle type), missing ops (op not found in payload)
- Fix the specific issue in the next iteration
- After 3 consecutive compile errors, simplify: go back to the last working
  strategy and make a smaller change

## Cross-dispatch Learning

When optimizing multiple dispatches, read sibling state.json files to find:
- Dispatches with the same op type and similar shapes
- Winning strategies that could transfer
- Common error patterns to avoid

Access via: `ls opt/dispatch_*/state.json`

## Important Notes

- Always use the harness scripts. Never run iree-compile directly.
- Always save transform scripts before compiling (for reproducibility).
- Keep strategy descriptions concise but specific in the history.
- Truncate compiler error messages to 500 chars in state.json.
- The model and platform args are required for scripts that need Context init.
  Get these from the user or from the working directory structure.
