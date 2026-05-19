# Plan: F13 -- user-specified mmap size with explicit backend dir

## Context

Today the QEMU+vsim shared mmap is hardcoded to 128 MiB under `/dev/shm`
in 5 places (`hsim:660`, `hsim:822`, `tests/e2e.sh:56`, two test fixtures).
The choice is invisible to users; there is no way to request a larger
mmap, and no way to redirect the backing file off tmpfs.

Workloads with a memory footprint > /dev/shm capacity (typically RAM/2)
have no escape hatch today. This feature adds two knobs and one rule:

- `--mmap-size SPEC` -- per-invocation request ("8G", "512M", "1024").
- `HSIM_MMAP_DIR=/path` -- env override of the backing directory.
- Hard rule: we never auto-fall-back to a different filesystem. If the
  pinned directory does not have space, we error rc=2 with a clear hint
  pointing at `HSIM_MMAP_DIR`. No tmpfs/disk probing. No surprises.

Rationale for the hard rule: filesystem type cannot be inferred safely.
On most Arch hosts `/tmp` is itself tmpfs (systemd's `tmp.mount`), so a
"fall back to /tmp" heuristic is cosmetic. The user owns disk topology;
we just honor their choice and validate it.

## Surface

```
./hsim run      <elf> --mmap-size 8G      # already has --mode; gains --mmap-size
./hsim archive  --state S --mmap M --mmap-size 8G ...   # already has --mmap-size; wire it
./hsim profile  <elf> --mmap-size 8G ...
./hsim estimate <elf> --mmap-size 8G ...
HSIM_MMAP_DIR=/scratch ./hsim run <elf> --mmap-size 64G  # disk-backed
```

Default behavior is unchanged: no flag => 128 MiB on `/dev/shm`. Existing
shell scripts that hardcode `mktemp -p /dev/shm` are untouched (they all
use the 128 MiB default, which always fits).

On every allocation, one status line lands on stdout:

```
[hsim mmap] 8.0 GiB at /scratch (free: 64.0 GiB)
```

## Selection logic (the entire policy)

```python
def select_mmap_dir(size: int) -> Path:
    margin = 256 * 1024 * 1024  # 256 MiB safety
    pinned = os.environ.get("HSIM_MMAP_DIR")
    target = Path(pinned) if pinned else Path("/dev/shm")
    if not target.is_dir():
        raise NoSpaceError(f"{target} is not a directory; set HSIM_MMAP_DIR")
    st = os.statvfs(target)
    free = st.f_bavail * st.f_frsize
    if free < size + margin:
        raise NoSpaceError(
            f"{target} has {free} bytes free, need {size + margin}; "
            f"set HSIM_MMAP_DIR=/path/with/more/space"
        )
    return target
```

One pinned location. One capacity check. One error path. That is the
whole feature.

## Critical files

| File | Change |
|------|--------|
| `tools/hsim_shm.py` (new, ~80 lines) | `parse_size(spec)`, `select_mmap_dir(size)`, `allocate(size, prefix)` -> `Path`. Single source of truth for size parsing + backend selection + sparse-file allocation. |
| `hsim` | Add `--mmap-size SPEC` to subparsers `p_run`, `p_archive`, `p_profile`, `p_estimate`. Replace the three hardcoded `tempfile.mkstemp(dir="/dev/shm") + os.truncate(..., _SHM_SIZE)` blocks with `tools.hsim_shm.allocate(size, prefix=...)`. Consolidate the 128 MiB constant to one place: `_DEFAULT_MMAP_SIZE` in `hsim` already exists; remove `_SHM_SIZE` duplicate at line 660. |
| `tools/orchestrator/mmap_owner.py` | `MmapOwner.allocate()` already accepts `dir=...`; no code change, but its default `"/dev/shm"` becomes a fallback the new helper bypasses. Document in module docstring. |
| `docs/USER_GUIDE.md` | New subsection "Requesting more memory" under each affected command, plus a top-level note on `HSIM_MMAP_DIR`. |
| `tests/hsim/test_hsim_mmap_backend.sh` (new) | RED test. |

## Out of scope (deferred, F14)

- Migrating 14 shell scripts (`tests/e2e.sh`, `tests/demos/*.sh`,
  `tests/drivers/*.sh`, `tests/plugin/*.sh`) to call `tools/hsim_shm`.
  They all use the 128 MiB default and always fit /dev/shm, so no
  immediate need. Mechanical sweep when someone wants it.
- Hugetlbfs auto-detection. Power users set
  `HSIM_MMAP_DIR=/mnt/huge` themselves.
- `./hsim doctor --mmap-size 8G` dry-run capacity probe. Easy to add
  later; not required for the core feature.

## TDD ordering

One behavioral commit, one structural commit (Tidy First).

### Behavioral commit (RED + GREEN)

1. Write `tests/hsim/test_hsim_mmap_backend.sh`:
   - `./hsim run --help` mentions `--mmap-size`.
   - `--mmap-size 8XBG` (bogus suffix) -> rc=2 with parse error hint.
   - `--mmap-size 999P` (1 PB, won't fit anywhere) -> rc=2 with NoSpace hint.
   - `HSIM_MMAP_DIR=/no/such/dir` -> rc=2 with hint.
   - `HSIM_MMAP_DIR=$tmpdir --mmap-size 128M --dry-run` succeeds; status line `[hsim mmap]` appears.
   - Default (no flag, no env) still uses 128 MiB on `/dev/shm` (regression guard).
   - Set executable, run -> assertions fail.
2. Implement `tools/hsim_shm.py` with `parse_size`, `select_mmap_dir`, `allocate`.
3. Wire into `hsim` (4 commands, 1 doctor row).
4. Re-run the new test until green.
5. Run `bash tests/hsim/test_hsim_run_smoke.sh`,
   `test_hsim_archive_replay.sh`, `test_hsim_profile_cluster.sh`,
   `test_hsim_estimate.sh` -- all must still pass byte-identically (default 128 MiB path).
6. Run `JOBS=8 MODE=both bash scripts/run_e2e.sh` -- must hold 45 PASS / 0 FAIL.
7. Commit `behavioral: add --mmap-size + HSIM_MMAP_DIR to ./hsim`.

### Structural commit (docs + roadmap)

1. Update `docs/USER_GUIDE.md` with the new flag + env var.
2. Update `driver_ROADMAP.md`: add F13 section, extend DAG.
3. Commit `structural: doc F13 (mmap size + backend dir)`.

## Existing helpers to reuse

- `os.statvfs` -- free space probe (no new deps).
- `tempfile.mkstemp(dir=...)` -- already used at `hsim:728`.
- `os.truncate(path, size)` -- already used at `hsim:731`.
- `_resolve_artifacts()` (`hsim:188`) -- artifact lookup, unchanged.
- `tools/orchestrator/mmap_owner.MmapOwner.allocate(size, dir=...)`
  (`tools/orchestrator/mmap_owner.py:40`) -- already accepts `dir`.

## Verification

```sh
# Feature's own RED test
bash tests/hsim/test_hsim_mmap_backend.sh

# F9/F10/F11/F12 regression guards (must stay byte-identical)
bash tests/hsim/test_hsim_run_smoke.sh
bash tests/hsim/test_hsim_archive_replay.sh
bash tests/hsim/test_hsim_profile_cluster.sh
bash tests/hsim/test_hsim_run_icount_slice.sh
bash tests/hsim/test_hsim_estimate.sh

# Global invariant
JOBS=8 MODE=both bash scripts/run_e2e.sh    # 45 PASS / 0 FAIL

# Manual eyeball: small request on /dev/shm (default backend)
./hsim run tests/fixtures/rt_c_v_regs.elf --mmap-size 64M
# Manual eyeball: large request on disk-backed dir
HSIM_MMAP_DIR=/var/tmp ./hsim run tests/fixtures/rt_c_v_regs.elf --mmap-size 256M
# Manual eyeball: error when /dev/shm cannot hold the request
./hsim run tests/fixtures/rt_c_v_regs.elf --mmap-size 999P
#   -> rc=2, hint "set HSIM_MMAP_DIR=..."
```

## What this plan deliberately does NOT do

- No auto-discovery of "the best disk." The user owns layout.
- No filesystem-type probing. Free bytes is the only signal.
- No silent fallback chain. One pinned dir, one statvfs check, one error.
- No shell-script migration. The hardcoded 128 MiB sites always fit.
- No hugetlbfs special-casing. `HSIM_MMAP_DIR=/mnt/huge` is enough.
