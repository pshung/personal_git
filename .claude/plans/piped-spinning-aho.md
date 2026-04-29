# Plan: Loop-window Kanata pipeline dump

## Context
For pipeline analysis with Konata, the user wants to capture only the steady-state
behavior of a hot loop, not the entire program run. Currently `--kanata <file>`
records the whole simulation, which produces logs that are too large to load and
dominated by warmup transients.

The new feature lets the user say:
"start_loop_pc=A, end_loop_pc=B, skip the first N completed iterations,
record the next X iterations, then exit immediately."

Boundary semantics: iteration count is incremented on each *retire* of
`end_loop_pc` (chosen over fetch to avoid double-counting flushed speculative
fetches).

## Files to modify

| File | Change |
|---|---|
| `src/pipeview/kanata_logger.hpp` | Add `LoopGate` struct + gating in all writers |
| `src/pipeview/kanata_viewer.hpp` | Pass gate through `make_kanata_viewer()` factory |
| `src/pipeview/clarity_viewer.hpp` | Pass gate through `make_clarity_viewer()` and `make_single_clarity_viewer()` |
| `src/simulator_trace.hpp` | Extend `enable_kanata()` / `enable_clarity()` signatures |
| `src/simulator.hpp` | Forward gate from `enable_kanata()` / `enable_clarity()` |
| `src/main.cpp` | Add 4 CLI flags, validate, and forward |

## Design

### 1. `LoopGate` (in `kanata_logger.hpp`)

```cpp
struct LoopGate {
  uint64_t start_pc;
  uint64_t end_pc;
  uint64_t skip_iters;     // pre-warmup retires of end_pc to ignore
  uint64_t record_iters;   // retires to log before exit
};
```

### 2. `KanataLogger` changes

New private members:
```cpp
std::optional<LoopGate>                  gate_;
std::unordered_map<uint64_t, uint64_t>   id_to_pc_;
bool       enabled_     = true;   // unconditionally true when no gate
uint64_t   end_retired_ = 0;
uint64_t   total_cycles_= 0;
uint64_t   start_cycle_ = 0;
uint64_t   recorded_insns_ = 0;
```

New ctor overloads accepting `std::optional<LoopGate>`. When a gate is supplied,
`enabled_` starts `false`.

Writer changes:
- `advance_cycle(n)`: always `total_cycles_ += n`. Emit `C` line only when
  `enabled_`.
- `start_insn(pc, id)`: store `id_to_pc_[id] = pc`. Emit lines only when
  `enabled_`. (Always store map entry so retires can look up the PC.)
- `start_insn_deferred(id)`: same gating. PC is back-filled later.
- `label_insn(id, pc, suffix)`: store `id_to_pc_[id] = pc`. Emit only when
  `enabled_`. Drop the `is_inflight` check when gating, since inflight set is
  only populated under `enabled_` (see below).
- `retire_insn(id)`: look up pc via `id_to_pc_`. Three cases:
  1. `enabled_` → emit `R`, increment `recorded_insns_`. Then handle exit check.
  2. Not enabled, `pc == gate_->end_pc` → no emit but bump `end_retired_`.
  3. Else → no emit.
  Erase `id_to_pc_[id]` at end.
  After increment of `end_retired_` (case 1 or 2):
  - If `end_retired_ == skip_iters`: set `enabled_ = true`, snapshot
    `start_cycle_ = total_cycles_`. We deliberately do NOT replay any in-flight
    instruction state - the recording starts cleanly from this cycle. Konata
    will see the first iteration's IF stage already in-progress; this is the
    expected steady-state view.
  - If `end_retired_ == skip_iters + record_iters`: log summary, call
    `flush_all()`, then `std::exit(0)`.
- `flush_insn(id)`, `stage_insn`, `end_stage_insn`, `comment_insn`: gate by
  `enabled_`. Erase from `id_to_pc_` in `flush_insn`.
- `flush_all()`: always runs (called from dtor and on exit path).

Inflight set behavior: inflight ids are only inserted while `enabled_`, so all
guard checks (`is_inflight`) continue to work for stage/label writes. Pre-window
in-flight insns simply do not appear in the log - again matching the "clean
window" intent.

Exit summary:
```cpp
auto window_cycles = total_cycles_ - start_cycle_;
spdlog::info(
  "Kanata loop window [pc {:#x}..{:#x}]: {} iters, {} insns, {} cycles, IPC={:.3f}",
  gate_->start_pc, gate_->end_pc,
  gate_->record_iters, recorded_insns_, window_cycles,
  window_cycles ? double(recorded_insns_)/double(window_cycles) : 0.0);
```

### 3. Factory plumbing

`make_kanata_viewer()` and `make_clarity_viewer()` (plus
`make_single_clarity_viewer()`) gain an extra parameter:
```cpp
std::optional<kanata::LoopGate> gate = std::nullopt
```
which is forwarded to every `KanataLogger` constructor (multi-core OoO included
- the same gate is applied to every per-core logger).

`SimulatorTrace::enable_kanata()` and `enable_clarity()` gain the same parameter
and pass it through.

`Simulator::enable_kanata()` / `enable_clarity()` likewise.

### 4. CLI (`src/main.cpp`)

Add to the `args` struct:
```cpp
std::optional<uint64_t> kanata_loop_start;
std::optional<uint64_t> kanata_loop_end;
uint64_t                kanata_loop_skip   = 0;
uint64_t                kanata_loop_record = 1;
```

Add 4 `longopt` parsers (accept hex via `0x` prefix or plain decimal). Update
`print_help()`:
```
  --kanata-loop-start <pc>    Start PC of the loop body (hex ok with 0x)
  --kanata-loop-end   <pc>    End  PC of the loop body (retire of this PC
                              advances the iteration counter)
  --kanata-loop-skip  <N>     Skip first N completed iterations [default: 0]
  --kanata-loop-record <X>    Record next X iterations then exit [default: 1]
```

Validation block before the `enable_kanata` / `enable_clarity` calls:
- start and end must both be present, or both absent
- if present, requires `--kanata` or `--clarity` non-empty
- `record >= 1`

Build the `std::optional<LoopGate>` and pass to whichever of
`enable_kanata`/`enable_clarity` is active.

## Verification

1. Compile the simulator: `./build.sh`
2. Run with a tiny test ELF that has a known hot loop, e.g.:
   ```
   ./build/.../sim_ax45mpv_premium <test.elf> \
     --kanata loop.kanata \
     --objdump test.objdump \
     --kanata-loop-start 0x80000100 \
     --kanata-loop-end   0x80000130 \
     --kanata-loop-skip  10 \
     --kanata-loop-record 5
   ```
3. Expect: simulator exits shortly after PC 0x80000130 retires for the 15th time;
   stderr shows the `Kanata loop window ...` summary line with non-zero cycles
   and IPC.
4. Open `loop.kanata` in Konata - the log should contain ~5 iterations of the
   loop body and end cleanly.
5. Regression: run without the loop flags - behavior must be identical to today
   (full-run dump, no exit).
6. Multi-core OoO smoke: run on AX66 with `NDS_NHART > 1` - each per-core
   `*_core{N}.kanata` file should honor the same gate independently (each core
   counts its own end_pc retires).
