---
name: libnn performance counter reference
description: ~/work/libnn uses nds_pfcounter.h with Andes M-mode CSR inhibit/reset/read pattern for cycle profiling
type: reference
---

libnn performance counter infrastructure is in:
- ~/work/libnn/Examples/unit_func/include/nds_pfcounter.h

Pattern: _startPFM() inhibits counters (mcountinhibit=0x7F), resets mcycle/minstret to 0, re-enables.
_stopPFM() inhibits, reads counters, checks overflow via Andes CSR_MCOUNTEROVF (0xFC9), re-enables.
Uses __nds__mtsr/__nds__mfsr intrinsics from nds32_intrinsic.h.

Andes-specific CSRs: MMSC_CFG (0xFC2), MCOUNTEROVF (0xFC9).
Cache HPM events: 0x61 (dcache load access), 0x71 (dcache load miss), 0xc1 (dcache stall), 0x91 (dcache store miss).
