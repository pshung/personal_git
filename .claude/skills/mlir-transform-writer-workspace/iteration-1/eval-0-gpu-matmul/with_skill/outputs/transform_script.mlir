// Transform script for 512x512 f32 matmul targeting GPU.
// Workgroup tiles: 64x64, reduction tile: 16, thread grid: 16x4.

module attributes { transform.with_named_sequence } {

  transform.named_sequence @gpu_matmul_strategy(
      %variant_op: !transform.any_op) {

    // Phase 1: Find the matmul
    %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

    // Phase 2: Tile to workgroups (GPU blocks)
    // 512/64 = 8 blocks per dimension -> 8x8 grid
    %tiled, %forall_grid =
      transform.structured.tile_using_forall %matmul
        tile_sizes [64, 64]
        ( mapping = [#gpu.block<y>, #gpu.block<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
    transform.iree.populate_workgroup_count_region_using_num_threads_slice
      %forall_grid : (!transform.any_op) -> ()

    // Phase 3: Tile reduction dimension (K=16)
    // Each thread accumulates 16 elements along K before writing back
    %tiled_k, %loop_k = transform.structured.tile_using_for %tiled [0, 0, 16]
      : (!transform.any_op) -> (!transform.any_op, !transform.op<"scf.for">)

    // Phase 4: Vectorize
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
    // 16 threads in x * 4 threads in y = 64 threads per workgroup
    %func_final = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.iree.forall_to_workgroup %func_final
      : (!transform.any_op) -> ()
    transform.iree.map_nested_forall_to_gpu_threads %func_final
      workgroup_dims = [16, 4, 1] : (!transform.any_op) -> ()

    transform.yield
  }

  // Matcher: select matmul ops
  transform.named_sequence @match_matmul(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
    transform.yield %op : !transform.any_op
  }

  // Annotator: wire the strategy to matched ops
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

  // Entry point
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
