export const meta = {
  name: 'refactor-discovery',
  description: 'Fan out read-only reviewers over andesim subsystems, verify each refactor candidate',
  phases: [
    { title: 'Review', detail: 'one reviewer per subsystem' },
    { title: 'Verify', detail: 'one skeptic per finding' },
  ],
}

const ROOT = '/home/nick/work/andesim'

const COMMON = `
You are reviewing the andesim repo at ${ROOT} (branch llamacpp) for STRUCTURAL refactor candidates.
First read ${ROOT}/CLAUDE.md to understand the architecture.

HARD RULES:
- READ-ONLY. Do not edit, build, or run anything (no make, no scripts, no ./andesim). Baseline test runs are using the build tree right now. Use Read/Grep/Glob and read-only git commands only.
- Structural = behavior-preserving: dead code, duplication, needless complexity, stale comments/docs that contradict the code, naming that hides intent, repo hygiene. NOT rewrites for taste. The repo just went through a history cleanup, so it is fairly clean; report only what you can defend with evidence. An empty findings list is a valid answer.
- If you find what looks like a real BUG (behavior wrong), report it with category "bug-report" - it will be handled separately, not as a refactor.
- For every finding give: file (repo-relative), line, category, title, one-paragraph detail with EVIDENCE (what you read/grepped), safety (why removing/changing it cannot change behavior), verify_with (which existing test or check proves it after the change).
- Cite real file paths and line numbers you actually read. No speculation.

Your assigned scope (do not wander into other subsystems except to grep for references):`

const REVIEWERS = [
  { key: 'driver-run', scope: `driver/ run path: cmd_run.cpp, run_plan.cpp/.hpp, process.cpp/.hpp, shm.cpp/.hpp, memmap.cpp/.hpp and any headers they own. Look hard at cmd_run.cpp (839 lines - the biggest file): long functions, repeated argv-assembly patterns, dead branches.` },
  { key: 'driver-cmds', scope: `driver/ command + infra layer: main.cpp, cli.cpp/.hpp, argv.hpp, cmd_list.cpp, cmd_doctor.cpp, engine_registry.cpp/.hpp, manifest.cpp/.hpp, elf_syms.cpp/.hpp, state_diff.cpp/.hpp, json.hpp, log.hpp and friends. Duplicated table-printing / string helpers, dead symbols.` },
  { key: 'driver-profile', scope: `the profile feature: driver/profile.cpp/.hpp, driver/cmd_profile.cpp, qemu_plugin/hotIterationLoop.c. cmd_profile.cpp (441) vs profile.cpp (450) - check for logic duplicated between them and against cmd_run.cpp (e.g. QEMU argv assembly, engine sync).` },
  { key: 'plugin', scope: `qemu_plugin/hybrid_handoff.c (764 lines) + qemu_plugin/Makefile. Do NOT review the vendored qemu_plugin/include/qemu-plugin.h. Look for dead drain paths, duplicated CSR-list iteration that should use the X-macro, stale comments about removed QEMU2 leg.` },
  { key: 'runtime-vplat', scope: `runtime/ top level: crt0.S, handler.c, trap.S, vplat_syscalls.c, htif_client.c/.h, core_v5.h, andesim.ld, andesim.specs, Makefile. Duplication between syscall paths, stale semihosting remnants.` },
  { key: 'runtime-linux', scope: `runtime/linux/ (the new vlinux proxy kernel from commit cf8a7ee): syscall.c (693 lines), stack.c, loader.c, mm.c, main.c, vlinux.ld. This is the newest code - look for copy-paste from runtime/ top level, dead debug scaffolding, magic numbers that duplicate constants defined elsewhere.` },
  { key: 'scripts', scope: `scripts/*.sh, scripts/*.py, setup.sh, config.env.example, Dockerfile.runtime. Also check: is scripts/__pycache__ tracked in git (git ls-files scripts/)? Duplicated env-resolution logic across build_*.sh vs setup.sh.` },
  { key: 'tests-shell', scope: `tests/e2e.sh, tests/lib/ (helpers), tests/andes_sim/*.sh, tests/plugin/*.sh, tests/vplat/*.sh, and scripts/run_e2e.sh interplay. Copy-paste across the ~30 contract scripts (arg parsing, assert helpers, setup boilerplate) that tests/lib should own; dead test scripts referencing removed features.` },
  { key: 'tests-fixtures', scope: `tests/fixtures/ (Makefile + all .c/.S sources) and driver/*_test.cpp file list. Dead fixtures nothing builds/runs (grep run_e2e.sh + e2e.sh + tests/**/*.sh for each fixture name), duplicated fixture boilerplate, Makefile rules that could collapse.` },
  { key: 'docs-hygiene', scope: `README.md, CLAUDE.md (verify claims against reality by grepping the code it describes), docs/*, ROADMAP.md, ROADMAP_LINUX_RUNTIME.md (roadmap says COMPLETE - is it stale?), ROADMAP_HTIF_WINDOW.md (commit c6af314 says feature complete), .gitignore (should it cover output.log / *.tmp debris like the untracked hello_marker.c, output.log, rt_linux_*.tmp, COMMIT_REFACTOR_*.md at root?), docs/USER_GUIDE.md accuracy for the newest features (profile, cpp, vlinux). Stale docs = docs whose statements contradict the current code; cite both sides.` },
]

const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'], additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'category', 'title', 'detail', 'safety', 'verify_with'],
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          category: { type: 'string', enum: ['dead-code', 'duplication', 'simplify', 'stale-doc', 'hygiene', 'naming', 'bug-report'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          safety: { type: 'string' },
          verify_with: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', required: ['verdict', 'reason'], additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REJECTED', 'RISKY'] },
    reason: { type: 'string' },
  },
}

const results = await pipeline(
  REVIEWERS,
  r => agent(`${COMMON}\n${r.scope}\n\nReturn your findings as the structured output.`, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (rev, orig) => {
    if (!rev || !rev.findings.length) return { key: orig.key, verified: [] }
    return parallel(rev.findings.map(f => () =>
      agent(`You are an adversarial verifier for a proposed STRUCTURAL refactor in the andesim repo at ${ROOT}.
READ-ONLY: do not edit, build, or run anything. Use Read/Grep/Glob only.

Claim (from reviewer ${orig.key}):
- file: ${f.file}:${f.line}
- category: ${f.category}
- title: ${f.title}
- detail: ${f.detail}
- claimed safety: ${f.safety}

Try to REFUTE it. For dead-code: grep the WHOLE repo (and the demo suite at /home/nick/work/andesim-demo, and consider that vsim lives in a separate repo /home/nick/work/vsim_andesim - grep there too if the symbol could cross repos) for references. For duplication: read both sites fully and check they really are behavior-identical. For stale-doc: read the doc AND the code it describes. For bug-report: check whether the behavior is actually wrong vs intended. If the change could alter ANY observable behavior (output text, exit codes, file layout, test expectations), verdict RISKY with the exact risk. If the claim is wrong, REJECTED. Only CONFIRMED when you verified the evidence yourself.`,
        { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, reviewer: orig.key, verdict: v ? v.verdict : 'REJECTED', verdict_reason: v ? v.reason : 'verifier died' }))
    )).then(verified => ({ key: orig.key, verified: verified.filter(Boolean) }))
  }
)

const all = results.filter(Boolean).flatMap(r => r.verified)
const confirmed = all.filter(f => f.verdict === 'CONFIRMED')
const risky = all.filter(f => f.verdict === 'RISKY')
const rejected = all.filter(f => f.verdict === 'REJECTED')
log(`confirmed=${confirmed.length} risky=${risky.length} rejected=${rejected.length}`)
return { confirmed, risky, rejected_titles: rejected.map(f => `${f.file}: ${f.title} -- ${f.verdict_reason}`) }