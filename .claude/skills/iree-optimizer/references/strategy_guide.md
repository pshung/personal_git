# CPU Codegen Strategy Guide (RISC-V with RVV)

## Hardware Model

### RISC-V Vector Extension (RVV)
- VLEN: configurable (128, 256, 512, 1024 bits)
- LMUL: register grouping factor (1, 2, 4, 8) - trades register count for wider ops
- Element width: 8, 16, 32, 64 bits
- Elements per vector register: VLEN / element_width
- With LMUL=m: elements per operation = m * VLEN / element_width

### Memory Hierarchy (typical AX45MPV)
- Vector register file: 32 * VLEN bits (with LMUL, effectively fewer regs but wider)
- L1 D-cache: 32-64 KB, ~1 cycle latency
- L2 cache: 512 KB - 8 MB, ~10 cycle latency
- DRAM: ~100+ cycle latency

### Compute-to-Load Ratio
- i8 * i8 -> i32: 4 bytes input -> 4 bytes output, compute-bound with vector dot
- f16 * f16 -> f32: 4 bytes input -> 4 bytes output
- f32 * f32 -> f32: 8 bytes input -> 4 bytes output, often memory-bound

## Tiling Strategy for Matmul (M x N x K)

### Principles
1. **Outer tiles (distribution)**: Size for cache blocking. Both LHS tile (M_outer * K)
   and RHS tile (K * N_outer) should fit in L1 together with output tile.
2. **Inner tiles (vector)**: Size to fill vector registers. N_inner should be a
   multiple of VLEN/element_size for full vector utilization.
3. **K tile (reduction)**: Controls accumulation granularity. Larger K_tile means
   more data reuse per output element but more register pressure for accumulators.

### Sizing Rules of Thumb
- For VLEN=512, i8 data: vector width = 64 elements
  - N_inner = 64 (or 32 with LMUL=1)
  - M_inner = 2-8 (multiple rows for register blocking)
  - K_tile = 16-64 (balance reuse vs register pressure)

- For VLEN=512, f32 data: vector width = 16 elements
  - N_inner = 16
  - M_inner = 2-4
  - K_tile = 8-32

### CPUDoubleTilingExpert Tile Levels
This pipeline expects 6 tiling levels:
```
Level 0: Distribution tiles (outer loop, cache blocking)
Level 1: Vector common tiles (often same as level 0 or finer)
Level 2: (reserved, usually zeros)
Level 3: Vector inner tiles (innermost, register-level)
Level 4: Reduction tiles (K-dimension tiling)
Level 5: (reserved, usually zeros)
```

## Codegen Strategy Templates

### Simple Matmul (TransformDialectCodegen)
```
1. Match func.func by name
2. Match linalg.matmul inside the func
3. Tile the matmul:
   - Outer: [M_outer, N_outer, 0] for cache blocking
   - Inner: [M_inner, N_inner, 0] for vectorization
4. Tile reduction: [0, 0, K_tile]
5. Vectorize the tiled operation
6. Bufferize
7. Lower vectors
```

### Matmul + Elementwise Fusion
```
1. Match all linalg ops
2. Split handles to distinguish matmul from elementwise
3. Tile the last consumer (elementwise) as the root
4. Fuse producers into the tiled loop (reverse dataflow order)
5. Vectorize the fused region
6. Bufferize
```

### Multi-op Dispatch (fill + matmul + generic)
```
1. Match each op type
2. Tile the primary compute op (matmul) as the root
3. Fuse fill (initializer) into the tiled matmul
4. Fuse any post-processing ops (generic) if present
5. Vectorize the fused region
6. Bufferize
```

## What to Try When Stuck

### Compile errors
- Handle invalidation: re-match ops after transformations that consume handles
- Type mismatch: ensure handle types match what transforms expect
- Op not found: the payload IR may not contain the expected op after a prior transform

### Performance plateau
- Try different M/N outer tile ratios (square vs rectangular)
- Try different K tile sizes (double or halve)
- Try loop interchange (K-innermost vs M-innermost)
- Check if vectorization is happening on the right dimension
- Consider padding to align dimensions to vector width

### Performance regression
- Tile sizes too small: overhead from loop control dominates
- Tile sizes too large: data doesn't fit in cache
- Wrong vectorization axis: memory access pattern becomes strided
