# Plan: Enhance parse_history.py — root op only + shape column

## Context
The current `utility/parse_history.py` outputs one CSV row per op per record. The user wants:
1. **Only show the root op** per dispatch (not fill/generic helpers) — matching the `_getRootOp` logic in `python/auto_iree/space.py:950-978`
2. **Add the shape** (iteration_space) column to the output

## Changes

### 1. Add `find_root_op()` to `utility/parse_history.py`
Reimplement `_getRootOp` logic from `python/auto_iree/space.py:950-978`:
- Priority 1: Last linalg op (reversed) that has a reduction axis
- Priority 2: Last linalg op (any)
- Priority 3: Last tensor.pad/pack/unpack op
- Input: `ops` list from the JSON record
- Returns: index of the root op

### 2. Update `parse_history_lines()`
- Call `find_root_op()` to identify which op is root
- Store root op's `iteration_space` as `shape` in the record dict

### 3. Update `format_csv()`
- Only emit one row per record (the root op)
- Add `Shape` column between `OpName` and `ConfigIndex`
- New CSV format: `Dispatch,OpName,Shape,ConfigIndex,LoweringConfig,Cycles,Status`

### 4. Update tests
- Add tests for `find_root_op()` covering all priority levels
- Update existing CSV format tests to include Shape column and single-row-per-record behavior

## Files to modify
- `utility/parse_history.py` — add `find_root_op()`, update output logic
- `tests/utility/test_parse_history.py` — add root op tests, update CSV tests

## Reference
- `python/auto_iree/space.py:950-978` — `_getRootOp()` logic to reimplement
