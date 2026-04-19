# State Schema Reference

## File Location

`opt/dispatch_N/state.json` - one file per dispatch being optimized.

## Schema

```json
{
  "version": 1,
  "dispatch_id": 3,
  "func_name": "main_dispatch_3_matmul_128x256x512_i8xi8xi32",
  "phase": "iterate",

  "ir_analysis": {
    "dispatch_id": 3,
    "mlir_file": "benchmarks/module_main_dispatch_3_static_benchmark.mlir",
    "tile_config_file": "benchmarks/module_main_dispatch_3_static_tile_config.json",
    "func_name": "main_dispatch_3_matmul_128x256x512_i8xi8xi32",
    "translation_info": "#iree_codegen.translation_info<pipeline = CPUDoubleTilingExpert, ...>",
    "pipeline": "CPUDoubleTilingExpert",
    "target": {
      "cpu": "generic-rv64",
      "features": ["+m", "+a", "+f", "+d", "+v"],
      "triple": "riscv64-unknown-elf",
      "native_vector_size": 64,
      "abi": "lp64d"
    },
    "tensors": [
      {"mode": "readonly", "shape": [128, 512], "dtype": "i8"},
      {"mode": "readonly", "shape": [512, 256], "dtype": "i8"},
      {"mode": "readwrite", "shape": [128, 256], "dtype": "i32"}
    ],
    "operations": [
      {
        "name": "linalg.matmul-0",
        "op_type": "linalg.matmul",
        "op_index": 0,
        "iteration_space": [128, 256, 512],
        "iteration_type": ["parallel", "parallel", "reduction"],
        "tiling_levels": 6,
        "rank": 3,
        "default_tile_sizes": [[64,64,0],[32,32,0],[0,0,0],[8,32,0],[0,0,16],[0,0,0]],
        "parallel_dims": [0, 1],
        "reduction_dims": [2],
        "instruction_seq": ""
      }
    ]
  },

  "baseline": {
    "cycles": 4500000,
    "compile_time_s": 12.5,
    "run_time_s": 3.2
  },

  "best": {
    "cycles": 3200000,
    "iteration": 4,
    "transform_file": "opt/dispatch_3/transforms/iter_4.mlir",
    "description": "TransformDialectCodegen: tile [64,64] blocks, K=16, vectorize RVV"
  },

  "iteration": 7,
  "max_iterations": 15,
  "max_consecutive_non_improvements": 3,
  "consecutive_non_improvements": 2,

  "history": [
    {
      "iteration": 1,
      "description": "Tile [128,128] to blocks, K=32, vectorize, bufferize",
      "transform_file": "opt/dispatch_3/transforms/iter_1.mlir",
      "cycles": 4200000,
      "compile_time_s": 14.1,
      "accepted": true,
      "error": null
    },
    {
      "iteration": 2,
      "description": "Tile [64,64], fuse fill, K=16, vectorize for RVV LMUL=2",
      "transform_file": "opt/dispatch_3/transforms/iter_2.mlir",
      "cycles": null,
      "compile_time_s": null,
      "accepted": false,
      "error": "compile_error: handle consumed before use at line 23"
    }
  ]
}
```

## Phase Values

- `gather` - Extracting dispatch info
- `baseline` - Profiling with IREE defaults
- `iterate` - Active optimization loop
- `evaluate` - Verifying best result
- `done` - Optimization complete

## History Entry Fields

| Field | Type | Description |
|---|---|---|
| iteration | int | 1-based iteration number |
| description | str | Human-readable strategy description |
| transform_file | str | Path to the .mlir file used |
| cycles | int or null | Cycle count (null if compile failed) |
| compile_time_s | float or null | Compilation time |
| accepted | bool | Whether this became the new best |
| error | str or null | First 500 chars of error message |

## State Management API

Import from `opt/script/state.py`:

```python
from opt.script.state import (
    create_state, load_state, save_state,
    advance_phase, set_baseline, record_iteration,
    should_stop, summary, transforms_dir
)
```
