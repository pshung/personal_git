# Memory Index

- [ace-tq1 standalone kernel lab](ace-tq1-standalone-kernel-lab.md) - user's TQ1/TQ2 vsim+ACE extraction at /local/nick/vsim-workspace/vsim-demo/ace-tq1; rdcycle flow, trit-unpack + bsums tricks, COPILOT ACE toolchain
- [Andes toolchain RVV segment flag](andes-toolchain-rvv-segment-flag.md) - segment ld/st intrinsics need -mext-zvlsseg; check --target-help before patching source; working rv64 cmake configure included
- [andesim llama.cpp hybrid gaps](andesim-llamacpp-hybrid-gaps.md) - WORKING 2026-07: vlinux marker-mode ROI on Bonsai-4B, K=51 cycle baselines (premium 6528953 / fpga_l3 4476168), engine build matrix, 2GiB cap, premium needs 3 e64 patches
- [q1_0 wide-VLEN repack row-parallel](q1_0-wide-vlen-repack-rowparallel.md) - Q1_0 row-parallel Nx1 repack N=64, F4 COMPLETE through F4d: ggml wiring on branch q1_0-rvv-opt, K=51 in-model fpga_l3 4.48M->2.14M = 2.09x (lab best chains 22.7x/19.4x w/ HVM; gap = L3 weight streaming); premium K=51 blocked on ax45 hybrid halt in vsim_andesim (PLDM fetch unserved); next levers weights-in-HVM / RVV activation quantize / F6 ACE
- [qemu user vs system flavors](qemu-user-vs-system-flavors.md) - qemu-runner agent = bare-metal qemu-system only (Linux binary -> exit 1, no output); kernel-lab/llama Linux binaries run via run-rv64-qemu.sh directly in Bash
