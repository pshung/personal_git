// IREE tuning spec: f16*f16->f32 matmul_transpose_b
// LHS: 4096x4096xf16, RHS: 1024x4096xf16 (transposed)
// MMA: MFMA_F32_16x16x16_F16
// Workgroup: [64, 128, 0], Reduction: [0, 0, 64], Threads: 256, Subgroup: 64

module attributes { transform.with_named_sequence } {

  transform.named_sequence @match_mmt_f16_4096x4096x1024(
      %arg0: !transform.any_op {transform.readonly}) -> (!transform.any_op) {
    transform.match.operation_name %arg0 ["linalg.generic"] : !transform.any_op
    %matched = transform.match.structured %arg0 : (!transform.any_op) -> (!transform.any_op) {
    ^bb0(%struct: !transform.any_op):
      // Match contraction: 2 inputs, 1 output
      %n_inputs = transform.match.structured.num_inputs %struct : (!transform.any_op) -> !transform.param<i64>
      %n_outputs = transform.match.structured.num_inits %struct : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %n_inputs, 2 : !transform.param<i64>
      transform.match.param.cmpi eq %n_outputs, 1 : !transform.param<i64>

      // Match rank-3 contraction (M, N, K)
      %rank = transform.match.structured.rank %struct : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %rank, 3 : !transform.param<i64>

      // Match element types: f16 inputs, f32 output
      %in0_type = transform.match.structured.elemental_bitwidth_of_input %struct[0]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %in0_type, 16 : !transform.param<i64>

      %in1_type = transform.match.structured.elemental_bitwidth_of_input %struct[1]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %in1_type, 16 : !transform.param<i64>

      %out_type = transform.match.structured.elemental_bitwidth_of_init %struct[0]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %out_type, 32 : !transform.param<i64>

      // Match contraction dims
      %contracting = transform.match.structured.dim %struct[2]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %contracting, 4096 : !transform.param<i64>

      %dim_m = transform.match.structured.dim %struct[0]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %dim_m, 4096 : !transform.param<i64>

      %dim_n = transform.match.structured.dim %struct[1]
          : (!transform.any_op) -> !transform.param<i64>
      transform.match.param.cmpi eq %dim_n, 1024 : !transform.param<i64>

      transform.match.structured.yield %struct : !transform.any_op
    }
    transform.yield %matched : !transform.any_op
  }

  transform.named_sequence @apply_mmt_config(
      %op: !transform.any_op {transform.readonly}) {
    %config = transform.param.constant #iree_codegen.compilation_info<
      lowering_config = #iree_codegen.lowering_config<
        tile_sizes = [[64, 128, 0], [0, 0, 64]]>,
      translation_info = #iree_codegen.translation_info<
        LLVMGPUVectorDistribute
        workgroup_size = [256, 1, 1]
        subgroup_size = 64,
        {mma_schedule = #iree_gpu.mma_schedule<
          intrinsic = #iree_gpu.mma_layout<MFMA_F32_16x16x16_F16>,
          subgroup_m_count = 2, subgroup_n_count = 2>
        }>
    > -> !transform.any_param
    transform.annotate %op "compilation_info" = %config : !transform.any_op, !transform.any_param
    transform.yield
  }

  transform.named_sequence @__kernel_config(
      %module: !transform.any_op {transform.consumed}) {
    %matched = transform.foreach_match in %module
        @match_mmt_f16_4096x4096x1024 -> @apply_mmt_config
        : (!transform.any_op) -> !transform.any_op
    transform.yield
  }

}
