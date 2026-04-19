# Transform Dialect Pattern Library

Complete example scripts for common transformation scenarios.
Each example is production-ready and annotated with rationale.

## Table of Contents

1. [GPU Matmul - Full Codegen Strategy](#1-gpu-matmul---full-codegen-strategy)
2. [GPU Matmul - Tile and Fuse with Shared Memory](#2-gpu-matmul---tile-and-fuse-with-shared-memory)
3. [Tiling + Fusion Chain (matmul -> add -> relu)](#3-tiling--fusion-chain)
4. [Tuning Spec - MMT with Shape Matching](#4-tuning-spec---mmt-with-shape-matching)
5. [CPU Multi-Level Tiling + Vectorization](#5-cpu-multi-level-tiling--vectorization)
6. [Composable Matchers with foreach_match](#6-composable-matchers-with-foreach_match)
7. [Convolution Tiling Strategy](#7-convolution-tiling-strategy)

---

## 1. GPU Matmul - Full Codegen Strategy

A complete TransformDialectCodegen pipeline that replaces IREE's built-in
matmul codegen. Tiles to blocks, vectorizes, bufferizes, maps to GPU threads.

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @gpu_matmul_strategy(
      %variant_op: !transform.any_op) {

    // Phase 1: Find the matmul
    %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

    // Phase 2: Tile to workgroups (GPU blocks)
    // [64, 64] = each block computes a 64x64 output tile
    %tiled, %forall_grid =
      transform.structured.tile_using_forall %matmul
        tile_sizes [64, 64]
        ( mapping = [#gpu.block<y>, #gpu.block<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
    transform.iree.populate_workgroup_count_region_using_num_threads_slice
      %forall_grid : (!transform.any_op) -> ()

    // Phase 3: Tile reduction dimension for better register reuse
    // K=16 means each thread accumulates 16 elements before writing back
    %tiled_k, %loop_k = transform.structured.tile_using_for %tiled [0, 0, 16]
      : (!transform.any_op) -> (!transform.any_op, !transform.op<"scf.for">)

    // Phase 4: Vectorize everything in the func
    %func = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.apply_patterns to %func {
      transform.apply_patterns.iree.fold_reshape_into_tensor_hal_interface
      transform.apply_patterns.linalg.fold_unit_extent_dims_via_slices
      transform.apply_patterns.vector.cast_away_vector_leading_one_dim
    } : !transform.any_op
    %func_v = transform.structured.vectorize_children_and_apply_patterns %func
      : (!transform.any_op) -> !transform.any_op

    // Phase 5: Canonicalize before bufferization
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

    // Phase 6: Bufferize (tensor -> memref)
    transform.iree.eliminate_empty_tensors %variant_op
      : (!transform.any_op) -> ()
    transform.apply_patterns to %func_v {
      transform.apply_patterns.linalg.erase_unnecessary_inputs
    } : !transform.any_op
    %buf = transform.iree.bufferize { target_gpu } %func_v
      : (!transform.any_op) -> (!transform.any_op)

    // Phase 7: Map to GPU threads
    %func_final = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.iree.forall_to_workgroup %func_final
      : (!transform.any_op) -> ()
    // 16 threads in x * 4 threads in y = 64 threads per workgroup
    transform.iree.map_nested_forall_to_gpu_threads %func_final
      workgroup_dims = [16, 4, 1] : (!transform.any_op) -> ()

    transform.yield
  }

  // Wire it up: match matmul, assign strategy
  transform.named_sequence @match_matmul(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
    transform.yield %op : !transform.any_op
  }

  transform.named_sequence @set_matmul_strategy(
      %op: !transform.any_op {transform.readonly}) {
    %variant = transform.get_parent_op %op
      {op_name = "hal.executable.variant"}
      : (!transform.any_op) -> !transform.any_op
    %funcs = transform.structured.match ops{["func.func"]} in %variant
      : (!transform.any_op) -> !transform.any_op
    %info = transform.param.constant
      #iree_codegen.translation_info<
        pipeline = TransformDialectCodegen
        codegen_spec = @gpu_matmul_strategy> -> !transform.any_param
    transform.annotate %funcs "translation_info" = %info
      : !transform.any_op, !transform.any_param
    transform.yield
  }

  transform.named_sequence @__kernel_config(
      %variant_op: !transform.any_op {transform.consumed})
    -> !transform.any_op
    attributes { iree_codegen.tuning_spec_entrypoint } {
    %res = transform.foreach_match in %variant_op
      @match_matmul -> @set_matmul_strategy
      : (!transform.any_op) -> !transform.any_op
    transform.yield %res : !transform.any_op
  }
}
```

---

## 2. GPU Matmul - Tile and Fuse with Shared Memory

Aggressive strategy: two-level tiling, shared memory promotion, software
pipelining, bank conflict reduction.

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @gpu_matmul_smem_strategy(
      %variant_op: !transform.any_op) {

    %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

    // Level 1: Tile to workgroups [128, 128]
    %tiled_wg, %forall_wg =
      transform.structured.tile_using_forall %matmul
        tile_sizes [128, 128]
        ( mapping = [#gpu.block<y>, #gpu.block<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
    transform.iree.populate_workgroup_count_region_using_num_threads_slice
      %forall_wg : (!transform.any_op) -> ()

    // Level 2: Tile to threads [16, 16] within each workgroup
    %tiled_th, %forall_th =
      transform.structured.tile_using_forall %tiled_wg
        tile_sizes [16, 16]
        ( mapping = [#gpu.thread<y>, #gpu.thread<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

    // Tile reduction: K tiles of 32
    %tiled_k, %loop_k = transform.structured.tile_using_for %tiled_th [0, 0, 32]
      : (!transform.any_op) -> (!transform.any_op, !transform.op<"scf.for">)

    // Promote LHS and RHS to shared memory
    %promoted = transform.iree.promote_operands %tiled_k [0, 1]
      : (!transform.any_op) -> !transform.any_op

    // Vectorize
    %func = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.apply_patterns to %func {
      transform.apply_patterns.iree.fold_reshape_into_tensor_hal_interface
      transform.apply_patterns.linalg.fold_unit_extent_dims_via_slices
      transform.apply_patterns.vector.cast_away_vector_leading_one_dim
    } : !transform.any_op
    %func_v = transform.structured.vectorize_children_and_apply_patterns %func
      : (!transform.any_op) -> !transform.any_op

    // Canonicalize + bufferize
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
    transform.iree.eliminate_empty_tensors %variant_op
      : (!transform.any_op) -> ()
    transform.apply_patterns to %func_v {
      transform.apply_patterns.linalg.erase_unnecessary_inputs
    } : !transform.any_op
    %buf = transform.iree.bufferize { target_gpu } %func_v
      : (!transform.any_op) -> (!transform.any_op)

    // Post-bufferization: GPU mapping + shared memory optimization
    %func_post = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.iree.forall_to_workgroup %func_post
      : (!transform.any_op) -> ()
    // 128/16 = 8 threads per dim, 8*8 = 64 threads per workgroup
    transform.iree.map_nested_forall_to_gpu_threads %func_post
      workgroup_dims = [8, 8, 1] : (!transform.any_op) -> ()

    // Distribute shared memory copies across threads
    transform.iree.gpu_distribute_shared_memory_copy %func_post
      : (!transform.any_op) -> ()
    // Reduce bank conflicts by adding padding
    transform.iree.reduce_shared_memory_bank_conflicts %func_post
      : (!transform.any_op) -> ()
    // Double-buffer shared memory for latency hiding
    transform.iree.pipeline_shared_memory_copies %func_post { depth = 2 }
      : (!transform.any_op) -> ()

    transform.yield
  }
}
```

---

## 3. Tiling + Fusion Chain

Tile the last op in a chain (relu), then fuse producers (add, matmul) into
the tiled loop. This is how you handle matmul -> bias_add -> activation.

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @__transform_main(
      %module: !transform.any_op,
      %matmul: !transform.op<"linalg.matmul">,
      %elemwise: !transform.op<"linalg.elemwise_binary">) {

    // elemwise handle matches both add and relu - split them
    %add, %relu = transform.split_handle %elemwise
      : (!transform.op<"linalg.elemwise_binary">)
      -> (!transform.any_op, !transform.any_op)

    // Tile the last op (relu) - this creates the outer loop
    %tiled_relu, %forall = transform.structured.tile_using_forall %relu
      tile_sizes [32, 32]
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

    // Fuse add into the loop (add feeds relu)
    %fused_add, %forall_1 =
      transform.structured.fuse_into_containing_op %add into %forall
      : (!transform.any_op, !transform.any_op)
      -> (!transform.any_op, !transform.any_op)

    // Fuse matmul into the loop (matmul feeds add)
    %fused_matmul, %forall_2 =
      transform.structured.fuse_into_containing_op %matmul into %forall_1
      : (!transform.op<"linalg.matmul">, !transform.any_op)
      -> (!transform.any_op, !transform.any_op)

    // Now all three ops execute within a single 32x32 tiled loop
    transform.yield
  }
}
```

---

## 4. Tuning Spec - MMT with Shape Matching

Annotation-only tuning spec: matches MMT (matrix-multiply-transpose) operations
by DAG structure and specific tensor shapes, then annotates with compilation info.

```mlir
module @mmt_tuning_spec attributes { transform.with_named_sequence } {

  // Reusable base matcher: identifies f16*f16->f32 MMT pattern
  transform.named_sequence @match_mmt_f16_f16_f32(
      %root: !transform.any_op {transform.readonly}) -> !transform.any_op {
    transform.match.operation_name %root ["linalg.generic"] : !transform.any_op
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
    transform.yield %root : !transform.any_op
  }

  // Shape-specific matcher: 2048x1280 with K=5120
  transform.named_sequence @match_mmt_2048x1280x5120(
      %op: !transform.any_op {transform.readonly})
    -> (!transform.any_op, !transform.any_param) {
    %mmt = transform.include @match_mmt_f16_f16_f32 failures(propagate) (%op)
      : (!transform.any_op) -> !transform.any_op
    %lhs = transform.get_operand %op[0] : (!transform.any_op) -> !transform.any_value
    %rhs = transform.get_operand %op[1] : (!transform.any_op) -> !transform.any_value
    transform.iree.match.cast_compatible_type %lhs = tensor<2048x5120xf16>
      : !transform.any_value
    transform.iree.match.cast_compatible_type %rhs = tensor<1280x5120xf16>
      : !transform.any_value
    %config = transform.param.constant #iree_codegen.compilation_info<
      lowering_config = #iree_gpu.lowering_config<{
        promote_operands = [0, 1],
        mma_kind = #iree_gpu.mma_layout<MFMA_F32_16x16x16_F16>,
        subgroup_m_count = 2, subgroup_n_count = 2,
        reduction = [0, 0, 64],
        workgroup = [64, 128, 0]}>,
      translation_info = #iree_codegen.translation_info<
        pipeline = LLVMGPUVectorDistribute
        workgroup_size = [256, 1, 1] subgroup_size = 64,
        {gpu_pipeline_options = #iree_gpu.pipeline_options<
          prefetch_shared_memory = true>}>
    > -> !transform.any_param
    transform.yield %op, %config : !transform.any_op, !transform.any_param
  }

  // Generic annotator
  transform.named_sequence @apply_op_config(
      %op: !transform.any_op {transform.readonly},
      %config: !transform.any_param {transform.readonly}) {
    transform.annotate %op "compilation_info" = %config
      : !transform.any_op, !transform.any_param
    transform.annotate %op "__tuning_spec_applied__" : !transform.any_op
    transform.yield
  }

  // Entry point
  transform.named_sequence @__kernel_config(
      %variant_op: !transform.any_op {transform.consumed})
    -> !transform.any_op
    attributes { iree_codegen.tuning_spec_entrypoint } {
    %res = transform.foreach_match in %variant_op
      @match_mmt_2048x1280x5120 -> @apply_op_config
      : (!transform.any_op) -> !transform.any_op
    transform.yield %res : !transform.any_op
  }
}
```

---

## 5. CPU Multi-Level Tiling + Vectorization

Two-level tiling for cache hierarchy, then vectorize. No GPU mapping needed.

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @cpu_matmul_strategy(
      %variant_op: !transform.any_op) {

    %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

    // L2 cache tile: [64, 64, 0] - parallelize M and N
    %tiled_l2, %forall_l2 =
      transform.structured.tile_using_forall %matmul
        tile_sizes [64, 64]
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

    // L1 cache tile + reduction: [8, 8, 32]
    %tiled_l1, %loop_m, %loop_n, %loop_k =
      transform.structured.tile_using_for %tiled_l2 [8, 8, 32]
      : (!transform.any_op) -> (!transform.any_op,
          !transform.op<"scf.for">, !transform.op<"scf.for">,
          !transform.op<"scf.for">)

    // Vectorize
    %func = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    %func_v = transform.structured.vectorize_children_and_apply_patterns %func
      : (!transform.any_op) -> !transform.any_op

    // Lower vectors for CPU
    transform.apply_patterns to %func_v {
      transform.apply_patterns.vector.lower_contraction
        {lowering_strategy = outerproduct}
      transform.apply_patterns.vector.transfer_permutation_patterns
      transform.apply_patterns.vector.lower_multi_reduction
        {lowering_strategy = innerparallel}
    } : !transform.any_op

    // Canonicalize + bufferize
    transform.apply_patterns to %func_v {
      transform.apply_patterns.linalg.tiling_canonicalization
      transform.apply_patterns.scf.for_loop_canonicalization
      transform.apply_patterns.canonicalization
    } : !transform.any_op
    transform.apply_cse to %func_v : !transform.any_op
    transform.iree.eliminate_empty_tensors %variant_op
      : (!transform.any_op) -> ()
    %buf = transform.iree.bufferize %func_v
      : (!transform.any_op) -> (!transform.any_op)

    transform.yield
  }
}
```

---

## 6. Composable Matchers with foreach_match

Multiple matcher/action pairs for different op types in the same dispatch.

```mlir
module attributes { transform.with_named_sequence } {

  // Matcher: matmul ops
  transform.named_sequence @match_matmul(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
    transform.yield %op : !transform.any_op
  }

  // Matcher: reduction ops (generic with reduction on last dim)
  transform.named_sequence @match_reduce(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.generic"] : !transform.any_op
    %matched = transform.match.structured failures(propagate) %op
      : (!transform.any_op) -> !transform.any_op {
    ^bb0(%arg: !transform.any_op):
      %c2 = transform.param.constant 2 : i64 -> !transform.param<i64>
      %rank = transform.match.structured.rank %arg
        : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %rank, %c2 : !transform.param<i64>
      transform.match.structured.dim %arg[-1] {reduction} : !transform.any_op
      transform.match.structured.yield %arg : !transform.any_op
    }
    transform.yield %matched : !transform.any_op
  }

  // Action: configure matmul for TransformDialectCodegen
  transform.named_sequence @configure_matmul(
      %op: !transform.any_op {transform.readonly}) {
    %variant = transform.get_parent_op %op
      {op_name = "hal.executable.variant"}
      : (!transform.any_op) -> !transform.any_op
    %funcs = transform.structured.match ops{["func.func"]} in %variant
      : (!transform.any_op) -> !transform.any_op
    %info = transform.param.constant
      #iree_codegen.translation_info<
        pipeline = TransformDialectCodegen
        codegen_spec = @matmul_codegen> -> !transform.any_param
    transform.annotate %funcs "translation_info" = %info
      : !transform.any_op, !transform.any_param
    transform.yield
  }

  // Action: configure reduce with tile sizes
  transform.named_sequence @configure_reduce(
      %op: !transform.any_op {transform.readonly}) {
    %variant = transform.get_parent_op %op
      {op_name = "hal.executable.variant"}
      : (!transform.any_op) -> !transform.any_op
    %config = transform.param.constant
      #iree_codegen.lowering_config<tile_sizes = [[8, 0], [1, 0], [0, 0, 4]]>
      -> !transform.any_param
    transform.annotate %op "lowering_config" = %config
      : !transform.any_op, !transform.any_param
    %funcs = transform.structured.match ops{["func.func"]} in %variant
      : (!transform.any_op) -> !transform.any_op
    %info = transform.param.constant
      #iree_codegen.translation_info<
        pipeline = SPIRVBaseVectorize workgroup_size = [16, 1, 1]>
      -> !transform.any_param
    transform.annotate %funcs "translation_info" = %info
      : !transform.any_op, !transform.any_param
    transform.yield
  }

  // Dispatch: first match wins for each op
  transform.named_sequence @kernel_config(
      %variant_op: !transform.any_op {transform.consumed}) {
    transform.foreach_match in %variant_op
      @match_matmul -> @configure_matmul,
      @match_reduce -> @configure_reduce
      : (!transform.any_op) -> (!transform.any_op)
    transform.yield
  }
}
```

---

## 7. Convolution Tiling Strategy

Tiling a 2D convolution with output channel and spatial tiling,
then vectorizing. Demonstrates interchange for loop order optimization.

```mlir
module attributes { transform.with_named_sequence } {

  transform.named_sequence @conv2d_strategy(
      %variant_op: !transform.any_op) {

    %conv = transform.structured.match ops{["linalg.conv_2d_nhwc_hwcf"]}
      in %variant_op : (!transform.any_op) -> !transform.any_op

    // Tile output: batch=1, height=4, width=4, out_channels=32
    %tiled, %forall = transform.structured.tile_using_forall %conv
      tile_sizes [1, 4, 4, 32]
      ( mapping = [#gpu.block<z>, #gpu.block<y>, #gpu.block<x>,
                   #gpu.thread<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
    transform.iree.populate_workgroup_count_region_using_num_threads_slice
      %forall : (!transform.any_op) -> ()

    // Tile reduction dims: kh=1, kw=1, ic=16
    %tiled_r, %lp0, %lp1, %lp2 =
      transform.structured.tile_using_for %tiled [0, 0, 0, 0, 1, 1, 16]
      : (!transform.any_op) -> (!transform.any_op,
          !transform.op<"scf.for">, !transform.op<"scf.for">,
          !transform.op<"scf.for">)

    // Vectorize
    %func = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.apply_patterns to %func {
      transform.apply_patterns.iree.fold_reshape_into_tensor_hal_interface
      transform.apply_patterns.linalg.fold_unit_extent_dims_via_slices
    } : !transform.any_op
    %func_v = transform.structured.vectorize_children_and_apply_patterns %func
      : (!transform.any_op) -> !transform.any_op

    // Bufferize
    transform.apply_patterns to %func_v {
      transform.apply_patterns.canonicalization
    } : !transform.any_op
    transform.apply_cse to %func_v : !transform.any_op
    transform.iree.eliminate_empty_tensors %variant_op
      : (!transform.any_op) -> ()
    %buf = transform.iree.bufferize { target_gpu } %func_v
      : (!transform.any_op) -> (!transform.any_op)

    // GPU thread mapping
    %func_final = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.iree.forall_to_workgroup %func_final
      : (!transform.any_op) -> ()
    transform.iree.map_nested_forall_to_gpu_threads %func_final
      workgroup_dims = [32, 4, 1] : (!transform.any_op) -> ()

    transform.yield
  }
}
```

---

## Common Pitfalls

1. **Forgetting to re-match func after structural changes**: After tiling
   creates new loops, the old func handle may be stale. Always re-match
   `ops{["func.func"]}` before vectorization/bufferization.

2. **Wrong order of eliminate_empty_tensors**: Must be called on the module/
   variant level BEFORE `bufferize`, or empty tensors become unnecessary allocs.

3. **Missing populate_workgroup_count**: Without
   `populate_workgroup_count_region_using_num_threads_slice`, IREE doesn't
   know how many workgroups to launch.

4. **Tile size 0 vs omitted**: `tile_sizes [64, 0, 32]` tiles dims 0 and 2
   but not dim 1. This is different from `tile_sizes [64, 32]` which tiles
   only dims 0 and 1.

5. **foreach_match actions must not restructure IR**: The walk continues
   after each match. Actions should only annotate. Put structural transforms
   in a separate codegen_spec sequence.

6. **Handle invalidation after fusion**: `fuse_into_containing_op` consumes
   the producer handle and the loop handle. Use the returned new handles.
