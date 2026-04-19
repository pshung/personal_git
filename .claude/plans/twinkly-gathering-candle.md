# Plan: Transform Dialect Reading List (Usage-Focused)

## Context
Create `transform_dialect_reading_list.md` as LLM context input for skill creation. Focus on *how to write* Transform dialect scripts to transform MLIR IR, not implementation internals.

## Approach
Write a single file organized in recommended reading order:
1. **Documentation** - Dialect overview + tutorial series (Ch0-Ch4, ChH) with descriptions
2. **Op Definitions (.td)** - The user-facing API reference for available transform ops
3. **Test Cases** - Grouped by usage pattern (basic ops, interpreter, matching, extensions, libraries, etc.) with brief descriptions of what each demonstrates

All paths relative to `mlir/` for portability.

## Output File
`/home/nick/work/AutoIREE/third-party/iree-src/third_party/llvm-project/mlir/transform_dialect_reading_list.md`
