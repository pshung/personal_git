export const meta = {
  name: 'roadmap-fact-scouts',
  description: 'Gather precise facts for the Q1_0/Q2_0 RVV optimization roadmap update',
  phases: [
    { title: 'Scout', detail: 'copilot dir, ggml nrc=2 convention, andesim bench flow' },
  ],
}

phase('Scout')

const COPILOT_SCHEMA = {
  type: 'object',
  properties: {
    exists: { type: 'boolean' },
    binaries: { type: 'array', items: { type: 'string' }, description: 'executable paths found' },
    invocation: { type: 'string', description: 'how to invoke it for .ace processing, from --help or docs' },
    notes: { type: 'string' },
  },
  required: ['exists', 'binaries', 'invocation', 'notes'],
}

const NRC_SCHEMA = {
  type: 'object',
  properties: {
    caller: { type: 'string', description: 'file:line + exact code of the mul_mat vec_dot call with num_rows_per_vec_dot > 1' },
    convention: { type: 'string', description: 'exact meaning of s, bs, vx, bx, vy, by for nrc=2 (units: bytes or elements)' },
    example_kernel: { type: 'string', description: 'file:line of one existing nrc==2 kernel and how it writes s[0]/s[bs]' },
    nrows_traits: { type: 'string', description: 'how .nrows is set per-arch in ggml-cpu.c traits (exact ifdef examples + line refs)' },
    row_pairing: { type: 'string', description: 'any constraints: when does mul_mat choose 2 rows, odd-row tail handling' },
  },
  required: ['caller', 'convention', 'example_kernel', 'nrows_traits', 'row_pairing'],
}

const ANDESIM_SCHEMA = {
  type: 'object',
  properties: {
    build_cmd: { type: 'string', description: 'verified compile command for a baremetal C program (toolchain path, specs, march, linker flags)' },
    run_standalone: { type: 'string', description: 'command to run an ELF on the slow/vsim RTL leg standalone, with engine selection ax45mpv_premium' },
    run_hybrid: { type: 'string', description: 'command for hybrid mode with ROI, if standalone vsim not possible' },
    roi_api: { type: 'string', description: 'ROI begin/end marker API: header, function/macro names, file:line in runtime/' },
    cycle_readout: { type: 'string', description: 'how cycles are obtained: rdcycle CSR availability on the vsim leg, or ROI report format' },
    isa_confirm: { type: 'string', description: 'engine describe output or config confirming VLEN/DLEN/ELEN and absence of zfh/zvfh, and whether vector fp32 (zve32f-class) IS present' },
    example: { type: 'string', description: 'path to a working example program + its build/run invocation' },
    caveats: { type: 'string' },
  },
  required: ['build_cmd', 'run_standalone', 'run_hybrid', 'roi_api', 'cycle_readout', 'isa_confirm', 'example', 'caveats'],
}

const [copilot, nrc, andesim] = await parallel([
  () => agent(
    `Explore /home/nick/work/copilot/copilot/build/src (and parent dirs up to /home/nick/work/copilot) READ-ONLY.
This is the Andes COPILOT tool used to process .ace files (ACE = Andes Custom Extension) into assembler plugins (libacetool.so) and simulator models (libaceasim.a). A prior usage example: Makefile rule "$(COPILOT) unpack.ace -a -L license.ini" in /local/nick/vsim-workspace/vsim-demo/ace-tq1/Makefile.
Find: (1) the actual executable binary/binaries (ls, file), (2) how to invoke it (--help, README, docs), (3) any bundled examples of .ace specs. Do NOT run anything that modifies state; --help/--version is fine. Return compact facts with exact paths.`,
    { label: 'scout:copilot', schema: COPILOT_SCHEMA }
  ),
  () => agent(
    `In the llama.cpp repo at /home/nick/work/llama.cpp, find the EXACT calling convention for ggml vec_dot kernels when nrc (num rows) == 2. READ-ONLY.
1. In ggml/src/ggml-cpu/ggml-cpu.c find where mul_mat calls vec_dot with num_rows_per_vec_dot possibly > 1 - quote the exact call with the bs/bx/by arguments and their values, with file:line.
2. Find ONE existing kernel that implements nrc == 2 (search ggml/src/ggml-cpu/arch/ for "nrc == 2", e.g. arm or x86 q4_0/q8_0) and show exactly how it addresses the second row (vx + bx?) and writes the two results (s[0] and s[bs]? s[1]? units in floats or bytes) with file:line.
3. In ggml-cpu.c, show how the .nrows field of type_traits_cpu is set per-architecture (exact #if defined(...) examples with line numbers), and where num_rows_per_vec_dot is decided in mul_mat (any conditions like even row count, src types).
4. Note how odd/tail rows are handled when nrows=2.
Be precise - this defines an ABI a new kernel must match. Quote code, do not paraphrase.`,
    { label: 'scout:nrc2-abi', schema: NRC_SCHEMA }
  ),
  () => agent(
    `Explore /home/nick/work/andesim READ-ONLY to extract the recipe for benchmarking a tiny baremetal C program on the cycle-accurate vsim RTL leg (engine vsim:ax45mpv_premium, VLEN=512 DLEN=512 ELEN=32).
Known context (verified 2026-07 by a previous session): hybrid mode = QEMU fast leg + vsim RTL leg with ROI markers; nothing executes after ROI end (print inside ROI or use --verify); vsim speed ~9 kHz so ROI must be small; baremetal toolchain at /home/nick/nds64le-elf-newlib-v5d (riscv64-unknown-elf, gcc 14.3) with -specs=andesim.specs; runtime/ has vplat with crt0 argv=NULL, no clock_gettime, _sbrk unbounded; standalone "run --mode fast" pins -cpu andes-ax46mpv (Zce gotcha, override with -- -cpu andes-ax45mpv,vlen=512).
Find and verify: (1) the driver CLI (probably a "run" command - check driver/cmd_run.cpp, docs/, quickstart) - exact syntax for hybrid mode AND for running purely on the vsim/RTL leg if possible; (2) the ROI marker API a guest program uses (grep runtime/ and include/ for roi, ROI, marker, region_of_interest - report header + function/macro names + file:line); (3) whether rdcycle/mcycle CSR reads work on the vsim leg and/or whether the tool reports ROI cycle counts itself (check docs and driver output handling); (4) confirm the ax45mpv_premium engine ISA: does it have vector fp32 (zve32f-class instructions)? where is the engine described (describe command? config files?); (5) a working example program in the repo (examples/? tests/?) with its exact build + run commands; (6) the exact gcc invocation the build system uses for guest programs (march string!).
Return exact commands and file:line references, compact.`,
    { label: 'scout:andesim', schema: ANDESIM_SCHEMA }
  ),
])

return { copilot, nrc, andesim }