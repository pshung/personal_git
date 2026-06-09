---
name: project_hsim_cpp_rewrite
description: Plan to rewrite the Python hsim driver as a native C++20 executable; roadmap at driver/ROADMAP.md
metadata: 
  node_type: memory
  type: project
  originSessionId: 0bf4826c-6256-4947-9d43-891b80de273c
---

Ongoing project: rewrite the repo-root `hsim` (Python, ~1591 lines) as a single
native **C++20** executable. Roadmap (14 features F0-F13) lives at
**`driver/ROADMAP.md`** - NOT the repo-root `ROADMAP.md`, which is the existing
master FR tracker and must not be clobbered.

Locked decisions (from the user):
- hsim **runtime functionality** must be pure C++ - no Python, no shell on the run
  path. **Build and test infrastructure may stay shell/Python** (`build` shells
  `scripts/build_*.sh`; `test` shells `scripts/run_e2e.sh`).
- **No QEMU2 handback** in the driver (no gdbstub restore). Every mode's cycle
  figure is the vsim `mcycle` delta, so dropping phase 3 is lossless for
  measurement. QEMU2 round-trip correctness stays validated by `hsim test`.
- **CoSIM = lock-step co-verification**, a selectable mode, OFF by default;
  vsim never writes back to QEMU. **Design now, build later** (F13 = spec
  `docs/cosim.md` + stubbed `--mode cosim`, no execution).
- Orchestration core = a loopable **phase-plan engine** (C++ analog of
  `tools/orchestrator/plan.py` Session/Step); each mode is a short plan.
- The driver is standalone: depends only on libc++ + `include/hybrid/state_abi.h`
  (`#include` the struct; mcycle@624, minstret@632, sizeof==3624). The gdbstub
  C++ headers in `verilator/src/hybrid/` are NOT needed (handback dropped); note
  CLAUDE.md's key-files table wrongly lists a `qemu_handback.hpp` that does not exist.
- TDD per feature; flywheel = differential parity harness `tests/hsim/parity.sh`
  diffing `python3 hsim.py` (golden) vs `build/hsim`. Keep Python as reference
  until F12 swaps repo-root `hsim` to the binary.

Related: [[feedback_roadmap_in_repo]] (user reviews task breakdowns as a repo .md).
