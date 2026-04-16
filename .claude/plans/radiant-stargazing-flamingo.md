# Plan: User-friendly target config file system

## Context

Currently, users must juggle positional shell arguments, environment variables (`QEMU_SYS_RV64`, `MYPC`, `MYPORT`, `VEC_CFG`), and know which wrapper script to use. This is error-prone and hard to remember. We'll introduce per-CPU INI-style `.cfg` files that centralize all toolchain, QEMU, and board/FPGA settings.

## Deliverables

### 1. Config file format: `config/<cpu>.cfg`

```ini
# config/nx27v.cfg — NX27V (RV64, Vector 1.0, VLEN=512)

[toolchain]
prefix = riscv64-elf-
compiler = riscv64-elf-gcc
# linker =                        # optional, leave empty for default
extra_cflags = -mext-vector

[qemu]
binary = /opt/qemu/bin/qemu-system-riscv64
cpu = andes-nx27v,vext_spec=v1.0,vlen=512
machine = andes_ae350
config = qemu_cfg/zve64d/ADP-AE350-NX27V_dw0.cfg
vec_cfg = zve64d
# run_mode = 0                    # 0=standalone, 1=GDB server

[board]
# ice_host = 192.168.1.10         # ICEman host (default: localhost)
# ice_port = 1234                 # ICEman port (required for board)
# linker_script = project/nx27v/ae350-xip.ld
# cache = on                      # on | lm
# gdb_expect = project/nx27v/gdb-ice-riscv64.exp
```

### 2. Parser script: `config/parse_cfg.sh`

A small bash helper that reads an INI `.cfg` and exports shell variables. Sections map to variable prefixes:
- `[toolchain]` → `CFG_TOOLCHAIN_PREFIX`, `CFG_TOOLCHAIN_COMPILER`, etc.
- `[qemu]` → `CFG_QEMU_BINARY`, `CFG_QEMU_CPU`, etc.
- `[board]` → `CFG_BOARD_ICE_HOST`, `CFG_BOARD_ICE_PORT`, etc.

Uses pure bash (awk one-liner) — no external dependencies.

### 3. Example config files

Create configs for key CPUs covering all target categories:
- `config/nx27v.cfg` — RV64 + V-ext (QEMU)
- `config/d25.cfg` — RV32 + DSP
- `config/ax45mpv.cfg` — RV64 + V-ext + 45-series
- `config/x86.cfg` — host build (no simulator)

### 4. Integration into `build.sh` and `test.sh`

Add `--config <file>` option to both scripts. When provided, the config file is parsed and its values used instead of (or merged with) positional arguments. Existing positional-argument usage remains fully supported for backward compatibility.

**build.sh changes:**
- Parse `--config` if present as first arg
- Source the parsed config to get `CFG_TOOLCHAIN_*` values
- Fall through to existing CPU logic if no `--config`

**test.sh changes:**
- Parse `--config` if present as first arg
- Map config values to existing internal variables (`CC`, `SIM_WRAPPER`, `TEST_TARGET`, etc.)
- Set `QEMU_SYS_RV64`/`QEMU_SYS_RV32`, `MYPC`, `MYPORT`, `VEC_CFG` from config
- Fall through to existing positional-arg logic if no `--config`

### 5. Files to create/modify

| File | Action |
|------|--------|
| `config/parse_cfg.sh` | **Create** — INI parser |
| `config/nx27v.cfg` | **Create** — example config |
| `config/d25.cfg` | **Create** — example config |
| `config/ax45mpv.cfg` | **Create** — example config |
| `config/x86.cfg` | **Create** — example config |
| `build.sh` | **Modify** — add `--config` support at top |
| `test.sh` | **Modify** — add `--config` support at top |

## Verification

1. Run `source config/parse_cfg.sh config/nx27v.cfg && env | grep CFG_` to verify parsing
2. Run `./build.sh --config config/x86.cfg` to verify build integration
3. Run existing `./build.sh D25` to verify backward compatibility
4. Verify `test.sh --config config/nx27v.cfg BS3` parses and maps correctly
