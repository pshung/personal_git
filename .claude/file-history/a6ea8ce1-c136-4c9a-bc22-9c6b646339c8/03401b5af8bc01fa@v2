# Core MLIR Transform Dialect Operations

Quick reference for upstream (non-IREE) transform ops. Grouped by category.

## Table of Contents

1. [Sequence and Control Flow](#sequence-and-control-flow)
2. [Structured (Linalg) Transforms](#structured-linalg-transforms)
3. [Match Operations](#match-operations)
4. [Handle and Parameter Operations](#handle-and-parameter-operations)
5. [Pattern Application](#pattern-application)
6. [Loop Transforms](#loop-transforms)
7. [Debug Operations](#debug-operations)

---

## Sequence and Control Flow

### transform.named_sequence
Define a reusable transform function.
```mlir
transform.named_sequence @name(%arg: !transform.any_op {transform.consumed}) -> !transform.any_op {
  // body
  transform.yield %arg : !transform.any_op
}
```
Attributes: `transform.readonly` or `transform.consumed` on each operand.

### transform.include
Call a named_sequence from another sequence. Controls failure propagation.
```mlir
%result = transform.include @callee failures(propagate) (%arg)
  : (!transform.any_op) -> !transform.any_op
```
`failures(propagate)` - propagate matcher failures up.
`failures(suppress)` - silently skip on failure.

### transform.foreach_match
Walk IR and apply matcher/action pairs. First matching pair wins for each op.
```mlir
%res = transform.foreach_match in %root
  @matcher_a -> @action_a,
  @matcher_b -> @action_b
  : (!transform.any_op) -> !transform.any_op
```
Actions should only annotate - not restructure IR - because the walk continues.

### transform.foreach
Iterate over each op in a handle, applying body to each.
```mlir
transform.foreach %handle : !transform.any_op {
^bb0(%single: !transform.any_op):
  // process one op at a time
}
```

### transform.alternatives
Try multiple strategies, use first that succeeds.
```mlir
transform.alternatives %root : !transform.any_op {
^bb0(%arg: !transform.any_op):
  // strategy 1
}, {
^bb0(%arg: !transform.any_op):
  // strategy 2 (fallback)
}
```

### transform.yield
Terminate a named_sequence, returning values.
```mlir
transform.yield %a, %b : !transform.any_op, !transform.any_param
```

---

## Structured (Linalg) Transforms

### transform.structured.match
Find operations by name within a scope.
```mlir
%found = transform.structured.match ops{["linalg.matmul"]} in %scope
  : (!transform.any_op) -> !transform.any_op
```
Can match multiple op types: `ops{["linalg.matmul", "linalg.generic"]}`.
Can also match by attributes: `attributes{sym_name = "func_name"}`.

### transform.structured.tile_using_forall
Tile an op producing scf.forall loops. Returns tiled op and the forall.
```mlir
%tiled, %forall = transform.structured.tile_using_forall %target
  tile_sizes [M, N]
  ( mapping = [#gpu.block<y>, #gpu.block<x>] )
  : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
```
Mapping types: `#gpu.block<x/y/z>`, `#gpu.thread<x/y/z>`, `#gpu.warp<x/y/z>`.
Tile size 0 means "don't tile this dimension".

### transform.structured.tile_using_for
Tile an op producing scf.for loops. Returns tiled op and loop handles.
```mlir
%tiled, %loop0, %loop1 = transform.structured.tile_using_for %target [4, 8]
  : (!transform.any_op) -> (!transform.any_op, !transform.op<"scf.for">, !transform.op<"scf.for">)
```
One loop handle per non-zero tile size.

### transform.structured.fuse_into_containing_op
Fuse a producer into an existing loop (forall/for).
```mlir
%fused, %new_loop = transform.structured.fuse_into_containing_op %producer into %loop
  : (!transform.any_op, !transform.any_op) -> (!transform.any_op, !transform.any_op)
```

### transform.structured.vectorize_children_and_apply_patterns
Vectorize all eligible linalg ops within a func, applying cleanup patterns.
```mlir
%func_v = transform.structured.vectorize_children_and_apply_patterns %func
  : (!transform.any_op) -> !transform.any_op
```

### transform.structured.vectorize
Vectorize a specific operation with given vector sizes.
```mlir
transform.structured.vectorize %target vector_sizes [16, 16, 8]
  : !transform.any_op
```

### transform.structured.pad
Pad a linalg op with given padding values.
```mlir
%padded, %pad_op, %copy = transform.structured.pad %target {
  padding_values = [0.0 : f32, 0.0 : f32, 0.0 : f32],
  padding_dimensions = [0, 1, 2],
  pack_paddings = [1, 1, 0]
} : (!transform.any_op) -> (!transform.any_op, !transform.any_op, !transform.any_op)
```

### transform.structured.interchange
Permute the iterator dimensions of a linalg op.
```mlir
%interchanged = transform.structured.interchange %target
  iterator_interchange = [1, 0, 2]
  : (!transform.any_op) -> !transform.any_op
```

### transform.structured.decompose
Decompose a linalg op into simpler ops.
```mlir
%decomposed = transform.structured.decompose %target
  : (!transform.any_op) -> !transform.any_op
```

### transform.structured.generalize
Convert a named linalg op to linalg.generic.
```mlir
%generic = transform.structured.generalize %target
  : (!transform.any_op) -> !transform.any_op
```

---

## Match Operations

### transform.match.operation_name
Assert an op has a specific name. Fails if not.
```mlir
transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
```

### transform.match.structured
Enter a structured matching block for linalg properties.
```mlir
%matched = transform.match.structured failures(propagate) %op
  : (!transform.any_op) -> !transform.any_op {
^bb0(%arg: !transform.any_op):
  // structural checks here
  transform.match.structured.yield %arg : !transform.any_op
}
```

### transform.match.structured.rank
Get the rank (number of loops) of a structured op.
```mlir
%rank = transform.match.structured.rank %op
  : (!transform.any_op) -> !transform.param<i64>
```

### transform.match.structured.dim
Check dimension properties. Can check specific dims or all dims.
```mlir
// Check last dim is reduction
transform.match.structured.dim %op[-1] {reduction} : !transform.any_op

// Check dim 0 is parallel
transform.match.structured.dim %op[0] {parallel} : !transform.any_op

// Get dim size as param
%sz = transform.match.structured.dim %op[0] : (!transform.any_op) -> !transform.param<i64>
```

### transform.match.structured.num_inputs / num_inits
Get the count of input/output operands.
```mlir
%n_ins = transform.match.structured.num_inputs %op
  : (!transform.any_op) -> !transform.param<i64>
```

### transform.match.param.cmpi
Compare two parameter values.
```mlir
transform.match.param.cmpi eq %a, %b : !transform.param<i64>
// Also: ne, lt, le, gt, ge
```

### transform.collect_matching
Collect all ops matching a named sequence within a scope.
```mlir
%matches = transform.collect_matching @my_matcher in %root
  : (!transform.any_op) -> !transform.any_op
```

---

## Handle and Parameter Operations

### transform.param.constant
Create a constant parameter value.
```mlir
%c42 = transform.param.constant 42 : i64 -> !transform.param<i64>
%config = transform.param.constant #iree_codegen.compilation_info<...> -> !transform.any_param
```

### transform.get_parent_op
Navigate up the IR tree.
```mlir
%parent = transform.get_parent_op %op {op_name = "func.func"}
  : (!transform.any_op) -> !transform.any_op
// Also: {nth_parent = 2} to skip levels
```

### transform.get_producer_of_operand
Get the op that produces a given operand.
```mlir
%producer = transform.get_producer_of_operand %op[0]
  : (!transform.any_op) -> !transform.any_op
```

### transform.get_consumers_of_result
Get ops that consume a given result.
```mlir
%consumers = transform.get_consumers_of_result %op[0]
  : (!transform.any_op) -> !transform.any_op
```

### transform.get_operand
Get a value handle for an operand.
```mlir
%val = transform.get_operand %op[0] : (!transform.any_op) -> !transform.any_value
```

### transform.get_result
Get a value handle for a result.
```mlir
%val = transform.get_result %op[0] : (!transform.any_op) -> !transform.any_value
```

### transform.split_handle
Split a multi-op handle into individual handles.
```mlir
%a, %b = transform.split_handle %combined
  : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
```

### transform.merge_handles
Combine multiple handles into one.
```mlir
%merged = transform.merge_handles %a, %b : !transform.any_op
```

### transform.annotate
Attach an attribute to an operation.
```mlir
// With parameter value
transform.annotate %op "attr_name" = %param : !transform.any_op, !transform.any_param
// Unit attribute (flag)
transform.annotate %op "flag_name" : !transform.any_op
```

### transform.cast
Cast between handle types.
```mlir
%any = transform.cast %typed : !transform.op<"linalg.matmul"> to !transform.any_op
```

---

## Pattern Application

### transform.apply_patterns to
Apply rewrite patterns to an op scope.
```mlir
transform.apply_patterns to %func {
  transform.apply_patterns.canonicalization
  transform.apply_patterns.linalg.tiling_canonicalization
  transform.apply_patterns.scf.for_loop_canonicalization
  transform.apply_patterns.tensor.reassociative_reshape_folding
  transform.apply_patterns.vector.lower_contraction {lowering_strategy = outerproduct}
  transform.apply_patterns.vector.lower_multi_reduction {lowering_strategy = innerparallel}
  transform.apply_patterns.vector.transfer_permutation_patterns
  transform.apply_patterns.vector.cast_away_vector_leading_one_dim
} : !transform.any_op
```

### transform.apply_cse
Apply common subexpression elimination.
```mlir
transform.apply_cse to %func : !transform.any_op
```

---

## Loop Transforms

### transform.loop.unroll
Unroll a loop by a factor.
```mlir
transform.loop.unroll %loop { factor = 4 } : !transform.op<"scf.for">
```

### transform.loop.outline
Extract a loop body into a separate function.
```mlir
%func, %call = transform.loop.outline %loop {func_name = "outlined_fn"}
  : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
```

### transform.loop.peel
Peel iterations from a loop (handle remainder).
```mlir
%main, %remainder = transform.loop.peel %loop
  : (!transform.op<"scf.for">) -> (!transform.any_op, !transform.any_op)
```

---

## Debug Operations

### transform.print
Print a message or an op during transform execution.
```mlir
transform.print {name = "After tiling"}
transform.print %op {name = "Current state"} : !transform.any_op
```

### transform.debug.emit_remark_at
Emit a diagnostic remark at a payload op's location.
```mlir
transform.debug.emit_remark_at %op, "matched this op" : !transform.any_op
```
