---
name: mlir-transform-writer
description: >
  Write MLIR transform dialect scripts that directly control IR lowering -
  tiling, fusion, vectorization, bufferization, GPU thread mapping, shared
  memory promotion, and more. Use this skill whenever someone asks to generate,
  write, or modify a transform dialect script, transform library, codegen
  strategy, or tuning spec in MLIR. Also trigger when the request involves
  composing IR transformations for linalg ops, controlling IREE codegen
  pipelines via transform dialect, or replacing annotation-only configs with
  full transform strategies. Covers both upstream MLIR transform ops and
  IREE-specific extensions.
---

# MLIR Transform Dialect Script Writer

You write MLIR transform dialect scripts that directly manipulate IR through
explicit transformation sequences. These scripts replace or extend IREE's
built-in codegen heuristics with hand-crafted (or auto-generated) strategies.

## When to read reference files

The `references/` directory contains op catalogs and pattern libraries.
Read them when you need to look up exact op syntax, available parameters,
or complete examples:

- `references/core_ops.md` - Upstream MLIR transform ops (structured, loop, match, etc.)
- `references/iree_ops.md` - IREE-specific transform extensions (GPU, CPU, bufferize, etc.)
- `references/patterns.md` - Complete example scripts with commentary

Always read the relevant reference file before writing a script that uses
ops you haven't used recently in this conversation.

## Core mental model

Transform dialect operates on two IRs simultaneously:

1. **Payload IR** - The program being transformed (linalg ops, tensor ops, etc.)
2. **Transform IR** - The script that describes what transformations to apply

Transform ops consume and produce **handles** that reference payload IR:
- `!transform.any_op` - references one or more operations
- `!transform.any_value` - references one or more SSA values
- `!transform.any_param` - carries attribute parameters (tile sizes, configs, etc.)
- `!transform.op<"linalg.matmul">` - typed handle (only matches that specific op)

Handles get **invalidated** when the payload they point to is modified or erased.
A consumed handle cannot be used after the transform that consumed it.

## Script structure

Every transform script follows this skeleton:

```mlir
module attributes { transform.with_named_sequence } {

  // Entry point - the interpreter starts here
  transform.named_sequence @__transform_main(
      %variant_op: !transform.any_op {transform.consumed}) {
    // ... transformation logic ...
    transform.yield
  }
}
```

For IREE kernel config / tuning specs, the entry point uses a different
convention:

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @__kernel_config(
      %variant_op: !transform.any_op {transform.consumed})
    -> !transform.any_op
    attributes { iree_codegen.tuning_spec_entrypoint } {
    // ... matcher/annotator logic ...
    transform.yield %variant_op : !transform.any_op
  }
}
```

For full codegen strategies (TransformDialectCodegen pipeline), the strategy
is a named sequence referenced from the annotation:

```mlir
module attributes { transform.with_named_sequence } {

  // The actual codegen strategy
  transform.named_sequence @my_strategy(%variant_op: !transform.any_op) {
    // ... full lowering pipeline ...
    transform.yield
  }

  // Matcher that selects ops and assigns the strategy
  transform.named_sequence @match_target(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
    transform.yield %op : !transform.any_op
  }

  // Annotator that wires up the strategy
  transform.named_sequence @annotate_target(
      %op: !transform.any_op {transform.readonly}) {
    %variant = transform.get_parent_op %op
      {op_name = "hal.executable.variant"} : (!transform.any_op) -> !transform.any_op
    %funcs = transform.structured.match ops{["func.func"]} in %variant
      : (!transform.any_op) -> !transform.any_op
    %info = transform.param.constant
      #iree_codegen.translation_info<
        pipeline = TransformDialectCodegen
        codegen_spec = @my_strategy> -> !transform.any_param
    transform.annotate %funcs "translation_info" = %info
      : !transform.any_op, !transform.any_param
    transform.yield
  }

  // Entry: walk IR matching ops to strategies
  transform.named_sequence @__kernel_config(
      %variant_op: !transform.any_op {transform.consumed})
    -> !transform.any_op
    attributes { iree_codegen.tuning_spec_entrypoint } {
    %res = transform.foreach_match in %variant_op
      @match_target -> @annotate_target
      : (!transform.any_op) -> !transform.any_op
    transform.yield %res : !transform.any_op
  }
}
```

## GPU codegen strategy template

A full GPU codegen strategy typically follows these phases in order.
Not every phase is needed for every kernel - skip phases that don't apply.

### Phase 1: Target the operation

```mlir
%matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
  : (!transform.any_op) -> !transform.any_op
```

### Phase 2: Tile to grid (workgroup/block level)

```mlir
%tiled, %forall = transform.structured.tile_using_forall %matmul
  tile_sizes [BLOCK_M, BLOCK_N]
  ( mapping = [#gpu.block<y>, #gpu.block<x>] )
  : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
transform.iree.populate_workgroup_count_region_using_num_threads_slice %forall
  : (!transform.any_op) -> ()
```

### Phase 3: Fuse producers/consumers into the tiled loop

```mlir
%producer_fused, %new_loop =
  transform.structured.fuse_into_containing_op %producer into %forall
  : (!transform.any_op, !transform.any_op) -> (!transform.any_op, !transform.any_op)
```

### Phase 4: Tile to threads (second level tiling)

```mlir
%tiled_thread, %forall_thread =
  transform.structured.tile_using_forall %tiled
  tile_sizes [THREAD_M, THREAD_N]
  ( mapping = [#gpu.thread<y>, #gpu.thread<x>] )
  : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
```

### Phase 5: Promote operands to shared memory

```mlir
transform.iree.promote_operands %tiled_thread [0, 1]
  : (!transform.any_op) -> !transform.any_op
```

### Phase 6: Vectorize

```mlir
%func = transform.structured.match ops{["func.func"]} in %variant_op
  : (!transform.any_op) -> !transform.any_op
transform.apply_patterns to %func {
  transform.apply_patterns.iree.fold_reshape_into_tensor_hal_interface
  transform.apply_patterns.linalg.fold_unit_extent_dims_via_slices
  transform.apply_patterns.vector.cast_away_vector_leading_one_dim
} : !transform.any_op
%func_v = transform.structured.vectorize_children_and_apply_patterns %func
  : (!transform.any_op) -> !transform.any_op
```

### Phase 7: Bufferize

```mlir
transform.apply_patterns to %func_v {
  transform.apply_patterns.iree.fold_fill_into_pad
  transform.apply_patterns.linalg.tiling_canonicalization
  transform.apply_patterns.scf.for_loop_canonicalization
} : !transform.any_op
transform.apply_patterns to %func_v {
  transform.apply_patterns.tensor.reassociative_reshape_folding
  transform.apply_patterns.canonicalization
} : !transform.any_op
transform.apply_cse to %func_v : !transform.any_op
transform.iree.eliminate_empty_tensors %variant_op : (!transform.any_op) -> ()
transform.apply_patterns to %func_v {
  transform.apply_patterns.linalg.erase_unnecessary_inputs
} : !transform.any_op
%memref_func = transform.iree.bufferize { target_gpu } %func_v
  : (!transform.any_op) -> (!transform.any_op)
```

### Phase 8: Map to GPU threads and workgroups

```mlir
%func_final = transform.structured.match ops{["func.func"]} in %variant_op
  : (!transform.any_op) -> !transform.any_op
transform.iree.forall_to_workgroup %func_final : (!transform.any_op) -> ()
transform.iree.map_nested_forall_to_gpu_threads %func_final
  workgroup_dims = [WARP_X, WARP_Y, 1] : (!transform.any_op) -> ()
```

### Phase 9: Post-bufferization optimization (optional)

```mlir
// Shared memory bank conflict reduction
transform.iree.reduce_shared_memory_bank_conflicts %func_final
  : (!transform.any_op) -> ()
// Software pipelining for shared memory copies
transform.iree.pipeline_shared_memory_copies %func_final { depth = 2 }
  : (!transform.any_op) -> ()
```

## CPU codegen strategy template

CPU strategies are simpler - no GPU mapping, but may include loop unrolling
and CPU-specific vectorization.

```mlir
transform.named_sequence @cpu_strategy(%variant_op: !transform.any_op) {
  %target = transform.structured.match ops{["linalg.matmul"]} in %variant_op
    : (!transform.any_op) -> !transform.any_op

  // Multi-level tiling
  %tiled_l1, %loop_l1 = transform.structured.tile_using_forall %target
    tile_sizes [M1, N1] : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
  %tiled_l2, %loop_l2 = transform.structured.tile_using_for %tiled_l1
    [M2, N2, K2] : (!transform.any_op) -> (!transform.any_op, !transform.op<"scf.for">,
                                             !transform.op<"scf.for">, !transform.op<"scf.for">)

  // Vectorize
  %func = transform.structured.match ops{["func.func"]} in %variant_op
    : (!transform.any_op) -> !transform.any_op
  %func_v = transform.structured.vectorize_children_and_apply_patterns %func
    : (!transform.any_op) -> !transform.any_op

  // Lower vectors
  transform.apply_patterns to %func_v {
    transform.apply_patterns.vector.lower_contraction {lowering_strategy = outerproduct}
    transform.apply_patterns.vector.lower_multi_reduction {lowering_strategy = innerparallel}
    transform.apply_patterns.vector.transfer_permutation_patterns
  } : !transform.any_op

  // Bufferize
  transform.iree.eliminate_empty_tensors %variant_op : (!transform.any_op) -> ()
  %buf = transform.iree.bufferize %func_v : (!transform.any_op) -> (!transform.any_op)

  transform.yield
}
```

## Matching patterns

### Match by operation name
```mlir
transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
```

### Match by structural properties
```mlir
%matched = transform.match.structured failures(propagate) %op
  : (!transform.any_op) -> !transform.any_op {
^bb0(%arg: !transform.any_op):
  // Check rank
  %c3 = transform.param.constant 3 : i64 -> !transform.param<i64>
  %rank = transform.match.structured.rank %arg : (!transform.any_op) -> !transform.param<i64>
  transform.match.param.cmpi eq %rank, %c3 : !transform.param<i64>
  // Check reduction dimension
  transform.match.structured.dim %arg[-1] {reduction} : !transform.any_op
  transform.match.structured.yield %arg : !transform.any_op
}
```

### Match by DAG structure (IREE - cast-compatible types)
```mlir
%ins, %outs = transform.iree.match.cast_compatible_dag_from_root %root {
  ^bb0(%lhs: tensor<?x?xf16>, %rhs: tensor<?x?xf16>, %out: tensor<?x?xf32>):
  %r = linalg.generic {
    indexing_maps = [affine_map<(d0, d1, d2) -> (d0, d2)>,
                     affine_map<(d0, d1, d2) -> (d1, d2)>,
                     affine_map<(d0, d1, d2) -> (d0, d1)>],
    iterator_types = ["parallel", "parallel", "reduction"]}
    ins(%lhs, %rhs : tensor<?x?xf16>, tensor<?x?xf16>)
    outs(%out : tensor<?x?xf32>) {
  ^bb0(%in: f16, %in_0: f16, %acc: f32):
    %0 = arith.extf %in : f16 to f32
    %1 = arith.extf %in_0 : f16 to f32
    %2 = arith.mulf %0, %1 : f32
    %3 = arith.addf %acc, %2 : f32
    linalg.yield %3 : f32
  } -> tensor<?x?xf32>
} : (!transform.any_op) -> (!transform.any_value, !transform.any_value)
```

### Match specific tensor shapes
```mlir
%lhs = transform.get_operand %op[0] : (!transform.any_op) -> !transform.any_value
transform.iree.match.cast_compatible_type %lhs = tensor<2048x5120xf16>
  : !transform.any_value
```

### Compose matchers via include
```mlir
transform.named_sequence @match_specific_mmt(
    %op: !transform.any_op {transform.readonly})
  -> (!transform.any_op, !transform.any_param) {
  // First check it's an MMT pattern
  %mmt = transform.include @match_mmt_f16_f16_f32 failures(propagate) (%op)
    : (!transform.any_op) -> !transform.any_op
  // Then check specific shapes
  %lhs = transform.get_operand %op[0] : (!transform.any_op) -> !transform.any_value
  transform.iree.match.cast_compatible_type %lhs = tensor<2048x5120xf16>
    : !transform.any_value
  // Yield with config
  %config = transform.param.constant #iree_codegen.compilation_info<...>
    -> !transform.any_param
  transform.yield %op, %config : !transform.any_op, !transform.any_param
}
```

## Critical rules

1. **Handle invalidation**: After a transform consumes a handle, that handle is dead.
   Re-match if you need to reference the same payload later.

2. **Re-match after structural changes**: After tiling or fusion, the original op
   handle points to the tiled/fused version. If you need the parent func, re-match it.

3. **Order matters**: Tile before fuse. Fuse before vectorize. Vectorize before
   bufferize. Bufferize before GPU mapping. Breaking this order produces invalid IR.

4. **Consumed vs readonly**: Mark operands `{transform.readonly}` in matchers
   (they inspect but don't modify). Mark `{transform.consumed}` in entry points
   that modify IR.

5. **foreach_match semantics**: The matcher/action pairs in `foreach_match` walk
   the IR. Actions should only annotate, not restructure IR, because the walk
   continues after each match.

6. **Type consistency**: Every handle flows through typed SSA. If a transform
   returns `!transform.any_op`, you can pass it where `!transform.any_op` is
   expected. Use `!transform.op<"specific.op">` for compile-time type safety.

7. **yield is mandatory**: Every `transform.named_sequence` must end with
   `transform.yield` (with or without return values matching the signature).

## How to use this skill

When given a natural language description of a desired transformation:

1. Identify the **target operations** (matmul, conv, generic, etc.)
2. Identify the **target backend** (GPU with shared memory, CPU, etc.)
3. Determine the **transformation phases** needed
4. Check `references/` for exact op syntax if unsure
5. Write the complete script with proper handle threading
6. Add comments explaining each phase

The output must be a syntactically valid `.mlir` file that can be passed to
`iree-opt` or used as a `--iree-codegen-transform-dialect-library`.
