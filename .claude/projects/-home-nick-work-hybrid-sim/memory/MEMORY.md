# Memory Index

- [QEMU vl/vtype gdbstub write fix](project_qemu_vl_vtype.md) - QEMU silently drops P-packet writes to vl/vtype; fix: write_vl/write_vtype + debugger bypass in hybrid_qemu/target/riscv/csr.c
- [run_e2e.sh JOBS cap](feedback_e2e_jobs.md) - Use JOBS=8 on this 128-core host; default of 128 causes timeouts from vsim CPU saturation
