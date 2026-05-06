# C-level e2e test suite for the hybrid simulator

## Context

`hybrid/test/rt_*.S` are bare RV64 assembly. Their linker script (`handoff_roundtrip.ld:9`) discards `.data`/`.bss`/`.rodata` and the test bodies hand-roll the semihosting exit. This blocks any test that exercises C runtime paths -- `printf` formatting, newlib's stdio, HTIF file I/O.

vsim-demo (`/local/nick/vsim-workspace/vsim-demo`) ships a working C runtime targeting the AndesCycle simulator: `crt0.S`, `trap.S`, `handler.c`, `libgloss.c`. vsim's `src/platform/sim_control.hpp` peripheral at `0xE0080000` matches the demo's HTIF/exit MMIO contract, so the runtime drops in verbatim. `libgloss.c` exits via writing to `0xE0080000`; vsim's `handle_sim_command` (`src/platform/sim_control.hpp:160-203`) decodes it. `libgloss.c` does file I/O via writing the syscall packet address to `0xE0080010`; vsim's `dispatch` (`sim_control.hpp:249-277`) routes through `sim_syscall_table[]` to host syscalls.

Goal: stand up three C-level fixtures runnable through the full QEMU1 -> vsim -> QEMU2 round-trip:
- `rt_c_hello`  -- printf smoke (newlib stdio -> `_write` -> putchar)
- `rt_c_printf` -- format-specifier coverage (`%d %s %lx %c %p`)
- `rt_c_file_io` -- HTIF file I/O round-trip (`fopen/fwrite/fseek/fread/fclose/unlink`) with self-validation

## Architecture: timing-aware C fixture

Round-trip phase / what's allowed:

| Phase        | Reachable libgloss paths        | Why |
|--------------|---------------------------------|-----|
| QEMU1        | none -- `csrwi 0x7C0, 0` first  | QEMU virt has no `0xE0080000`; plugin kills QEMU at the marker before any I/O |
| vsim         | `_write` (any fd), `_open`, `_read`, `_close`, `_lseek`, `_fstat`, `_unlink`, `_sbrk`, `_gettimeofday` | vsim's `sim_control` handles them as MMIO putchar (fd<=2) or HTIF syscall (fd>2 / file ops) |
| QEMU2        | `_exit` only (via semihosting)  | QEMU virt has no `0xE0080000`; semihosting is the only termination path |

Critical state-transfer fact (verified against `src/hybrid/qemu_handback.hpp` and `src/hybrid/state_drain.hpp`): in **Tier-1** (no `--shared-mem-path`) only architectural registers cross the vsim->QEMU2 boundary -- GPRs, FPRs, M-mode CSRs, PMP, V regs. **RAM does not.** QEMU2 is spawned with `-kernel <ELF>` so `.text`/`.rodata`/`.data` reload from disk and `.bss`/stack are virgin. Any value computed in vsim that must reach QEMU2's `_exit` has to live in a callee-saved register or `a0` at the moment of `csrwi 0x7C0, 1`.

All three fixtures avoid the issue by structuring main() so:
- The success path returns a compile-time-constant 0; compiler emits `li a0, 0; ret` after the marker, which works regardless of memory state.
- The failure path bypasses the round-trip entirely by writing `SimCommand::FAILED` (`0x01234569`) directly to `0xE0080000`, causing vsim to terminate with exit code 1 before any handoff. The harness's `EXPECT_RC=0` mismatch flags the failure.

## Files to add

### `hybrid/test/runtime/` (verbatim from vsim-demo, except libgloss.c)

Already-copied verbatim:
- `crt0.S` -- entry, cache/FP/V/UNA bring-up, `.bss` clear, calls `init_mtvec` then `main` then `_exit`. `_stack` is weak.
- `trap.S` -- `m_trap_entry`, GPR save/restore, calls `handle_trap`.
- `handler.c` -- `handle_trap`, `init_mtvec` (writes `mtvec=&m_trap_entry`), syscall dispatch.
- `htif.h`, `syscall.h`, `core_v5.h`, `platform.h`, `memory_map.h`.

Patch `libgloss.c` `_exit` to a **dual-path exit** -- vsim wins first on its platform, semihosting wins on QEMU virt:

```c
__attribute__((used, noreturn)) void _exit(int exit_status) {
  /* vsim path: sim_control treats command < 256 as raw exit code.
     On QEMU virt this write is silently dropped (unassigned MMIO). */
  *(volatile uint32_t*)EXIT_COMMAND_ADDR = (uint32_t)(exit_status & 0xFF);

  /* QEMU virt path (also QEMU2 in our flow): RISC-V semihosting
     SYS_EXIT_EXTENDED. Same ebreak triple as hybrid/test/semihost_exit.inc:21-23. */
  static volatile uint64_t block[2];
  block[0] = 0x20026;                                /* ADP_Stopped_ApplicationExit */
  block[1] = (uint64_t)(uint32_t)exit_status;
  register long a0 asm("a0") = 0x20;                 /* SYS_EXIT_EXTENDED */
  register long a1 asm("a1") = (long)(uintptr_t)block;
  asm volatile(".option push\n.option norvc\n"
               "slli x0, x0, 0x1f\nebreak\nsrai x0, x0, 0x7\n"
               ".option pop\n"
               : : "r"(a0), "r"(a1) : "memory");
  for (;;) { }
}
```

The dual path also rescues the case where `handler.c`'s `exception_handler` calls `_exit(mcause)` after a trap during the vsim phase -- without it, semihosting alone would hang vsim.

### `hybrid/test/runtime/rt_c.ld` (new)

Real linker script that preserves `.data`/`.bss`/`.rodata` and exposes the symbols `crt0.S` consumes:

```ld
ENTRY(_start)
SECTIONS {
    . = 0x80000000;
    .text   : { *(.text*) }
    .rodata : { *(.rodata*) *(.srodata*) }
    .data   : { *(.data*)   *(.sdata*) }
    _edata = .;
    .bss    : { *(.bss*)    *(.sbss*) *(COMMON) }
    _end = .;
    PROVIDE(_stack = 0x80700000);   /* in QEMU virt's default 128 MiB and in vsim RAM (0x0..0x8FFFFFFF) */
}
```

### `hybrid/test/runtime/rt_c_helpers.h` (new, shared by all C fixtures)

```c
#pragma once
#include <stdint.h>
#include <stdio.h>

#define SIM_CONTROL_REG (*(volatile uint32_t *)0xE0080000)
#define SIM_FAILED      0x01234569u   /* matches sim_control.hpp:32 */

static inline void rt_phase_qemu1_drain(void) { asm volatile("csrwi 0x7C0, 0"); }
static inline void rt_phase_vsim_drain (void) { asm volatile("csrwi 0x7C0, 1"); }

/* Vsim-only failure: writes SimCommand::FAILED to sim_control,
   vsim exits with code 1, harness sees RC=1 vs EXPECT_RC=0. */
static inline __attribute__((noreturn)) void rt_fail(void) {
  fflush(stdout);
  SIM_CONTROL_REG = SIM_FAILED;
  for (;;) { }
}
```

### `hybrid/test/rt_c_hello.c` (new)

Smoke: round-trip, printf in vsim phase, exit 0.

```c
#include "runtime/rt_c_helpers.h"

int main(void) {
    rt_phase_qemu1_drain();
    setvbuf(stdout, NULL, _IONBF, 0);          /* unbuffered: every byte hits 0xE0080004 immediately */
    printf("hello from vsim\n");
    rt_phase_vsim_drain();
    return 0;                                  /* QEMU2 -> _exit(0) -> semihosting */
}
```

### `hybrid/test/rt_c_printf.c` (new)

Format-specifier coverage. Exercises newlib's `vfprintf` paths (integer / hex / string / char / pointer / width). On any failure inside newlib the trap handler dumps regs and `_exit`s -- harness catches RC != 0.

```c
#include "runtime/rt_c_helpers.h"
#include <stdint.h>

int main(void) {
    rt_phase_qemu1_drain();
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("dec=%d hex=%lx str=%s chr=%c ptr=%p pad=[%5d]\n",
           -42, 0xDEADBEEFCAFEUL, "vsim", 'Z', (void *)0x80000000UL, 7);
    printf("widths: %08x %-10s|\n", 0x1234, "x");
    rt_phase_vsim_drain();
    return 0;
}
```

### `hybrid/test/rt_c_file_io.c` (new)

HTIF file I/O round-trip with in-program validation. Path is fixed (`/tmp/rt_c_file_io.tmp`); test self-unlinks. On byte-mismatch, `rt_fail()` terminates vsim with code 1 before handoff.

```c
#include "runtime/rt_c_helpers.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define PATH "/tmp/rt_c_file_io.tmp"
static const char payload[] = "vsim-htif file-io round-trip 0123456789\n";

int main(void) {
    rt_phase_qemu1_drain();
    setvbuf(stdout, NULL, _IONBF, 0);

    FILE *fp = fopen(PATH, "w+");
    if (!fp)                                            { printf("FAIL fopen\n");  rt_fail(); }
    if (fwrite(payload, 1, sizeof payload - 1, fp)
            != sizeof payload - 1)                      { printf("FAIL fwrite\n"); rt_fail(); }
    if (fseek(fp, 0, SEEK_SET) != 0)                    { printf("FAIL fseek\n");  rt_fail(); }

    char buf[sizeof payload];
    size_t n = fread(buf, 1, sizeof payload - 1, fp);
    if (n != sizeof payload - 1)                        { printf("FAIL fread n=%zu\n", n); rt_fail(); }
    if (memcmp(buf, payload, sizeof payload - 1) != 0)  { printf("FAIL memcmp\n"); rt_fail(); }
    if (fclose(fp) != 0)                                { printf("FAIL fclose\n"); rt_fail(); }
    if (unlink(PATH) != 0)                              { printf("FAIL unlink\n"); rt_fail(); }

    printf("rt_c_file_io: %zu bytes round-tripped\n", n);
    rt_phase_vsim_drain();
    return 0;
}
```

## Files to modify

### `hybrid/test/Makefile`

Append a C-fixture rule and add the fixtures to `all`/`clean`. Note `-nostartfiles` (keep our `crt0.S`) but no `-nostdlib` -- we need newlib for `printf`/`fopen`.

```make
RT_C_FIXTURES := rt_c_hello rt_c_printf rt_c_file_io
RUNTIME_DIR   := runtime
RUNTIME_SRCS  := $(RUNTIME_DIR)/crt0.S $(RUNTIME_DIR)/trap.S \
                 $(RUNTIME_DIR)/libgloss.c $(RUNTIME_DIR)/handler.c
RT_C_CFLAGS   := -march=rv64gc -mabi=lp64d -O1 -static -nostartfiles \
                 -I$(RUNTIME_DIR) -Wall

all: ... $(RT_C_FIXTURES:%=%.elf)

$(RT_C_FIXTURES:%=%.elf): %.elf: %.c $(RUNTIME_SRCS) $(RUNTIME_DIR)/rt_c.ld
	$(CC) $(RT_C_CFLAGS) -T $(RUNTIME_DIR)/rt_c.ld $< $(RUNTIME_SRCS) -o $@

clean:
	rm -f ... $(RT_C_FIXTURES:%=%.elf) $(RT_C_FIXTURES:%=%.o)
```

### `cmake/HybridConfig.cmake`

Append three lines to `VSIM_RT_FIXTURES` (around line 95):

```cmake
"rt_c_hello:0"
"rt_c_printf:0"
"rt_c_file_io:0"
```

The existing foreach auto-registers `test_e2e_rt_c_hello`, `test_e2e_rt_c_printf`, `test_e2e_rt_c_file_io`, all reusing `roundtrip_e2e.sh` unchanged.

## Why this works on both halves

- **QEMU1**: `crt0.S` brings up caches/FP/V/UNA, `init_mtvec` writes `mtvec`, `main` runs the prologue (no I/O), hits `csrwi 0x7C0, 0`. Plugin's `on_handoff` (`hybrid/qemu_plugin/hybrid_handoff.c:171-240`) drains and `exit(0)`s QEMU. No libgloss reachable -> no `0xE0080000` access -> safe on QEMU virt.
- **vsim**: gdbstub-restores GPR/PC/FP/CSR, runs the body. `printf` -> newlib -> `_write(1, ...)` -> per-byte poke to `0xE0080004`, picked up by `sim_control.hpp:138`. `fopen`/`fwrite`/`fread`/`fclose`/`unlink` -> `frontend_syscall` -> packet at `magicmem`, address written to `0xE0080010`, vsim's `dispatch` (`sim_control.hpp:249-277`) executes the host syscall and writes back the return value. `setvbuf(_IONBF)` ensures every printf byte hits the wire before `csrwi 0x7C0, 1`. On any mismatch: `rt_fail()` writes `0x01234569` to `0xE0080000`, vsim's `handle_sim_command` (`sim_control.hpp:188`) sets `exits=1`, `simulator.hpp:399-404` returns 1 before handoff. On success: `csrwi 0x7C0, 1` triggers handoff, vsim spawns QEMU2.
- **QEMU2**: gdbstub-restored, falls through `return 0` (compiler emits `li a0, 0; ret`, then `crt0.S` does `call _exit`). Patched `_exit` writes `0xE0080000` first (silent dead on QEMU virt) then issues semihosting `SYS_EXIT_EXTENDED 0`. QEMU2 (spawned with `-semihosting-config enable=on,target=native` per `qemu_handback.hpp:131`) terminates with status 0; vsim's `waitpid` returns it; vsim's process exit = 0. Harness sees `RC == EXPECT_RC == 0` -> PASS.

Stack `_stack=0x80700000` is in QEMU virt's default 128 MiB RAM (`0x80000000..0x88000000`) and in vsim RAM (`RAM_BASE..RAM_END = 0x0..0x8FFFFFFF`), so both halves' stack writes land in real RAM.

## Verification

```bash
# Build the fixtures
make -C /local/nick/vsim/hybrid/test rt_c_hello.elf rt_c_printf.elf rt_c_file_io.elf

# Confirm vsim and QEMU plugin are present
ls /local/nick/vsim/build/sim_ax45mpv_premium \
   /local/nick/vsim/hybrid/qemu_plugin/libhybrid_handoff.so

# Sanity-check ELF layout (sections + symbols at expected addresses)
riscv64-unknown-elf-objdump -h /local/nick/vsim/hybrid/test/rt_c_hello.elf
riscv64-unknown-elf-nm       /local/nick/vsim/hybrid/test/rt_c_hello.elf \
  | grep -E '^[0-9a-f]+ [TBDA] (_start|main|_stack|_end|_edata|_exit|init_mtvec)$'

# Drive the harness for each fixture
cd /local/nick/vsim/build
for f in rt_c_hello rt_c_printf rt_c_file_io; do
    FIXTURE=$f EXPECT_RC=0 bash ../tests/hybrid/roundtrip_e2e.sh
done

# Or via CTest after a CMake reconfigure
cd /local/nick/vsim/build && ctest -R 'test_e2e_rt_c_' --output-on-failure
```

Expected results:
- `rt_c_hello`: vsim log contains `hello from vsim`; final RC=0.
- `rt_c_printf`: vsim log contains `dec=-42 hex=deadbeefcafe str=vsim chr=Z ptr=0x80000000 pad=[    7]` and the widths line; RC=0.
- `rt_c_file_io`: vsim log contains `rt_c_file_io: 41 bytes round-tripped`; `/tmp/rt_c_file_io.tmp` does not exist post-run (self-unlinked); RC=0.

Failure-mode validation (sanity check the fail path works at all): temporarily change `payload` between write and compare in `rt_c_file_io.c`, rebuild, rerun -- harness must report `FAIL[rt_c_file_io]: expected exit 0, got 1`.

## Critical files

New:
- `/local/nick/vsim/hybrid/test/runtime/rt_c.ld`
- `/local/nick/vsim/hybrid/test/runtime/rt_c_helpers.h`
- `/local/nick/vsim/hybrid/test/rt_c_hello.c`
- `/local/nick/vsim/hybrid/test/rt_c_printf.c`
- `/local/nick/vsim/hybrid/test/rt_c_file_io.c`

Modified:
- `/local/nick/vsim/hybrid/test/runtime/libgloss.c`  (patch `_exit` to dual-path: sim_control + semihosting)
- `/local/nick/vsim/hybrid/test/Makefile`            (add `RT_C_FIXTURES` + rule, extend `all`/`clean`)
- `/local/nick/vsim/cmake/HybridConfig.cmake`        (append three fixtures to `VSIM_RT_FIXTURES`)

Reused unchanged:
- `/local/nick/vsim/hybrid/test/runtime/{crt0.S,trap.S,handler.c,htif.h,syscall.h,core_v5.h,platform.h,memory_map.h}`
- `/local/nick/vsim/tests/hybrid/roundtrip_e2e.sh` (already fixture-parameterized)
- `/local/nick/vsim/src/platform/sim_control.hpp` (the MMIO peer for libgloss writes)
- `/local/nick/vsim/src/hybrid/{qemu_handback.hpp,handoff_controller.hpp,state_drain.hpp}` (the round-trip orchestration)
