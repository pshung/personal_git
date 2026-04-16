---
name: AndesCycle vsim Pipeline Simulator
description: Location and usage of the AX45MPV cycle-accurate simulator (vsim/AndesCycle) for pipeline analysis
type: reference
---

- Workspace: `/local/nick/vsim-workspace/`
- Simulator binary: `/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium`
- Python module: `/local/nick/vsim-workspace/vsim/build/sim_ax45mpv_premium.cpython-313-x86_64-linux-gnu.so`
- Pipeline log tool: `/local/nick/vsim-workspace/vsim/tools/konata.py` (needs `--experimental` for VPU)
- Function profiler: `/local/nick/vsim-workspace/vsim/tools/functrace.py`
- Demo programs: `/local/nick/vsim-workspace/vsim-demo/rvv/`
- Guide doc: `/local/nick/vsim-workspace/docs/GUIDE-AX45MPV-PIPELINE.md`
- Python import workaround: `ln -sfn /local/nick/vsim-workspace/vsim/tools /tmp/vsim && PYTHONPATH=/tmp`
- Current RTL config: VLEN=512 (ax45mpv_premium)
