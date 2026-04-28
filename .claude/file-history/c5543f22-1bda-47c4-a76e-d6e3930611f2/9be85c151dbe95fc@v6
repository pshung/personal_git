# Memory Index

- [AX45MPV vd4dots throughput](hw_ax45mpv_vd4dots_throughput.md) — vd4dots issues at 1/cyc; VW tail is latency, not throughput.
- [Pipeline-tuning predictions](feedback_pipeline_tuning_predictions.md) — V1024_8MB tuning page predicts inner-loop ceiling, not function ceiling; weight by inner-loop cycle share.
- [LMUL irrelevant for partial VL](feedback_lmul_partial_vl_throughput.md) — V1024_8MB VLSU 2*EMUL formula is worst-case-VL only; for vl<VLMAX_m1 m1==m4==m8 in cycles.
- [vle width unification breaks on int8 buffers](feedback_vle_alignment_unify_vsetvli.md) — vle8->vle32 to unify vsetvli for dual-issue fails: caller int8_t* not 4-byte aligned; QEMU hangs on misaligned vle32.
- [Clamp chains: batch vmax then vmin](feedback_clamp_chain_batching.md) — In requantize tails, batch all vmax then all vmin (not alternating) to hide VALU latency; measured +0.64% in unroll4 round 6.
- [llvm-mca for AX45MPV](reference_llvm_mca_ax45v.md) — Invocation flags for nx45v + Andes vdot/vqmac; what the model gets right vs wrong vs FPGA ground truth.
