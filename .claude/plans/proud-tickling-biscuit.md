# Plan: Refine Analyze Step with Debate Architecture

## Context
The `/optimize` skill's `analyze` step currently uses a single subagent to study code, assembly, and pipeline data and form an optimization hypothesis. The user wants a more rigorous analyze step that:
1. Separates algorithm-level and micro-architecture-level optimization
2. Uses a debate pattern (proposer + critic) at each level
3. Has a final judge agent that synthesizes the debate
4. Algorithm-level runs first; only when exhausted, moves to micro-architecture level

## Changes

**File:** `.claude/skills/optimize/SKILL.md`

### Modify the `analyze` state (lines ~104-158)

Replace the single-agent analyze with a two-phase debate architecture:

#### Phase 1: Algorithm-Level Optimization
- **Proposer agent** — Reads source, assembly, optdb lessons. Generates algorithm-level ideas (tiling strategy, GEMM restructuring, loop reordering, data layout changes, im2col vs direct conv, unrolling schemes)
- **Critic agent** — Receives proposer's ideas. Raises concerns: correctness risks, VLEN portability, register pressure, memory overhead, whether the idea actually addresses the bottleneck. References prior failed approaches from optdb.
- **Judge agent** — Receives both proposer and critic outputs. Makes final decision: accept best idea with modifications from critic feedback, or declare "no algorithm-level opportunity remains"

#### Phase 2: Micro-Architecture-Level Optimization (only if Phase 1 exhausted)
- **Proposer agent** — Focuses on pipeline-level optimizations: instruction scheduling, LMUL tuning, dual-issue opportunities, VQ→VD stall reduction, VLSU prefetching, register allocation hints, loop software pipelining
- **Critic agent** — Challenges with: does the pipeline data actually show this stall? Is this micro-opt worth the code complexity? Will it survive compiler reordering at -O3?
- **Judge agent** — Final synthesis and decision

### State tracking additions
Add to state JSON:
- `"optimization_level": "algorithm"|"micro-arch"` — tracks which phase we're in
- When algorithm-level judge says "no more ideas", flip to micro-arch
- When micro-arch judge says "no more ideas", transition → idle

### Subagent dispatch table update
Update the subagent dispatch table (lines ~436-466) to reflect the new agents:
- `analyze-proposer` — Tools: Read, Grep, Glob, Bash (grep/optdb only)
- `analyze-critic` — Tools: Read, Grep, Glob, Bash (grep/optdb only)
- `analyze-judge` — No tools needed, just reasoning over proposer+critic outputs

### FSM flow within analyze
```
analyze entry
  → check optimization_level (default: "algorithm")
  → if "algorithm":
      → launch proposer + critic agents in parallel
      → launch judge agent with both outputs
      → if judge says "no algorithm opportunity" AND round > 1:
          → set optimization_level = "micro-arch", re-run analyze
      → else: proceed to implement with judge's chosen approach
  → if "micro-arch":
      → launch proposer + critic agents in parallel (micro-arch focused)
      → launch judge agent
      → if judge says "no micro-arch opportunity": → idle
      → else: proceed to implement
```

### Agent prompt constraints

**Algorithm Proposer:**
- Focus: data flow, algorithm choice, tiling/blocking, loop structure, GEMM strategy
- Must reference the active code path (from objdump)
- Must check optdb for what's been tried before
- Output: 1-3 ranked ideas with expected impact rationale

**Algorithm Critic:**
- Focus: correctness risks, edge cases, prior failures, whether improvement is realistic
- Must cite specific reasons (e.g., "optdb shows im2col was tried on similar function and regressed due to memory pressure")
- Output: per-idea feedback with accept/reject/modify recommendation

**Micro-arch Proposer:**
- Focus: pipeline stalls from profile data, instruction scheduling, LMUL, dual-issue
- Must reference the kanata pipeline log or assembly analysis
- Output: 1-3 micro-optimizations with pipeline stage justification

**Micro-arch Critic:**
- Focus: compiler behavior at -O3, whether stalls are real bottleneck vs noise, code maintainability
- Output: per-idea feedback

**Judge (both levels):**
- Receives proposer + critic outputs
- Makes final decision: pick one idea (or none)
- Output: chosen hypothesis + implementation plan + which lines to modify

## Verification
- Run `/optimize status` to confirm state tracking works
- Run `/optimize <function>` end-to-end and verify the debate agents are dispatched correctly
- Check that algorithm-level exhaustion correctly transitions to micro-arch level
