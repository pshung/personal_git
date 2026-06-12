# Memory Index

- [QEMU vl/vtype gdbstub write fix](project_qemu_vl_vtype.md) - QEMU silently drops P-packet writes to vl/vtype; fix: write_vl/write_vtype + debugger bypass in hybrid_qemu/target/riscv/csr.c
- [run_e2e.sh JOBS cap](feedback_e2e_jobs.md) - Use JOBS=8 on this 128-core host; default of 128 causes timeouts from vsim CPU saturation
- [Propose, don't defer](feedback_propose_dont_defer.md) - For design questions, state the recommendation first; AskUserQuestion is for info only the user has
- [Hybrid unit test host build](reference_hybrid_unit_test_host_build.md) - Fast host g++ command to build+run hybrid doctest tests without the container; vsim rebuild + e2e commands
- [Verify codegen with objdump](feedback_verify_codegen_with_objdump.md) - Barriers/spills don't pin instruction position, only data deps do; check nm/objdump before asserting compiler behavior
- [Roadmap as repo file](feedback_roadmap_in_repo.md) - User reviews task breakdowns as a task-named roadmap .md in repo root (like gemm_modes.md), not the plan-mode plan file; don't clobber the top-level ROADMAP.md
- [QEMU timeout SIGTTOU hang](feedback_qemu_timeout_sigttou.md) - QEMU -nographic wrapped by `timeout` hangs from SIGTTOU; fix with `</dev/null` before output redirect
- [/simplify per-commit cascades](feedback_simplify_per_commit_cascade.md) - Folding /simplify into each commit cascade-conflicts on hot files; code was already /simplify'd in dev -- prefer one pass at the branch tip
- [andes-sim framework](project_hsim_cpp_rewrite.md) - C++20 multi-engine sim framework replacing Python hsim; roadmap at driver/ROADMAP.md; models fast/accurate/hybrid, drop-in engines via --describe, transparent passthrough, no QEMU2 handback, no CoSIM
- [Golden is `hsim.py`, entry is `./andes-sim`](reference_golden_driver_hsim_filename.md) - F14 swap done (cd86036): root andes-sim wrapper self-builds the C++ driver; hsim.py is the frozen parity golden; SimPoint pipeline is still golden-only; doctor hints lockstep
- [hotloops.sh tool paths](reference_hotloops_tool_paths.md) - needs --qemu build/qemu/... --plugin build/qemu/contrib/plugins/libhotloops.so; pass engine VLEN in --cpu; build ELF with -g for file:line
- [vsim halt slack](project_vsim_halt_slack.md) - exit drain retires 0-3 extra insns past the trigger on ax45mpv, more on wider cores (ax66: 5+); align comparisons to the drained pc (plugin drain_pc=), pad fixtures generously
- [rt_c_matmul empty ROI](project_rt_c_matmul_empty_roi.md) - FIXED 7022599; lesson: marker "memory" clobbers only cover escaped memory (statics can hoist/DCE across markers); guard test: tests/fixtures/test_fixture_roi_content.sh
- [cosim checkpoint co-sim](project_cosim_roi.md) - see cosim_roi.md in repo: --cosim (dev) drains vsim checkpoints every N retires + QEMU oracle at same minstret deltas; mmap stays shared (oracle replays from boot on own RAM); register-only (memory co-sim rejected); suppresses window_cycles
- [Background Bash cwd](feedback_background_bash_cwd.md) - background tasks inherit last foreground cwd; absolute paths + check log content, trailing echo masks rc
