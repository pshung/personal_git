// Transform library: matmul -> add -> relu fusion chain for GPU.
// Tiles relu by [32, 32], fuses add and matmul into the tiled loop,
// vectorizes, and bufferizes targeting GPU.

module attributes { transform.with_named_sequence } {

  transform.named_sequence @fusion_chain_gpu_strategy(
      %variant_op: !transform.any_op) {

    // Phase 1: Match all three ops in the chain
    %matmul = transform.structured.match ops{["linalg.matmul"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    %fills = transform.structured.match ops{["linalg.fill"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    %elemwise = transform.structured.match ops{["linalg.elemwise_binary"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op

    // Split elemwise handle into add and relu (in program order)
    %add, %relu = transform.split_handle %elemwise
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)

    // Phase 2: Tile the last op (relu) by [32, 32] to create the outer loop
    %tiled_relu, %forall = transform.structured.tile_using_forall %relu
      tile_sizes [32, 32]
      ( mapping = [#gpu.block<y>, #gpu.block<x>] )
      : (!transform.any_op) -> (!transform.any_op, !transform.any_op)
    transform.iree.populate_workgroup_count_region_using_num_threads_slice
      %forall : (!transform.any_op) -> ()

    // Phase 3: Fuse producers into the tiled loop (reverse dataflow order)
    // Fuse add into the loop (add feeds relu)
    %fused_add, %forall_1 =
      transform.structured.fuse_into_containing_op %add into %forall
      : (!transform.any_op, !transform.any_op)
      -> (!transform.any_op, !transform.any_op)

    // Fuse matmul into the loop (matmul feeds add)
    %fused_matmul, %forall_2 =
      transform.structured.fuse_into_containing_op %matmul into %forall_1
      : (!transform.any_op, !transform.any_op)
      -> (!transform.any_op, !transform.any_op)

    // Phase 4: Vectorize all linalg ops within the function
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

    // Phase 6: Bufferize (tensor -> memref) targeting GPU
    transform.iree.eliminate_empty_tensors %variant_op
      : (!transform.any_op) -> ()
    transform.apply_patterns to %func_v {
      transform.apply_patterns.linalg.erase_unnecessary_inputs
    } : !transform.any_op
    %buf = transform.iree.bufferize { target_gpu } %func_v
      : (!transform.any_op) -> (!transform.any_op)

    // Phase 7: Map forall loops to GPU workgroups and threads
    %func_final = transform.structured.match ops{["func.func"]} in %variant_op
      : (!transform.any_op) -> !transform.any_op
    transform.iree.forall_to_workgroup %func_final
      : (!transform.any_op) -> ()
    transform.iree.map_nested_forall_to_gpu_threads %func_final
      workgroup_dims = [32, 1, 1] : (!transform.any_op) -> ()

    transform.yield
  }

  // Matcher: find a linalg.matmul as the root of the fusion chain
  transform.named_sequence @match_matmul(
      %op: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %op ["linalg.matmul"] : !transform.any_op
    transform.yield %op : !transform.any_op
  }

  // Annotator: wire the fusion chain strategy via TransformDialectCodegen
  transform.named_sequence @set_fusion_strategy(
      %op: !transform.any_op {transform.readonly}) {
    %variant = transform.get_parent_op %op
      {op_name = "hal.executable.variant"}
      : (!transform.any_op) -> !transform.any_op
    %funcs = transform.structured.match ops{["func.func"]} in %variant
      : (!transform.any_op) -> !transform.any_op
    %info = transform.param.constant
      #iree_codegen.translation_info<
        pipeline = TransformDialectCodegen
        codegen_spec = @fusion_chain_gpu_strategy> -> !transform.any_param
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
      @match_matmul -> @set_fusion_strategy
      : (!transform.any_op) -> !transform.any_op
    transform.yield %res : !transform.any_op
  }
}
