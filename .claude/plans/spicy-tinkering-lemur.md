# Agentic AI Tiling Optimizer — Implementation Plan

## Context

AutoIREE's genetic algorithm tuner (`GATuner`) takes ~20,000 iterations to find optimal tile
configurations for RISC-V RVV targets. We're replacing it with an AI-driven approach that:
1. Learns tiling principles from the AutoIREE_zoo (21 models, ~800+ dispatches, vlen=1024, L2=8MB)
2. Predicts the best tile config with minimal compile/run budget

**Budget per subgraph:** up to 10 compiles (inspect MLIR/asm), up to 3 device runs.
HIGH confidence predictions use 0 compiles, 0 runs.

**Hardware:** Always AX45_1024 (vlen=1024, L2=8MB). LMUL is implicitly set by tile size.

## Deliverables

### New files
```
python/auto_iree/cost_model.py         # Pruning filter: ~200 configs → ~5-10 survivors
python/auto_iree/compiler_inspect.py   # Compile + extract features from MLIR/asm
.claude/commands/study_zoo.md          # /study_zoo skill (Phase 1: learn principles)
.claude/commands/optimize_subgraph.md  # /optimize_subgraph skill (Phase 2: predict config)
tests/test_cost_model.py               # Unit tests for cost model
tests/test_compiler_inspect.py         # Unit tests for compiler inspect
knowledge/principles/                  # Populated by /study_zoo (principle files per op type)
knowledge/evidence/                    # Populated by /study_zoo (compiled artifact observations)
```

### Modified files
```
python/auto_iree/config.py             # Add l2_cache_size to LLVMConfig
config/AX45_1024.toml                  # Add l2_cache_size = 8388608
```

### NOT building
- No `AgenticTuner` Python class (skills are the tuner)
- No `--algorithm` flag in `iree_tuner.py`
- No vector database
- No ML-based cost model (analytical filter only)
- No new Python dependencies (skills run inside Claude Code)

---

## Step 1: Config modification

**File:** `python/auto_iree/config.py`
- Add `l2_cache_size: int = 0` to `LLVMConfig` (line ~18, after `vlen: int`)
- Default 0 = unknown (disables L2 filtering). Backward-compatible with other config files.

**File:** `config/AX45_1024.toml`
- Add `l2_cache_size = 8388608` under `[build.llvm]`

---

## Step 2: cost_model.py — Pruning filter

**File:** `python/auto_iree/cost_model.py`

The cost model does NOT pick the best tile. It rejects obviously bad configs using hard constraints.

### Data classes

```python
@dataclass
class HardwareParams:
    vlen: int           # bits (1024)
    l2_cache_size: int  # bytes (8MB)
    sew: int = 32       # element width bits (f32=32, i8=8)
    # derived: vlmax_lmul1 = vlen // sew

@dataclass
class FilterResult:
    index: int
    passed: bool
    reject_reason: str | None = None
```

### Functions

```python
def infer_sew_from_mlir(mlir_path: Path) -> int
    # Parse benchmark MLIR for memref<...xf32> or memref<...xi8> → return SEW bits

def estimate_vector_utilization(tile_sizes, iteration_type, hw) -> float
    # innermost parallel tile vs VLMAX → fraction 0.0-1.0

def estimate_lmul(tile_sizes, iteration_type, hw) -> int
    # ceil(innermost_vector_tile / vlmax_lmul1), clamped to {1,2,4,8}

def estimate_working_set_bytes(iteration_space, iteration_type, tile_sizes, sew_bytes, num_operands) -> int
    # product of outer tile sizes × element size × operand count

def check_register_pressure(tile_sizes, iteration_type, instruction_seq, hw) -> bool
    # accum_vregs_needed vs 32/LMUL. True = acceptable.

def check_untiled_reduction(iteration_space, iteration_type, tile_sizes, threshold=64) -> bool
    # Reject if reduction dim > threshold and tile=0. True = acceptable.

def identify_dominant_op(tiling_json: TilingJSON) -> str
    # For multi-op dispatches: op with reduction dims, or largest iteration space

def filter_config_entity(config, tiling_json, hw) -> FilterResult
    # Apply all filters to one ConfigEntity

def filter_configs(config_space, tiling_json, hw, max_survivors=10) -> list[FilterResult]
    # Iterate space, apply filters, return survivors
    # For spaces > 5000: random sample instead of exhaustive
```

### Rejection criteria
1. Vector utilization < 50% → reject
2. Working set > L2 cache → reject
3. Register pressure guarantees spills → reject
4. Untiled large reduction (K_tile=0, K>64) → reject
5. Estimated LMUL > 4 → reject

For multi-op dispatches: filter on dominant op, then verify parallel tile consistency across ops.

### Reuses from existing code
- `TilingJSON` from `python/auto_iree/utils.py` (line 30) — parse tile_config.json
- `ConfigEntity` from `python/auto_iree/space.py` (line ~780) — `.to_iree_format()` for tile sizes
- `MultiConfigSpace` from `python/auto_iree/space.py` — `.get(index)` to iterate configs
- `OpInfo` from `python/auto_iree/space.py` — iteration_space, iteration_type

---

## Step 3: compiler_inspect.py — Compile and extract features

**File:** `python/auto_iree/compiler_inspect.py`

### Data classes

```python
@dataclass
class MLIRFeatures:
    vector_transfer_read_count: int = 0
    vector_transfer_write_count: int = 0
    vector_contract_count: int = 0
    vector_fma_count: int = 0
    scalar_arith_count: int = 0
    vector_types: list[str] = field(default_factory=list)  # e.g. ["vector<32xf32>"]
    inferred_lmul: int = 1
    has_scalar_fallback: bool = False
    raw_text: str = ""  # full MLIR for skill to read

@dataclass
class ASMFeatures:
    vsetvli_count: int = 0
    vsetvli_configs: list[str] = field(default_factory=list)  # e.g. ["e32,m4,ta,ma"]
    rvv_instruction_count: int = 0
    scalar_instruction_count: int = 0
    stack_spill_bytes: int = 0
    has_spills: bool = False
    code_size_bytes: int = 0
    raw_text: str = ""  # full asm for skill to read
```

### Functions

```python
def compile_to_vectorized_mlir(task, config, work_dir, timeout=120) -> str
    # 1. task.instantiate(config, work_dir) → transform library
    # 2. iree-compile with:
    #    --mlir-print-ir-after=iree-codegen-generic-vectorization
    #    --mlir-disable-threading
    #    --compile-to=executable-sources
    #    + standard base/llvm/riscv args from iree_helper.py
    #    + --iree-codegen-transform-dialect-library-dir=transform_library/
    # 3. Parse stderr for post-vectorization IR
    # 4. Return MLIR text

def compile_to_assembly(task, config, work_dir, timeout=120) -> str
    # 1. task.instantiate(config, work_dir) → transform library
    # 2. iree-compile with --output-format=vm-c (reuse build_subgraph_vmc_obj pattern)
    # 3. riscv64-unknown-elf-objdump -d on kernel.o
    # 4. Return disassembly text

def extract_mlir_features(mlir_text) -> MLIRFeatures
    # Regex-based parsing for vector ops, scalar fallback, vector types → LMUL

def extract_asm_features(asm_text) -> ASMFeatures
    # Regex-based parsing for vsetvli, RVV insns, spills, code size

def inspect_config(task, config, work_dir, timeout=120) -> tuple[MLIRFeatures, ASMFeatures]
    # Convenience: compile both, extract both, return tuple
```

### Reuses from existing code
- `_get_iree_compile_base_args()` from `iree_helper.py:21`
- `_get_iree_compile_llvm_args()` from `iree_helper.py:31`
- `_get_llvm_riscv_args()` from `iree_helper.py:44`
- `ctx.get_iree_compiler()` from `context.py` → path to iree-compile binary
- `task.instantiate(config, out_dir)` from `task.py:233` → tile config injection
- Toolchain objdump at `{riscv_toolchain}/riscv64-unknown-elf-objdump`

---

## Step 4: Claude Code skills

Skills go in `.claude/commands/` as markdown files with frontmatter.

### `.claude/commands/study_zoo.md` — /study_zoo

Instructs the AI to:
1. Catalog all zoo dispatches by op type (read tile_config.json, record.json, profile_all.json)
2. Group into categories: matmul, conv2d, depthwise_conv, pooling, generic (sub-classified by instruction_seq), fill
3. For each op type with >= 3 examples:
   - Read history.log for 5-10 representative dispatches (best/worst configs)
   - Validate cost_model filters against zoo data (best configs should pass, bad configs should be rejected)
   - Compile 2-3 cases with compiler_inspect.py (best config + bad config), study MLIR/asm for LMUL, vector util, spills
4. Write `knowledge/principles/{op_type}.md` with: core principles (grounded in VLEN/LMUL/L2), decision template, confidence criteria, diagnostics
5. Write `knowledge/evidence/{op_type}/case_NNN.md` with per-case observations

### `.claude/commands/optimize_subgraph.md` — /optimize_subgraph

Instructs the AI to:
1. Read target subgraph's tile_config.json + benchmark MLIR
2. Classify dispatch, load matching principle file from `knowledge/principles/`
3. Run `cost_model.filter_configs()` → ~5-10 survivors
4. Apply principles to rank survivors, assign confidence (HIGH/MEDIUM/LOW)
5. Act on confidence:
   - HIGH → emit config (0 compiles, 0 runs)
   - MEDIUM → compile top-3 via `compiler_inspect.inspect_config()`, pick best from features, optionally run 1
   - LOW → compile top-5, inspect all, run top-2, refine
6. Output: recommended tile config + confidence + reasoning

---

## Step 5: Tests

### `tests/test_cost_model.py`
- Uses existing `tests/fake/` pattern (mock ConfigEntity, MultiConfigSpace, TilingJSON)
- Test each filter function with known inputs/expected outputs:
  - `estimate_vector_utilization`: vlen=1024, f32, tile=32 → 100%; tile=17 → 53%
  - `estimate_lmul`: inner tile=32 at f32/vlen=1024 → LMUL=1; tile=64 → LMUL=2
  - `estimate_working_set_bytes`: known shape → exact byte count
  - `check_register_pressure`: matmul [M=49, N=1024, K=16] → passes; K=512 → fails
  - `check_untiled_reduction`: K=1024, K_tile=0 → reject; K=32, K_tile=0 → pass
  - `identify_dominant_op`: fill+matmul+generic → returns matmul
  - `filter_config_entity`: end-to-end with configs that should pass/fail

### `tests/test_compiler_inspect.py`
- Mock `subprocess.run` to return pre-recorded MLIR/asm output
- Store sample outputs in `tests/files/sample_vectorized.mlir`, `tests/files/sample_objdump.txt`
- Test `extract_mlir_features`: count vector ops, detect scalar fallback, infer LMUL
- Test `extract_asm_features`: count vsetvli, RVV insns, detect spills
- Test `compile_to_vectorized_mlir`/`compile_to_assembly`: verify correct iree-compile flags via mocked subprocess

---

## Build Order

```
Step 1: config.py + AX45_1024.toml      (5 min, no deps)
Step 2: cost_model.py + tests            (Phase 0A, depends on Step 1)
Step 3: compiler_inspect.py + tests      (Phase 0B, depends on Step 1, parallel with Step 2)
Step 4: skills + knowledge/ directories  (Phase 1+2, depends on Steps 2+3)
Step 5: Run /study_zoo to populate knowledge/  (requires IREE toolchain)
```

Steps 2 and 3 are independent and can be built in parallel.

---

## Verification

1. `pytest tests/test_cost_model.py -v` — all filter functions work correctly
2. `pytest tests/test_compiler_inspect.py -v` — feature extraction parses correctly
3. `pytest tests/ -v` — existing tests still pass (config change is backward-compatible)
4. Manual: run `/study_zoo matmul` on a few zoo models → verify principle file is generated
5. Manual: run `/optimize_subgraph` on a known zoo dispatch → compare predicted config against zoo's best_search_cycle
