---
name: QEMU gdbstub vl/vtype write restriction
description: QEMU silently drops P-packet writes to vl/vtype; fix required write_vl/write_vtype + debugger bypass
type: project
originSessionId: 40a789da-b31a-4947-a3d1-a08f95bd3c64
---
QEMU's `csr_ops` for `CSR_VL` (0xC20) and `CSR_VTYPE` (0xC21) had no write function, so gdbstub P-packet writes were silently dropped. Additionally, `riscv_csrrw_check` blocked writes to CSRs with bits[11:10]=11 (the architecturally read-only range 0xC00-0xCFF) before even reaching the write function.

Fix applied in commit `f98ca9b624` of `hybrid_qemu` (branch `hybrid`):
1. Added `write_vl` and `write_vtype` in `target/riscv/csr.c` (after `read_vlenb`, before `read_vxrm`)
2. Updated `csr_ops[CSR_VL]` and `csr_ops[CSR_VTYPE]` entries to include the new write functions
3. Modified `riscv_csrrw_check` to skip the read-only gate when `env->debugger` is set

**Why:** vl and vtype must be restorable via gdbstub P-packets for the hybrid QEMU->vsim->QEMU2 handback. Without this, `rt_c_v_csrs` (and any future V-state round-trip test) fails with `FAIL vl` / `FAIL vtype`.

**How to apply:** Any future attempt to restore V CSRs via gdbstub in QEMU requires this QEMU fork change. The fix is in `hybrid_qemu`, not in `hybrid_vsim`.
