// Transform dialect script for 512x512 f32 matmul on GPU.
// Tiles to 64x64 workgroups, reduction tile 16, vectorized,
// mapped to 16x4 thread grid (64 threads per workgroup).

module attributes { transform.with_named_sequence } {

transform.named_sequence @__kernel_config(%variant_op: !transform.any_op {transform.readonly}) {
  // Match the matmul operation.
  %matmul = transform.structured.match.operation_name %variant_op ["linalg.matmul"]
    : (!transform.any_op) -> !transform.any_op

  // Tile to workgroup-level: 64x64 on M and N dimensions.
  %tiled_op, %forall_op = transform.structured.tile_using_forall %matmul
    tile_sizes [64, 64]
    ( mapping = [#gpu.block<y>, #gpu.block<x>] )
    : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

  // Tile the reduction (K) dimension by 16.
  %tiled_reduction, %loop = transform.structured.tile_using_for %tiled_op [0, 0, 16]
    : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

  // Thread-level tiling: each thread computes a 4x16 tile.
  // 64/4 = 16 threads along M, 64/16 = 4 threads along N -> 16x4 grid.
  %tiled_thread, %forall_thread = transform.structured.tile_using_forall %tiled_reduction
    tile_sizes [4, 16]
    ( mapping = [#gpu.thread<y>, #gpu.thread<x>] )
    : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

  // Vectorize the inner matmul tile.
  transform.structured.vectorize %tiled_thread vector_sizes [4, 16, 16]
    : !transform.any_op

  // Bufferize the entire module.
  %func = transform.structured.match.operation_name %variant_op ["func.func"]
    : (!transform.any_op) -> !transform.any_op
  transform.iree.eliminate_empty_tensors %func : (!transform.any_op) -> ()
  %bufferized = transform.iree.bufferize %variant_op : (!transform.any_op) -> !transform.any_op

  // Post-bufferization: get the updated func, then map forall to GPU ids.
  %func_2 = transform.structured.match.operation_name %bufferized ["func.func"]
    : (!transform.any_op) -> !transform.any_op
  transform.iree.forall_to_workgroup %func_2 : (!transform.any_op) -> ()
  transform.iree.map_nested_forall_to_gpu_threads %func_2
    workgroup_dims = [4, 16, 1]
    : (!transform.any_op) -> ()

  // Vector lowering.
  transform.apply_patterns to %func_2 {
    transform.apply_patterns.vector.lower_contraction lowering_strategy = "outerproduct"
    transform.apply_patterns.vector.transfer_permutation_patterns
    transform.apply_patterns.vector.lower_multi_reduction lowering_strategy = "innerparallel"
    transform.apply_patterns.vector.lower_shape_cast
    transform.apply_patterns.vector.lower_transpose lowering_strategy = "eltwise"
  } : !transform.any_op

  transform.yield
}

} // module
