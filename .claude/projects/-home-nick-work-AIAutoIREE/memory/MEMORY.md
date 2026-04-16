# AIAutoIREE Project Memory

## Project Structure
- `script/dataset_generator/` - Python package for MLIR dataset generation
- `script/dataset_generator.py` - Backwards-compatible entry point (`if __name__ == "__main__": main()`)
- `tests/script/` - Tests for dataset generator
- CLI invocation: `python script/dataset_generator.py [args]` (from script/ dir)
- Pre-existing test failures in `test_context.py`, `test_iree_tuner.py`, `test_record.py`, `test_task.py` - not related to dataset_generator

## Key Conventions
- Stats dict structure: `{"named_ops": {"linalg.matmul": {"iterator_types": [...], "total_count": N, "shape_patterns": [...]}}, "generic_ops": {}}`
- Shape pattern: `{"inputs": [{"shape": [...], "dtype": "..."}], "outputs": [...], "all_dims": [...], "count": N}`
- Matmul dim order: MxNxKxdtype, A[M,K] x B[K,N] -> C[M,N], dim_sizes=[M,N,K]
- Batch matmul: BxMxNxKxdtype, dim_sizes=[B,M,N,K]
- Vecmat: NxK, Matvec: MxK
- Accumulator dtypes: i8->i32, i16->i32 (in `config.py:ACCUMULATOR_DTYPE`)

## shape_source Module (added 2026-02-06)
- `script/dataset_generator/shape_source.py` - Load shapes from text file, build stats dict
- CLI: `--shape-source`, `--pattern-source`, requires `--op-filter`
- Skips pipeline A (MLIR analysis) entirely when using shape source
