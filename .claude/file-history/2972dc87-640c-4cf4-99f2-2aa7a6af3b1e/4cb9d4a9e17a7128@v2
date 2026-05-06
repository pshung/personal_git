# C-level hello-world e2e fixture for the hybrid simulator

## Context

Today's hybrid round-trip e2e fixtures (`hybrid/test/rt_*.S`) are bare-metal RV64 assembly. They cannot call `printf`, `malloc`, or any newlib API; their linker script (`handoff_roundtrip.ld`) discards `.data`, `.bss`, `.rodata`. This blocks writing realistic e2e tests that exercise the full QEMU1 -> vsim -> QEMU2 hand-off through C-level code.

The vsim-demo project (`/local/nick/vsim-workspace/vsim-demo`) already has a working C runtime targeting the AndesCycle simulator: `crt0.S`, `trap.S`, `handler.c`, `libgloss.c`. vsim's `src/platform/sim_control.hpp` peripheral at `0xE0080000` matches the demo's HTIF/exit MMIO contract, so the runtime drops into vsim verbatim.

The runtime is **not** drop-in for QEMU `-M virt` because libgloss's `_exit` and `_write` write to `0xE0080000`/`0xE0080004` and QEMU virt has no peripheral there. In our round-trip flow, QEMU1 never reaches `_exit` (the plugin kills it at `csrwi 0x7C0,0`) and `_write` is never reached either if all `printf`s sit between the two drain markers (only vsim runs that span). The only QEMU-side reachable libgloss path is QEMU2's terminal `_exit`, which we redirect to RISC-V semihosting (QEMU2 is spawned with `-semihosting-config enable=on,target=native`, per `src/hybrid/qemu_handback.hpp:131`).

Goal: stand up `rt_c_hello.elf` -- a C-level fixture that runs through the full round-trip and emits "hello from vsim" during the vsim phase.

## Files to add

### `hybrid/test/runtime/` (already populated verbatim from vsim-demo)

Verbatim copies (keep as-is):
- `crt0.S` -- entry, cache/FP/V/UNA bring-up, bss clear, calls `init_mtvec` then `main` then `_exit`. `_stack` is weak.
- `trap.S` -- `m_trap_entry`, GPR save/restore, calls `handle_trap`.
- `handler.c` -- `handle_trap`, `init_mtvec` (writes `mtvec=&m_trap_entry`), syscall dispatch table.
- `htif.h`, `syscall.h`, `core_v5.h`, `platform.h`, `memory_map.h` -- headers only.

One file modified:
- `libgloss.c` -- replace `_exit` with a semihosting `SYS_EXIT_EXTENDED` (reason `0x20026`, ebreak triple `slli x0,x0,0x1f; ebreak; srai x0,x0,0x7`). Pattern is identical to `hybrid/test/semihost_exit.inc:12-26`, just expressed as inline asm in C with the parameter block in `.bss` instead of at fixed `0x80001000`. Keep `_write` writing to `DISPLAY_BASE_ADDR=0xE0080004` so vsim's `sim_control` (`src/platform/sim_control.hpp:138`, accepts 1-byte writes -> `std::putchar`) prints it. QEMU2 never executes `_write` because `printf` is gated to the vsim-only span between the two markers.

### `hybrid/test/runtime/rt_c.ld` (new)

Linker script that, unlike `handoff_roundtrip.ld`, preserves `.rodata`/`.data`/`.bss` and exposes `_edata`/`_end` (consumed by `crt0.S`'s bss clear) and `_stack`:

```
ENTRY(_start)
SECTIONS {
    . = 0x80000000;
    .text : { *(.text*) }
    .rodata : { *(.rodata*) *(.srodata*) }
    .data : { *(.data*) *(.sdata*) }
    _edata = .;
    .bss : { *(.bss*) *(.sbss*) *(COMMON) }
    _end = .;
    PROVIDE(_stack = 0x80700000);  /* within QEMU virt's default 128 MiB and within vsim RAM (0x0..0x8FFFFFFF) */
}
```

### `hybrid/test/rt_c_hello.c` (new)

```c
#include <stdio.h>

int main(void) {
    asm volatile("csrwi 0x7C0, 0");           /* QEMU1 drains here */
    printf("hello from vsim\n");              /* only vsim runs this span */
    asm volatile("csrwi 0x7C0, 1");           /* vsim drains, exits 200 */
    return 0;                                 /* QEMU2 -> _exit -> semihosting */
}
```

## Files to modify

### `hybrid/test/Makefile`

Add a `rt_c_hello.elf` target. Build with newlib (don't pass `-nostdlib`); pass `-nostartfiles` and link runtime sources:

```make
RUNTIME_DIR := runtime
RUNTIME_SRCS := $(RUNTIME_DIR)/crt0.S $(RUNTIME_DIR)/trap.S \
                $(RUNTIME_DIR)/libgloss.c $(RUNTIME_DIR)/handler.c
RT_C_CFLAGS := -march=rv64gc -mabi=lp64d -O1 -static -nostartfiles \
               -I$(RUNTIME_DIR) -Wall

rt_c_hello.elf: rt_c_hello.c $(RUNTIME_SRCS) $(RUNTIME_DIR)/rt_c.ld
	$(CC) $(RT_C_CFLAGS) -T $(RUNTIME_DIR)/rt_c.ld \
	      rt_c_hello.c $(RUNTIME_SRCS) -o $@
```

Also extend `all:` and `clean:` to include `rt_c_hello.elf`.

### `cmake/HybridConfig.cmake`

Append one line to `VSIM_RT_FIXTURES` (around line 95):

```cmake
"rt_c_hello:0"
```

This auto-registers `test_e2e_rt_c_hello` via the existing foreach, reusing `roundtrip_e2e.sh` unchanged.

## Why this is safe across both halves

- **QEMU1 phase** -- runs `_start` (crt0 cache/FP/V setup), `init_mtvec`, into `main`, hits `csrwi 0x7C0, 0`. Andes-patched QEMU at `/local/nick/qemu_v5` recognizes CSR `0x7C0` (existing fixtures rely on this). The plugin's `on_handoff()` drains all GPR/FPR/CSR/PMP/V state and `exit(0)`s. `_exit`/`_write` are never reached.
- **vsim phase** -- gdbstub-restores state, executes `printf` (newlib -> `_write` -> 1-byte writes to `0xE0080004` -> `sim_control` prints to vsim's stdout), hits `csrwi 0x7C0, 1`. `HandoffController` drains, vsim exits 200 (matches existing flow). `_exit` not reached.
- **QEMU2 phase** -- spawned by vsim with `-semihosting-config enable=on,target=native`, gdbstub-restored, falls through `return 0`, crt0 calls `_exit(0)`, our patched `_exit` issues the semihosting exit triple, QEMU2 terminates with status `0`. vsim propagates that as its own exit code.

`_stack=0x80700000` sits in both QEMU virt RAM (default 128 MiB at `0x80000000`) and vsim RAM (`RAM_BASE..RAM_END` = `0x0..0x8FFFFFFF`).

## Verification

End-to-end:

```bash
# Build the fixture
make -C /local/nick/vsim/hybrid/test rt_c_hello.elf
# Confirm vsim and QEMU plugin are built
ls /local/nick/vsim/build/sim_ax45mpv_premium \
   /local/nick/vsim/hybrid/qemu_plugin/libhybrid_handoff.so
# Run the round-trip via the existing harness
cd /local/nick/vsim/build && \
  FIXTURE=rt_c_hello EXPECT_RC=0 bash ../tests/hybrid/roundtrip_e2e.sh
```

Expected output: `[rt_c_hello 1/3] QEMU 1: drain entry state -> ...`, `[rt_c_hello 2/3] vsim: resume + drain + spawn QEMU 2` (vsim-side log will contain `hello from vsim`), `[rt_c_hello 3/3] PASS: round-trip exit code 0`.

After CMake reconfigure, `ctest -R test_e2e_rt_c_hello` runs the same path under CTest with the same `SKIP_RETURN_CODE 77` semantics.

Spot checks if anything fails:
- `riscv64-unknown-elf-objdump -h hybrid/test/rt_c_hello.elf` -- confirm `.text`, `.rodata`, `.data`, `.bss` present, all loaded near `0x80000000`.
- `riscv64-unknown-elf-nm hybrid/test/rt_c_hello.elf | grep -E '_start|_stack|_end|_edata|main'` -- symbols defined.
- Run vsim alone first with `--shared-mem-base` etc, confirm `printf` byte stream lands in stdout.

## Critical files

- `/local/nick/vsim/hybrid/test/runtime/libgloss.c` (modify `_exit`)
- `/local/nick/vsim/hybrid/test/runtime/rt_c.ld` (new)
- `/local/nick/vsim/hybrid/test/rt_c_hello.c` (new)
- `/local/nick/vsim/hybrid/test/Makefile` (add target)
- `/local/nick/vsim/cmake/HybridConfig.cmake` (register fixture)

Reused unchanged:
- `/local/nick/vsim/hybrid/test/runtime/{crt0.S,trap.S,handler.c,htif.h,syscall.h,core_v5.h,platform.h,memory_map.h}`
- `/local/nick/vsim/tests/hybrid/roundtrip_e2e.sh` (parameterized by FIXTURE/EXPECT_RC)
- `/local/nick/vsim/src/platform/sim_control.hpp` (the MMIO peer for libgloss)
- `/local/nick/vsim/src/hybrid/qemu_handback.hpp` (already passes `-semihosting-config enable=on,target=native`)
