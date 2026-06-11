---
name: hotloops-tool-paths
description: "QEMU/scripts/hotloops.sh needs explicit --qemu/--plugin paths in this repo (out-of-tree build), plus the invocation that works"
metadata: 
  node_type: memory
  type: reference
  originSessionId: e41bc0d4-d741-42b4-ba15-e56e60fb3e8e
---

`QEMU/scripts/hotloops.sh` defaults to `QEMU/build/...` but this repo
builds QEMU out-of-tree, so it always needs:

```
QEMU/scripts/hotloops.sh \
  --qemu build/qemu/qemu-system-riscv64 \
  --plugin build/qemu/contrib/plugins/libhotloops.so \
  --cpu "andes-ax45mpv,vext_spec=v1.0,vlen=512" \
  --min-iters 10 <elf>
```

Notes:
- Default report mode is `--llm` (Markdown fact sheet). Build the ELF
  with `-g` to get `function (file:line)` in the TL;DR.
- The default RVV-only filter hides scalar loops; `--no-optimize-rvv`
  shows them.
- The script auto-picks `llvm-objdump` first from PATH.
- Pass the engine's VLEN in `--cpu` (default is vlen=1024, engines here
  are 512/128 - see `andes-sim list engines`).
- Each loop block emits `measure: --pc-start 0x<entry> --pc-end 0x<ret>`
  (enclosing function span) ready for `--trigger pc`; the loop's own
  pc_range measures only ONE iteration (one-shot triggers).
- `measure_loop:` = loop-only window [header, branch fall-through);
  drains on the loop's FIRST exit -> one complete pass of a re-entered
  inner loop (extrapolate by outer trip count).
