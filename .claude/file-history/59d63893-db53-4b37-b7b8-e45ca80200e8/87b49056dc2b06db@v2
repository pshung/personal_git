# Plan: Add model argument to iree-optimizer skill

## Context

Currently `/iree-optimizer <dispatch_id>` requires the model path and benchmarks dir to be resolved ad-hoc (from the user or working directory). The user wants the command to accept a model name from the `models/` directory as the first argument, with dispatch_id (or `all`) as the second.

New syntax:
- `/iree-optimizer mobilenet_f32 1` - optimize dispatch 1 of mobilenet_f32
- `/iree-optimizer mobilenet_f32 all` - optimize all dispatches of mobilenet_f32
- `/iree-optimizer status` and `/iree-optimizer reset <dispatch_id>` - unchanged

## Key observations

- Models live in `models/<name>/` with varying `.mlir` filenames (e.g., `mobilenet_f32/mobilenet.mlir`, `test/model.mlir`, `yolov5n/yolov5n.tosa.mlir`)
- The benchmarks dir is at `models/<name>/<mlir_stem>/benchmarks/` (derived from Context.lazy_init: `working_dir = model_path.parent / model_path.stem`)
- Harness scripts take `--model <relative_path>` and `--benchmarks-dir <path>` separately
- The model dir name is NOT the same as the mlir filename - resolution requires finding the `.mlir` file inside the model dir

## Changes

**File:** `/home/nick/.claude/skills/iree-optimizer/SKILL.md`

1. **Update `argument-hint`** (line 13):
   - From: `"[dispatch_id|all|status|reset] [--max-iter N]"`
   - To: `"<model> <dispatch_id|all> [--max-iter N]" or "status" or "reset <dispatch_id>"`

2. **Update Commands section** (lines 45-55) to document new syntax:
   - `/iree-optimizer <model> <dispatch_id>` - optimize one dispatch of a model
   - `/iree-optimizer <model> all` - optimize all dispatches of a model
   - `/iree-optimizer status` - unchanged
   - `/iree-optimizer reset <dispatch_id>` - unchanged

3. **Add Model Resolution section** after Commands, before Phase Execution. This tells the LLM how to resolve a model name to paths:
   - `<model>` is a directory name under `models/`
   - Find the `.mlir` file: `ls models/<model>/*.mlir` (pick the first one)
   - Derive model_path: `models/<model>/<filename>.mlir`
   - Derive benchmarks_dir: `models/<model>/<mlir_stem>/benchmarks/`
   - Validate both exist before proceeding

4. **Update all script invocations** (lines 66-69, 88-93, 137-144, 150-154) to use resolved paths instead of placeholders:
   - `--model <model_path>` stays as placeholder but add comment showing resolution
   - `--benchmarks-dir benchmarks/` becomes `--benchmarks-dir <benchmarks_dir>`

5. **Update the Important Notes** (line 228-229) to remove "Get these from the user" - now they're derived from the model argument.

## Verification

- Read the updated SKILL.md and verify the argument-hint, commands, resolution logic, and script invocations are consistent
- Mentally trace `/iree-optimizer mobilenet_f32 1`: resolves to `--model models/mobilenet_f32/mobilenet.mlir --benchmarks-dir models/mobilenet_f32/mobilenet/benchmarks/`
