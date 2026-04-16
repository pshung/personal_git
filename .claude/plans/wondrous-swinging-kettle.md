# Plan: Profile libm functions on FPGA — get cycle & instruction counts

## Context

We need to benchmark every libm function in picolibc on the Andes RISC-V FPGA board (`sw-boards.andestech.com:1116`) using the same performance counter approach as libnn (`nds_pfcounter.h`). The `bench-math.c` file already has the counter code (inhibit/reset/read pattern via M-mode CSRs). It is **not** integrated into Meson — it's a standalone file that must be compiled and loaded via GDB.

## Steps

### Step 1: Build picolibc (cross-compile for RISC-V)

Use the existing build script to produce the library:

```bash
./build_mculib3.sh riscv64-elf $PWD/build-riscv $PWD/install-riscv
```

This produces `libc.a`, `libm.a`, `libsemihost.a`, `picolibc.ld`, and crt0 in the install directory.

### Step 2: Compile bench-math.c against the built picolibc

Standalone compile linking against the installed picolibc. Use `--specs=picolibc.specs` to pick up the correct crt0, linker script, and libraries:

```bash
riscv64-elf-gcc -Os \
    --specs=install-riscv/picolibc/ndsv5-unknown-elf/lib/picolibc.specs \
    -o bench-math.elf \
    test/bench-math/bench-math.c \
    -lm -lc -lsemihost
```

(Exact specs path depends on the install layout — may need adjustment.)

### Step 3: Create a GDB script to load & run on the FPGA

Create `test/bench-math/run-bench.gdb`:

```gdb
# Connect to Andes FPGA board
target remote sw-boards.andestech.com:1116

# Load the ELF (flash to RAM)
load

# Set breakpoint at exit to capture output before board resets
break _exit

# Run
continue

# When _exit is hit, detach cleanly
detach
quit
```

### Step 4: Run the benchmark on the FPGA

```bash
riscv64-elf-gdb -batch -x test/bench-math/run-bench.gdb bench-math.elf
```

The CSV output (`function,total_cycles,total_instret,iterations`) flows via semihosting stdout to the GDB console.

### Step 5: Capture & post-process results

Redirect GDB output to a file, then strip GDB noise to get clean CSV:

```bash
riscv64-elf-gdb -batch -x test/bench-math/run-bench.gdb bench-math.elf \
    2>/dev/null | grep -E '^[a-z]' > results.csv
```

Or wrap everything in a shell script `test/bench-math/run-bench-fpga.sh`.

## Files to create / modify

| File | Action | Purpose |
|---|---|---|
| `test/bench-math/bench-math.c` | Already updated | Performance counter code (startPFM/stopPFM) |
| `test/bench-math/run-bench.gdb` | **Create** | GDB script to connect, load, run on FPGA |
| `test/bench-math/run-bench-fpga.sh` | **Create** | Shell wrapper: compile + GDB run + capture CSV |

## Expected output format

```
function,total_cycles,total_instret,iterations
acos,123456,98765,1000
acosh,234567,187654,1000
...
sinf,12345,9876,1000
...
```

Per-call averages: divide `total_cycles` and `total_instret` by `iterations` (1000).

## Verification

1. Build picolibc: `./build_mculib3.sh riscv64-elf ...`
2. Compile bench-math.elf
3. Connect GDB to `sw-boards.andestech.com:1116`, load, run
4. Confirm CSV output with cycle/instret counts for all 60 functions (30 double + 30 float)
