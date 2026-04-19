# IREE Transform Dialect Extensions

IREE-specific transform ops, organized by domain. These extend upstream MLIR
transform dialect with GPU codegen, bufferization, and workgroup management.

## Table of Contents

1. [GPU Thread and Workgroup Mapping](#gpu-thread-and-workgroup-mapping)
2. [Shared Memory and Promotion](#shared-memory-and-promotion)
3. [Bufferization](#bufferization)
4. [Pattern Applications (IREE-specific)](#pattern-applications-iree-specific)
5. [MMA and Tensor Core](#mma-and-tensor-core)
6. [Matching (IREE-specific)](#matching-iree-specific)
7. [Flow and Dispatch](#flow-and-dispatch)
8. [Codegen Attributes](#codegen-attributes)

---

## GPU Thread and Workgroup Mapping

### transform.iree.forall_to_workgroup
Convert scf.forall loops to workgroup distribution using hal.workgroup.id.
```mlir
transform.iree.forall_to_workgroup %func : (!transform.any_op) -> ()
```

### transform.iree.map_nested_forall_to_gpu_threads
Map nested scf.forall ops to gpu.thread_id. Supports up to 3D thread grids.
```mlir
transform.iree.map_nested_forall_to_gpu_threads %func
  workgroup_dims = [64, 4, 1] : (!transform.any_op) -> ()
```
`workgroup_dims` = [x, y, z] thread counts per workgroup.

### transform.iree.populate_workgroup_count_region_using_num_threads_slice
Populate the workgroup_count region from scf.forall's num_threads.
Must be called on the forall op produced by tile_using_forall.
```mlir
transform.iree.populate_workgroup_count_region_using_num_threads_slice %forall
  : (!transform.any_op) -> ()
```

### transform.iree.flatten_forall_mapping
Flatten multi-dimensional thread mappings to a linear index.
```mlir
transform.iree.flatten_forall_mapping %func : (!transform.any_op) -> ()
```

---

## Shared Memory and Promotion

### transform.iree.promote_operands
Promote specified operands to shared memory (higher memory space).
```mlir
transform.iree.promote_operands %op [0, 1] : (!transform.any_op) -> !transform.any_op
```
Operand indices specify which inputs to promote.

### transform.iree.gpu_distribute_shared_memory_copy
Distribute shared memory copies across workgroup threads.
```mlir
transform.iree.gpu_distribute_shared_memory_copy %func
  : (!transform.any_op) -> ()
```

### transform.iree.reduce_shared_memory_bank_conflicts
Add padding to shared memory allocations to avoid bank conflicts.
```mlir
transform.iree.reduce_shared_memory_bank_conflicts %func
  : (!transform.any_op) -> ()
```

### transform.iree.pipeline_shared_memory_copies
Software pipelining for shared memory copies within loops.
```mlir
transform.iree.pipeline_shared_memory_copies %func { depth = 2 }
  : (!transform.any_op) -> ()
```
`depth` controls pipeline stages (2 = double buffering).

### transform.iree.prefetch_shared_memory_copies
Prefetch shared memory copies within loop bodies.
```mlir
transform.iree.prefetch_shared_memory_copies %func
  : (!transform.any_op) -> ()
```

### transform.iree.pack_shared_memory_alloc
Pack overlapping shared memory allocations to reduce total usage.
```mlir
transform.iree.pack_shared_memory_alloc %func : (!transform.any_op) -> ()
```

### transform.iree.create_async_groups
Convert shared memory copies to async copies with group management.
```mlir
transform.iree.create_async_groups %func : (!transform.any_op) -> ()
```

### transform.iree.hoist_static_alloc
Hoist static allocations to function entry.
```mlir
transform.iree.hoist_static_alloc %func : (!transform.any_op) -> ()
```

---

## Bufferization

### transform.iree.bufferize
One-shot bufferization with IREE-specific patterns.
```mlir
%buf_func = transform.iree.bufferize { target_gpu } %func
  : (!transform.any_op) -> (!transform.any_op)
```
`target_gpu` flag enables GPU-specific bufferization choices.
Without the flag, uses default (CPU) bufferization.

### transform.iree.eliminate_empty_tensors
Remove tensor.empty ops before bufferization (they become allocs otherwise).
```mlir
transform.iree.eliminate_empty_tensors %variant_op : (!transform.any_op) -> ()
```
Call on the variant/module level, not func level.

---

## Pattern Applications (IREE-specific)

Use within `transform.apply_patterns to %func { ... } : !transform.any_op`.

### Reshape and folding patterns
```mlir
transform.apply_patterns.iree.fold_reshape_into_tensor_hal_interface
transform.apply_patterns.iree.fold_fill_into_pad
transform.apply_patterns.iree.fold_tensor_slice_into_transfer
transform.apply_patterns.iree.bubble_collapse
transform.apply_patterns.iree.bubble_expand
transform.apply_patterns.iree.bubble_pack_unpack
```

### Fusion patterns
```mlir
transform.apply_patterns.iree.linalg_elementwise_greedy_fusion
```

### Loop patterns
```mlir
transform.apply_patterns.iree.hoist_forall_from_for
```

### Vector patterns (GPU-specific)
```mlir
transform.apply_patterns.iree.prepare_vector_to_mma
transform.apply_patterns.iree.unroll_vectors_gpu_mma_sync
transform.apply_patterns.iree.unroll_vectors_gpu_wmma_sync
```

### Multi-MMA patterns
```mlir
transform.apply_patterns.iree.drop_multi_mma_unit_dims
transform.apply_patterns.iree.lower_multi_mma
transform.apply_patterns.iree.lower_barrier_region
transform.apply_patterns.iree.lower_value_barrier
transform.apply_patterns.iree.unroll_multi_mma
transform.apply_patterns.iree.vectorize_iree_gpu
```

---

## MMA and Tensor Core

### transform.iree.vector.to_warp_execute_on_lane_0
Convert predicated regions to warp-level execution.
```mlir
transform.iree.vector.to_warp_execute_on_lane_0 %func
  : (!transform.any_op) -> ()
```

### transform.iree.vector.warp_distribute
Apply warp-level vector distribution patterns.
```mlir
transform.iree.vector.warp_distribute %func
  : (!transform.any_op) -> ()
```

### transform.iree.vector.vector_to_mma_conversion
Convert vector.contract to MMA operations.
```mlir
transform.iree.vector.vector_to_mma_conversion %func {use_mma_sync}
  : (!transform.any_op) -> ()
```
Options: `use_wmma` or `use_mma_sync`.

### transform.iree.convert_to_multi_mma
Convert linalg ops to iree_gpu.multi_mma with a specific intrinsic.
```mlir
transform.iree.convert_to_multi_mma %op, #iree_gpu.mma_layout<MFMA_F32_16x16x16_F16>
  : (!transform.any_op) -> !transform.any_op
```

### transform.iree.distribute_multi_mma
Distribute multi_mma ops across GPU lanes.
```mlir
transform.iree.distribute_multi_mma %op : (!transform.any_op) -> !transform.any_op
```

### transform.iree.create_matmul_mfma_tile_sizes
Generate tile sizes optimized for MFMA based on matmul dimensions.
```mlir
%sizes = transform.iree.create_matmul_mfma_tile_sizes %op
  : (!transform.any_op) -> !transform.any_param
```

---

## Matching (IREE-specific)

### transform.iree.match.cast_compatible_dag_from_root
Match an operation DAG with cast-compatible type checking. The body defines
the expected DAG structure with dynamic-shaped tensors.
```mlir
%ins, %outs = transform.iree.match.cast_compatible_dag_from_root %root {
  ^bb0(%lhs: tensor<?x?xf16>, %rhs: tensor<?x?xf16>, %out: tensor<?x?xf32>):
  %r = linalg.generic {
    indexing_maps = [...], iterator_types = [...]
  } ins(%lhs, %rhs : ...) outs(%out : ...) {
    // body
  } -> tensor<?x?xf32>
} : (!transform.any_op) -> (!transform.any_value, !transform.any_value)
```

### transform.iree.match.cast_compatible_type
Check if a value's type is cast-compatible with a target type.
```mlir
transform.iree.match.cast_compatible_type %val = tensor<2048x5120xf16>
  : !transform.any_value
```
Relaxed matching: dynamic dims match any static dim.

### transform.iree.match.dim_is_multiple_of
Check if a tensor dimension is a multiple of a given size.
```mlir
transform.iree.match.dim_is_multiple_of %val, 16 {dim = 0}
  : !transform.any_value
```

### transform.iree.match.regions
Structural comparison of operation regions.
```mlir
transform.iree.match.regions %op : !transform.any_op
```

---

## Flow and Dispatch

### transform.iree.forall_to_flow
Convert scf.forall to flow.dispatch.workgroups.
```mlir
transform.iree.forall_to_flow %op : (!transform.any_op) -> ()
```

### transform.iree.region_to_workgroups
Convert flow.dispatch.region to flow.dispatch.workgroups.
```mlir
transform.iree.region_to_workgroups %op : (!transform.any_op) -> ()
```

---

## Codegen Attributes

These are not transform ops but attribute types used with `transform.param.constant`
and `transform.annotate`.

### #iree_codegen.translation_info
Specifies which codegen pipeline to use.
```mlir
%info = transform.param.constant #iree_codegen.translation_info<
  pipeline = TransformDialectCodegen
  codegen_spec = @my_strategy
  workgroup_size = [256, 1, 1]
  subgroup_size = 64,
  {gpu_pipeline_options = #iree_gpu.pipeline_options<
    prefetch_shared_memory = true>}
> -> !transform.any_param
```

Key pipelines:
- `TransformDialectCodegen` - Use a named transform sequence as the codegen spec
- `LLVMGPUTileAndFuse` - Tile and fuse distributed to threads
- `LLVMGPUVectorDistribute` - Vector distribution to subgroups
- `LLVMGPUMatmulTensorCore` - Matmul targeting tensor cores
- `LLVMGPUMatmulTensorCoreMmaSync` - Matmul using mma.sync
- `SPIRVBaseVectorize` - SPIR-V vectorization
- `CPUDoubleTilingExpert` - CPU two-level tiling

### #iree_codegen.lowering_config
Specifies tiling parameters at multiple levels.
```mlir
%config = transform.param.constant #iree_codegen.lowering_config<
  tile_sizes = [[64, 64, 0], [8, 8, 0], [0, 0, 16]]
> -> !transform.any_param
```

### #iree_gpu.lowering_config
GPU-specific lowering config with named levels.
```mlir
%config = transform.param.constant #iree_gpu.lowering_config<{
  workgroup = [64, 128, 0],
  reduction = [0, 0, 64],
  thread = [8, 4],
  promote_operands = [0, 1],
  mma_kind = #iree_gpu.mma_layout<MFMA_F32_16x16x16_F16>,
  subgroup_m_count = 2,
  subgroup_n_count = 2
}> -> !transform.any_param
```

### #iree_codegen.compilation_info
Combines lowering_config and translation_info.
```mlir
%info = transform.param.constant #iree_codegen.compilation_info<
  lowering_config = #iree_gpu.lowering_config<{...}>,
  translation_info = #iree_codegen.translation_info<
    pipeline = LLVMGPUVectorDistribute
    workgroup_size = [256, 1, 1]
    subgroup_size = 64,
    {gpu_pipeline_options = #iree_gpu.pipeline_options<
      prefetch_shared_memory = true>}>
> -> !transform.any_param
```

### MMA layout types
```
#iree_gpu.mma_layout<MFMA_F32_16x16x16_F16>   -- AMD CDNA (gfx9xx)
#iree_gpu.mma_layout<MFMA_F32_32x32x8_F16>    -- AMD CDNA larger tile
#iree_gpu.mma_layout<WMMA_F32_16x16x16_F16>   -- NVIDIA WMMA
```

### Misc ops

### transform.iree.apply_licm
Loop-independent code motion and single-iteration loop promotion.
```mlir
transform.iree.apply_licm %func : (!transform.any_op) -> ()
```

### transform.iree.synchronize_loop
Insert gpu.barrier after scf.for loops.
```mlir
transform.iree.synchronize_loop %loop : (!transform.any_op) -> ()
```

### transform.iree.eliminate_gpu_barriers
Remove unnecessary GPU barriers based on memory effects analysis.
```mlir
transform.iree.eliminate_gpu_barriers %func : (!transform.any_op) -> ()
```

### transform.iree.reorder_transpose
Move transpose before elementwise ops for better locality.
```mlir
transform.iree.reorder_transpose %func : (!transform.any_op) -> ()
```

### transform.iree.share_forall_operands
Share operand values across forall threads instead of privatizing.
```mlir
transform.iree.share_forall_operands %forall [0, 1]
  : (!transform.any_op) -> !transform.any_op
```

### transform.iree.fuse_consumer
Fuse a consumer into the producer's containing loop.
```mlir
%fused = transform.iree.fuse_consumer %producer
  : (!transform.any_op) -> !transform.any_op
```

### transform.iree.copy_tensor_operand
Insert explicit copies of specified operands.
```mlir
transform.iree.copy_tensor_operand %op [0]
  : (!transform.any_op) -> !transform.any_op
```
