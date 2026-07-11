---
name: ace-in-andesim-bringup
description: "How to run Andes ACE (custom-extension) demos under andesim fast/cycle, and the copilot/eca/agent version blockers."
metadata: 
  node_type: memory
  type: project
  originSessionId: d4acc424-ef55-4ed7-9f3a-84e6f586675c
---

Goal: make andesim-demo run ACE demos (ref: /local/nick/vsim-demo-new/demo/ace, ace-rvv) in fast (QEMU) and cycle (vsim) modes. Started 2026-07-11.

**Pipeline per demo**: `copilot <x>.ace` -> `lib/libacetool.eca` (assembler encodings) + `include/ace_user.h` (C intrinsics) + `lib/libacesim.so` (SID C++ model). Compile: `gcc <src> -march=rv64gc..._xandes -Wa,-mace=lib/libacetool.eca -B <andesim>/build/runtime -specs=andesim.specs`. The andesim vplat runtime links fine with ACE ELFs.

**eca format is version-matched to the assembler** (root cause of "format error"):
- Old/compatible eca = tiny file, plaintext `//VERSION://DATE://SHA` header + AES-128-CBC (key `58b5d7a9973581c7b4ef9e9fc3963d26`, embedded in `as`) over a compact encoding array. ALL installed assemblers (AST540/541/542/550) accept ONLY this.
- The engineering copilot `/home/nick/work/copilot/copilot/build/src/copilot` (7.3.0) emits a NEW eca = AES-CBC (key `_COPILOT_SECRET_`) over the FULL ace-description JSON (~256KB). NO installed assembler reads it -> "format error". Needs a newer `as` than exists here.
- Working copilot for eca: `/local/ycc738/copilot/bin/copilot` (emits old-format eca, AST541 loads it). Older `/local/ycc738/COPILOT_726_*` emits `libacetool.so` instead.
- To build the engineering copilot's libacesim.so you must stage headers it expects (install step not run): copy `tool/copilot-agent-v5.git/*.h` -> `build/include/v5/`, `tool/ttmath.git/ttmath-0.9.3/{AceCommon,AceXInt,AceFP}.hpp + ttmath/` -> `build/include/`, `tool/berkeley-softfloat-3.git/{AceSoftFP.hpp, AceSewException.hpp, AceSoftFPImpl.hpp, AceSoftFPTemplate.hpp}` + `source/include/*.h` + `build/Linux-x86_64-GCC/platform.h` -> `build/include/{,softfp/}`, and `build/tool/berkeley-softfloat-3.git/libsoftfloat.a` -> `build/lib/`. Also pass `--cxx-path /usr/bin/g++`.

**Toolchains**: `/local/nick/SW_Release/build-ast5*` and `/local/ycc738/andes_toolchains/ast5*` are NFS (atcsqa16) -> intermittent EPERM ("operation not permitted") on exec; retry in a loop. `/home/nick/nds64le-elf-newlib-v5d` is local gcc 14.3.0 (AST550-ish) and reliable but also only reads old-format eca.

**Fast mode (QEMU) is BLOCKED on the ACE agent .so**: andesim passthrough CAN inject it -- `./andesim run --mode fast <elf> -- -cpu andes-ax46mpv,xandesace=on,xandesacelib=<agent>.so` (second -cpu wins). But QEMU dlsym's a C ABI `ace_agent_{version,register,run_insn,get_register,set_register,get_packet}` at version `ACE_AGENT_VERSION=102` (see qemu `target/riscv/ace-helper.h` + `andes_ace_helper.c.inc`). copilot's `libacesim.so`/`libacefsim.so` export only the C++ `Copilot_Agent`/`ACE_SID_CLASS` -> "register failed". A C shim (ace-helper impl wrapping the SID model) must be compiled into the agent .so; it is NOT produced by any copilot flag found, and no prebuilt agent .so exists in any local tree (ACE has only ever run on vsim here, never QEMU).

**Cycle mode (vsim)** is NOT passthrough: engine must be rebuilt with the demo's `libaceasim.a` (`copilot --gen-asim`) wired into vsim `config.yaml` `libaceasim_path` (per-cpu) then `ninja sim` (ref: ace-rvv README). Engineering copilot `--gen-asim` on test_inst.ace failed with an internal RTL-gen error ("ace_cmd_pc width zero", "ACM interface must be axi/ahb/sram").

**Copilot fragmentation (no single copilot does everything here)**: `/local/ycc738/copilot` makes the compatible old-format eca but has NO `--gen-asim` (cycle input). The engineering 7.3.0 copilot has `--gen-asim` + `--gen-fastsim` but makes an incompatible eca AND `--gen-asim` errored on test_inst.ace. So compile and cycle-input currently need different copilots.

**andesim currently has ZERO ACE awareness** (no xandesace/eca/agent handling in src). Real integration work, not just `--` passthrough. See [[log-first-debugging]] [[andes-engine-config-source]].
