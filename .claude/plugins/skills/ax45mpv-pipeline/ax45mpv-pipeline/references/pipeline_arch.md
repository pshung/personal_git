# AX45MPV Pipeline Architecture Reference

## CPU Parameters

| Parameter | Value |
|-----------|-------|
| ISA | RV64GCV |
| VLEN | 512 (configurable to 1024 in RTL) |
| ELEN | 32 |
| DLEN | 512 |
| VLSU data width | 256 bits |
| VLSU MSHR depth | 16 |
| VLSU buffer depth | 8 |
| VSCB depth | 16 |
| VRF MUX | 2 |
| Scalar issue width | 2-way (i0, i1) |
| Branch prediction | Dynamic (256-entry BTB) |
| I-cache / D-cache | 64 KB / 8 KB |
| ILM / DLM | 64 KB / 32 KB |

## Scalar Pipeline (5 stages, dual-issue)

```
IS -> EX -> MM -> LX -> WB
```

| Stage | Description |
|-------|-------------|
| IS | Instruction decoded and issued (2 slots: i0, i1) |
| EX | ALU / address calculation / VPU handoff |
| MM | Data cache access |
| LX | Late execute / result forwarding |
| WB | Write-back, retirement |

## VPU Pipeline (parallel to scalar)

```
VQ -> VD -> VC -> VW1 [-> VW2 -> ... -> VWn]
```

| Stage | Description |
|-------|-------------|
| VQ | Vector Instruction Queue — RVV instruction enters queue |
| VD | Vector Dispatch — dispatched to functional unit, LMUL/SEW decoded |
| VC | Vector Commit — functional unit completes |
| VW1..VWn | VRF Write-back (1 per EMUL group) |

VW count by LMUL: m1=1, m2=2, m4=4, m8=8. Stores have no VW stages.

## VPU Functional Units

| Unit | Operations |
|------|-----------|
| VALU | vadd, vsub, vand, vor, vxor, vsll, vsrl, vsra, vmin, vmax, vmseq, etc. |
| VMAC / VMAC2 | vmul, vmulh, vmacc, vnmsac, vwmul, vwmacc |
| VLSU | vle, vse, vlse, vsse, vluxei, vsuxei (all vector loads/stores) |
| VSP | vmv.x.s, vfmv.f.s (scalar extraction) |
| VPERMUT | vrgather, vslide, vcompress |
| VDIV | vdiv, vdivu, vrem, vremu |
| VFMIS | vfcvt, vfclass, misc FP |
| VFDIV | vfdiv, vfsqrt |
| VMASK | vcpop.m, vfirst.m |
| VACE | Andes Custom Extension ops |

## Common Stall Causes

| Stall Pattern | Cause | Optimization |
|---------------|-------|-------------|
| IS stall (scalar) | VPU queue full (VSCB=16) | Reduce back-to-back RVV instructions |
| VQ stall | FU busy or data dependency | Interleave different FU types |
| Long VC (VLSU) | Cache miss on vector load | Align data, prefetch, use unit-stride |
| Many VW stages | Large LMUL | Use smaller LMUL if VLEN allows |
| EX->MM gap | Data hazard on scalar | Reorder independent instructions |
| Branch flush burst | Misprediction | Restructure branches, use conditional moves |

## Typical Latencies (VLEN=512, e32)

| Instruction Type | VD->VC | VW stages | Notes |
|-----------------|--------|-----------|-------|
| VALU (vadd, etc.) | 3-5 cycles | LMUL | Fast integer arithmetic |
| VMAC (vmul, vmacc) | 4-6 cycles | LMUL | Multiply-accumulate |
| VLSU load (vle) | 3-5 cycles (cache hit) | LMUL | Cache miss adds ~20+ cycles |
| VLSU store (vse) | 3-5 cycles | 0 | No VRF write-back |
| VPERMUT (vrgather) | varies | LMUL | Depends on index pattern |
| VDIV | 20+ cycles | LMUL | Very slow, avoid in hot loops |
| VFDIV (vfdiv, vfsqrt) | 15+ cycles | LMUL | Slow, use vfrec7 approximation |

## Kanata Log Format

| Code | Fields | Meaning |
|------|--------|---------|
| I | id, id, 0 | New instruction enters pipeline |
| L | id, lane, text | Label: lane 0 = PC + asm, lane 1 = VPU info |
| S | id, lane, stage | Instruction enters a stage |
| E | id, lane, stage | Instruction exits a stage |
| R | id, retire_seq, status | Retired: 0=committed, 1=flushed |
| C | n | Advance n cycles |

Lane 0 = scalar pipeline, Lane 1 = VPU pipeline.
