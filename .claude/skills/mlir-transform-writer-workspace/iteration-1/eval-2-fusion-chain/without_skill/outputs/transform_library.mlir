// Transform library: matmul -> add -> relu fusion chain
// Tiles relu by [32,32], fuses add and matmul into the tiled loop,
// then vectorizes and bufferizes for GPU.

module attributes {transform.with_named_sequence} {

transform.named_sequence @__kernel_config(%variant_op: !transform.any_op {transform.consumed}) {
  // ---------------------------------------------------------------
  // 1. Match the three ops in the chain: matmul, add, relu
  // ---------------------------------------------------------------
  %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
  %add = transform.structured.match ops{["linalg.generic"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
  %relu = transform.structured.match ops{["linalg.generic"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

  // ---------------------------------------------------------------
  // 2. Tile the relu (consumer) by [32, 32]
  // ---------------------------------------------------------------
  %tiled_relu, %forall =
      transform.structured.tile_using_forall %relu
          tile_sizes [32, 32]
          ( mapping = [#gpu.block<y>, #gpu.block<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

  // ---------------------------------------------------------------
  // 3. Fuse add into the tiled loop
  // ---------------------------------------------------------------
  %fused_add, %new_forall_0 =
      transform.structured.fuse_into_containing_op %add into %forall
      : (!transform.any_op, !transform.any_op)
          -> (!transform.any_op, !transform.any_op)

  // ---------------------------------------------------------------
  // 4. Fuse matmul into the tiled loop
  // ---------------------------------------------------------------
  %fused_matmul, %new_forall_1 =
      transform.structured.fuse_into_containing_op %matmul into %new_forall_0
      : (!transform.any_op, !transform.any_op)
          -> (!transform.any_op, !transform.any_op)

  // ---------------------------------------------------------------
  // 5. Tile the fused matmul reduction dim for register reuse
  // ---------------------------------------------------------------
  %tiled_matmul, %loop =
      transform.structured.tile_using_for %fused_matmul [0, 0, 32]
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

  // ---------------------------------------------------------------
  // 6. Vectorize all ops inside the fusion region
  // ---------------------------------------------------------------
  %func = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

  transform.structured.vectorize %tiled_matmul
      : !transform.any_op
  transform.structured.vectorize %fused_add
      : !transform.any_op
  transform.structured.vectorize %tiled_relu
      : !transform.any_op

  // ---------------------------------------------------------------
  // 7. Canonicalize / CSE cleanup after vectorization
  // ---------------------------------------------------------------
  %func_v = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
  transform.apply_patterns to %func_v {
    transform.apply_patterns.canonicalization
  } : !transform.any_op
  transform.apply_cse to %func_v : !transform.any_op

  // ---------------------------------------------------------------
  // 8. Bufferize (one-shot) for GPU memory semantics
  // ---------------------------------------------------------------
  %bufferized = transform.bufferization.one_shot_bufferize
      layout{IdentityLayoutMap}
      %variant_op {
        bufferize_function_boundaries = true,
        allow_return_allocs_from_loops = true
      } : (!transform.any_op) -> !transform.any_op

  // ---------------------------------------------------------------
  // 9. Map the forall to GPU thread/block grid
  // ---------------------------------------------------------------
  %mapped_func = transform.structured.match ops{["func.func"]} in %bufferized
      : (!transform.any_op) -> !transform.any_op
  transform.iree.map_nested_forall_to_gpu_threads %mapped_func
      workgroup_dims = [32, 32, 1]
      : (!transform.any_op) -> !transform.any_op

  // ---------------------------------------------------------------
  // 10. Final cleanup
  // ---------------------------------------------------------------
  %final_func = transform.structured.match ops{["func.func"]} in %bufferized
      : (!transform.any_op) -> !transform.any_op
  transform.apply_patterns to %final_func {
    transform.apply_patterns.canonicalization
  } : !transform.any_op
  transform.apply_cse to %final_func : !transform.any_op

  transform.yield
}

} // module
