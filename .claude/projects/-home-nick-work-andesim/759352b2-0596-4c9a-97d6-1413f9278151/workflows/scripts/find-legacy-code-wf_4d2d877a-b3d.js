export const meta = {
  name: 'find-legacy-code',
  description: 'Sweep andesim + vsim repos for legacy/dead code, adversarially verify each candidate',
  phases: [
    { title: 'Find', detail: 'parallel scoped finders over both repos' },
    { title: 'Verify', detail: 'adversarial refutation per candidate' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'path', 'kind', 'claim', 'evidence'],
        properties: {
          repo: { type: 'string', enum: ['andesim', 'vsim'] },
          path: { type: 'string', description: 'repo-relative path' },
          lines: { type: 'string', description: 'line range like 10-50, or "whole file"' },
          kind: { type: 'string', enum: ['dead-file', 'dead-code-block', 'unused-script', 'stale-doc', 'stale-config', 'legacy-fallback'] },
          claim: { type: 'string', description: 'one sentence: what is legacy and why' },
          evidence: { type: 'string', description: 'concrete evidence: grep results, git log, doc contradictions' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['isLegacy', 'confidence', 'reasoning'],
  properties: {
    isLegacy: { type: 'boolean', description: 'true = confirmed safe-to-delete legacy; false = refuted (still used or intentional)' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string', description: 'what references were checked and what was found' },
    deleteScope: { type: 'string', description: 'exact file(s)/line-range to delete if isLegacy' },
  },
}

const CONTEXT = `
Two related repos:
- andesim: /home/nick/work/andesim (branch andesim). Hybrid RISC-V simulator orchestration: C++ driver (driver/, ./andesim), QEMU TCG plugin (qemu_plugin/), runtime (runtime/), test harness (tests/, scripts/), docs.
- vsim: /home/nick/work/vsim_andesim. External vsim (SystemC+Verilator) with hybrid orchestration in src/hybrid/*.hpp, cmake/, tests/.

Known history (ground truth for what "legacy" means here — read CLAUDE.md at /home/nick/work/andesim/CLAUDE.md and git log for detail):
- The QEMU2 handback leg was REMOVED: flow is now QEMU1 -> vsim, done. Any code/option/doc still implementing or describing a QEMU2 resume/ship-back step is legacy.
- vsim used to live in-tree under verilator/ in andesim; it moved to the external repo. Anything in andesim still referencing an in-tree verilator/ path, or building vsim locally, is legacy. NOTE: andesim/CLAUDE.md itself has a stale "vsim CMake Structure" section claiming "vsim lives entirely in verilator/" — stale docs count as findings.
- QEMU also moved to an external prebuilt (QEMU_BIN_DIR); anything cloning/building QEMU in-tree is legacy.
- Semihosting/libgloss_vh: nothing in-tree links -lgloss_vh anymore; the vplat runtime replaced it. BUT asm fixtures intentionally keep a semihosting exit fallback (semihost_exit.inc) — that is NOT legacy, per CLAUDE.md.
- The shell driver was replaced by the C++ ./andesim driver as the only user-facing driver; tests/e2e.sh is still the harness used internally (NOT legacy).

Rules:
- ONLY tracked files (git ls-files). Ignore untracked/gitignored files entirely.
- include/ in andesim is a git submodule (shared ABI pinned by BOTH repos) — never propose deletions inside it. Same for vsim external/ submodules.
- Do not propose deleting anything just because it looks old — you need positive evidence it is dead: unreferenced (grep both repos), superseded, or describes removed behavior.
- Check references across BOTH repos before claiming dead (vsim scripts may call andesim files and vice versa).
- Use git log --follow on suspicious files to understand their story.
Return findings as structured data. Be precise with paths and line ranges.
`

phase('Find')
const scopes = [
  { key: 'andesim-scripts', prompt: `${CONTEXT}\nScope: andesim scripts/ directory, setup.sh, config.env.example, Dockerfile.runtime, and the root ./andesim wrapper. Find legacy: unused scripts (nothing calls them — grep both repos, docs, and other scripts), dead functions inside scripts, stale env vars/options for removed features (QEMU2, in-tree verilator/QEMU builds), commented-out blocks kept "just in case". List what each scripts/* file is and who calls it.` },
  { key: 'andesim-driver', prompt: `${CONTEXT}\nScope: andesim driver/ (C++ driver sources). Find legacy: dead code paths, options/flags for removed features (QEMU2 leg, in-tree vsim), unused functions/classes (grep for call sites), stale comments describing removed behavior, dead #if/ifdef branches.` },
  { key: 'andesim-tests', prompt: `${CONTEXT}\nScope: andesim tests/ (e2e.sh, fixtures/, andes_sim/, plugin/, vplat/, hybrid/ if present). Find legacy: fixtures no ,longer wired into any runner (check tests/e2e.sh, scripts/run_e2e.sh, cmake in the vsim repo at /home/nick/work/vsim_andesim/cmake/), harness code for removed features (QEMU2 leg), Makefile targets building nothing used, dead helper functions. Remember semihost_exit.inc fallback in asm fixtures is intentional, not legacy.` },
  { key: 'andesim-plugin-runtime', prompt: `${CONTEXT}\nScope: andesim qemu_plugin/ and runtime/. Find legacy: dead code in hybrid_handoff.c and other plugin sources (unused plugin args, code for the removed QEMU2 leg), libhotloops.so — check whether anything still uses it (grep both repos + docs), runtime/ sources superseded or unreferenced, Makefile cruft.` },
  { key: 'andesim-docs', prompt: `${CONTEXT}\nScope: andesim docs/, README.md, CLAUDE.md, ROADMAP*.md. Find stale-doc legacy: sections describing REMOVED behavior as current (QEMU2 handback, in-tree verilator/ builds, "vsim CMake Structure" section, Key Files table pointing at verilator/src/... paths that do not exist in this repo), completed ROADMAP files that are fully done and superseded, docs referencing files that no longer exist (verify each referenced path exists). Only flag tracked files.` },
  { key: 'vsim-src', prompt: `${CONTEXT}\nScope: vsim repo /home/nick/work/vsim_andesim: src/ (especially src/hybrid/*.hpp), CMakeLists.txt, cmake/, config.yaml, stubs/. Find legacy: dead code paths (QEMU2/handback remnants, unused functions — grep for call sites across src/ tests/ tools/), stubs/ content nothing uses, CMake options/targets that are dead, code guarded by flags that can never be set anymore.` },
  { key: 'vsim-tests-tools', prompt: `${CONTEXT}\nScope: vsim repo /home/nick/work/vsim_andesim: tests/, tools/, data/, docs/, build scripts (build.sh, build-docker.sh, build_vsim.sh — note build_vsim.sh and start_jupyter.sh are UNTRACKED, skip them). Find legacy: test files not registered in any CMake/ctest, tools nothing references, data files nothing loads, stale docs describing removed behavior.` },
  { key: 'cross-repo-concepts', prompt: `${CONTEXT}\nScope: BOTH repos, concept-driven sweep. grep -rn (tracked files only) for these removed-feature markers and report every hit that is live code or current-tense doc (not a historical note/changelog): "qemu2", "QEMU2", "handback", "hand-back", "ship.*back", "gloss_vh", "semihost" (excluding the intentional asm-fixture fallback), "verilator/" as an andesim-local path, in-tree QEMU build references, "resume leg". Also check for TODO/FIXME/XXX comments referencing already-completed migrations. Classify each hit: live legacy code vs intentional historical mention.` },
]

const found = await parallel(scopes.map(s => () =>
  agent(s.prompt, { label: `find:${s.key}`, phase: 'Find', schema: FINDINGS_SCHEMA })
))

// barrier justified: dedup across finders before paying for verification
const all = found.filter(Boolean).flatMap(r => r.findings)
const seen = new Map()
for (const f of all) {
  const k = `${f.repo}:${f.path}:${f.lines || 'whole'}`
  if (!seen.has(k)) seen.set(k, f)
  else seen.get(k).evidence += ' | also: ' + f.claim
}
const unique = [...seen.values()]
log(`${all.length} raw findings -> ${unique.length} unique candidates`)
if (unique.length === 0) return { confirmed: [], refuted: [] }

phase('Verify')
const verified = await parallel(unique.map(f => () =>
  agent(`${CONTEXT}
You are an adversarial verifier. A finder claims this is LEGACY code safe to delete. Try hard to REFUTE it.

Finding: repo=${f.repo} path=${f.path} lines=${f.lines || 'whole file'} kind=${f.kind}
Claim: ${f.claim}
Evidence given: ${f.evidence}

Repo roots: andesim=/home/nick/work/andesim, vsim=/home/nick/work/vsim_andesim.
Checks you MUST do:
1. Read the file/lines yourself — does the claim match reality?
2. grep BOTH repos (tracked files) for references: filename, function names, symbols, script names, make targets, cmake targets, doc links.
3. Check tests/e2e.sh, scripts/*, Makefiles, CMake, and CLAUDE.md/docs for indirect usage (variable-built names, glob patterns like test_*.sh runners).
4. git log --follow -5 on the file: was it recently touched for a live feature?
5. Is it an INTENTIONAL fallback/compat layer per CLAUDE.md (e.g. semihost_exit.inc)?
If ANY live reference or intentional-keep reason exists, verdict isLegacy=false. Default to false when uncertain. If true, give the exact deleteScope.`,
    { label: `verify:${f.path.split('/').pop()}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(v => (v ? { ...f, verdict: v } : null))
))

const done = verified.filter(Boolean)
const lost = unique.length - done.length
if (lost > 0) log(`${lost} candidates lost to failed verifier agents (not verified, not dismissed)`)
const confirmed = done.filter(f => f.verdict.isLegacy && f.verdict.confidence !== 'low')
const refuted = done.filter(f => !f.verdict.isLegacy)
const lowConf = done.filter(f => f.verdict.isLegacy && f.verdict.confidence === 'low')
log(`confirmed=${confirmed.length} refuted=${refuted.length} low-confidence=${lowConf.length}`)
return { confirmed, lowConf, refuted: refuted.map(f => ({ path: f.path, why: f.verdict.reasoning.slice(0, 300) })) }