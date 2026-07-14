---
name: vsim-build-via-container
description: vsim_andesim must be rebuilt with ./build_vsim.sh (podman container); host cmake on build/ always fails
metadata: 
  node_type: memory
  type: project
  originSessionId: 69056ceb-86cf-4fd0-8b4d-19d65f580232
---

The vsim_andesim build tree (`/home/nick/work/vsim_andesim/build`) was
configured INSIDE a container with the repo mounted at `/work`, so running
`cmake --build build` on the host fails with "source directory /work does
not exist". Rebuild with `./build_vsim.sh` (podman, incremental ninja,
builds all CPUs in config.yaml).

**Why:** CMakeCache.txt records /work paths; only the container sees them.

**How to apply:** After editing vsim_andesim sources, run
`cd /home/nick/work/vsim_andesim && ./build_vsim.sh`. Do not pipe the build
through `tail` when the exit code matters - zsh reports the pipe's last
command, which masked this exact failure once.
