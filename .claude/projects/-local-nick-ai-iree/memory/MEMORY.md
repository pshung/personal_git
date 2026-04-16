# IREE Dataset Generator Memory

## Project Structure
- Main package: `script/dataset_generator/`
- Tests: `tests/script/test_dataset_generator.py` + `tests/script/test_pattern_id_filter.py`
- Run tests: `pytest tests/` (use system `pytest`, not `python3 -m pytest`)
- Config: `config/tiling_search_space.toml` for search space params

## Key Design Decisions
- Single strategy: `DistVectorStrategy` (dist_vector) is the only tiling strategy
- `strategy_vector_dist.py` was deleted; no `--strategy` CLI arg
- `format_search_space_header()` hardcodes `strategy_name="dist_vector"` (no param)
- `generate_tile_configs_from_statistics()` creates `DistVectorStrategy()` internally (no `strategy_map` param)
- `V_OUTER_EXHAUSTIVE` config in `config.py` + TOML `[vector]` section

## Common Gotchas
- Multiple test files may import from `dataset_generator.cli` — check `test_pattern_id_filter.py` too
- `conftest.py` adds `script/` to sys.path; package is not pip-installed
- TOML loading uses `tomllib` (Python 3.11+), loaded via `load_search_space_config()`
