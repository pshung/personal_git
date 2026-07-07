export const meta = {
  name: 'commit-history-analysis',
  description: 'Analyze commit history of andesim, vsim_andesim, qemu_andesim for review-series re-synthesis',
  phases: [
    { title: 'Commit analysis', detail: 'per-chunk commit-by-commit analysis in all 3 repos' },
    { title: 'Feature mapping', detail: 'map final diff to feature groups; find spine files' },
    { title: 'Legacy hunt', detail: 'find unneeded legacy code in final trees' },
  ],
}

const COMMIT_SCHEMA = {
  type: 'object',
  required: ['commits'],
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sha', 'subject', 'feature_group', 'disposition'],
        properties: {
          sha: { type: 'string' },
          subject: { type: 'string' },
          feature_group: { type: 'string', description: 'short slug naming the feature this commit belongs to, e.g. v-transport, csr-andes-v3, driver-cli, engine-registration, docs, build-externalize' },
          disposition: { type: 'string', enum: ['keep-as-feature', 'squash-into-feature', 'churn-cancelled-out', 'docs-only', 'test-only'], description: 'churn-cancelled-out = this commit adds code that a LATER commit in the range removes again (net zero in final tree)' },
          cancelled_by: { type: 'string', description: 'sha of the later commit that removes this work, if disposition=churn-cancelled-out' },
          files: { type: 'array', items: { type: 'string' }, description: 'main files touched (up to 10)' },
          notes: { type: 'string', description: 'one sentence: what it actually does, and anything a reviewer would need' },
        },
      },
    },
  },
}

const FEATURE_MAP_SCHEMA = {
  type: 'object',
  required: ['features', 'spine_files'],
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'title', 'files'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'slugs of features that must be committed before this one' },
          minimal_prototype: { type: 'string', description: 'what the smallest working prototype commit of this feature would contain' },
        },
      },
    },
    spine_files: {
      type: 'array',
      description: 'files touched by MANY features - these need hand-authored intermediate versions across the series',
      items: {
        type: 'object',
        required: ['file', 'touched_by'],
        properties: {
          file: { type: 'string' },
          touched_by: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const LEGACY_SCHEMA = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'kind', 'evidence', 'risk'],
        properties: {
          path: { type: 'string' },
          kind: { type: 'string', description: 'dead-script | retired-driver | dead-doc | dead-option | dead-code-path | orphan-test' },
          evidence: { type: 'string', description: 'why it is unneeded: who references it, who does not' },
          risk: { type: 'string', enum: ['safe', 'loses-feature', 'unsure'], description: 'safe = nothing depends on it; loses-feature = removing it drops user-visible functionality' },
          feature_lost: { type: 'string', description: 'if risk=loses-feature, what functionality disappears' },
        },
      },
    },
  },
}

phase('Commit analysis')

// andesim: 238 commits from base 16a8c53 to branch andesim. Chunk into 6.
const ANDESIM = '/home/nick/work/andesim'
const VSIM = '/home/nick/work/vsim_andesim'
const QEMU = '/home/nick/work/qemu_andesim'
const andesimChunks = []
const TOTAL = 238, CHUNK = 40
for (let start = 0; start < TOTAL; start += CHUNK) {
  andesimChunks.push({ start, count: Math.min(CHUNK, TOTAL - start) })
}

const commitPrompt = (repo, range, start, count, extra) => `You are analyzing git commit history for a review-series re-synthesis. Repo: ${repo}. Do NOT modify anything - read-only git commands only.

The full range is: ${range} (oldest to newest). Get the ordered list with:
  git -C ${repo} log --reverse --oneline ${range} | sed -n '${start + 1},${start + count}p'

That gives you YOUR ${count} commits (positions ${start + 1}..${start + count} of the range, oldest first). For EACH commit run 'git -C ${repo} show --stat <sha>' (and 'git show <sha>' on the patch when the stat is not enough to understand it) and classify it.

Key classification: 'churn-cancelled-out' means the commit introduces code/files that a LATER commit ANYWHERE in the full range (not just your chunk) deletes again, so the work is absent from the final tree. To check suspicions, use 'git -C ${repo} log --oneline ${range} -- <path>' and check whether the file/code exists at the final tree ('git -C ${repo} cat-file -e <tip>:<path>'). Known churn themes to watch for: Program-Buffer GPR/CSR sweep transport (added then fully removed later), icount/simpoint/cosim triggers (removed), QEMU/verilator submodules (removed, externalized), demo/build/test subcommands removed from the driver. ${extra || ''}

Group commits into feature slugs consistently. Use these canonical slugs where they fit: build-externalize, abi-submodule, driver-cli, driver-run, hybrid-core, v-transport, csr-andes-v3, csr-mext-v4, l2c-v5, write-mask-v6, liveness-gate, engine-registration, caps-gating, verify, rv32, privilege, fixtures, runtime-vplat, e2e-harness, docs, notebooks, cleanup. Invent a new slug only when none fits.

Return ONLY the structured object.`

const analysisTasks = []
for (const c of andesimChunks) {
  analysisTasks.push(() => agent(
    commitPrompt(ANDESIM, '16a8c53..andesim', c.start, c.count),
    { label: `andesim-commits-${c.start + 1}-${c.start + c.count}`, phase: 'Commit analysis', schema: COMMIT_SCHEMA }
  ))
}
// vsim: 46 commits base 03dfe23..qemu-isa-match, 2 chunks
for (const c of [{ start: 0, count: 23 }, { start: 23, count: 23 }]) {
  analysisTasks.push(() => agent(
    commitPrompt(VSIM, '03dfe23..qemu-isa-match', c.start, c.count,
      'In this repo the churn theme is: PB GPR block-load/csr_sweep transport added (a3a82ab, 8b13dcf, 0330543, d4bfcf6, 21e8060 area) then removed by 747e209 and 80ab50d.'),
    { label: `vsim-commits-${c.start + 1}-${c.start + c.count}`, phase: 'Commit analysis', schema: COMMIT_SCHEMA }
  ))
}
// qemu: 3 commits
analysisTasks.push(() => agent(
  commitPrompt(QEMU, 'd2fd7e7d87..andesim', 0, 3,
    'Only 3 commits. For each also judge: is it already a clean, self-contained, reviewable commit? Suggest an improved commit message if needed. Put suggestions in notes.'),
  { label: 'qemu-commits', phase: 'Commit analysis', schema: COMMIT_SCHEMA }
))

phase('Feature mapping')

const featureTasks = [
  () => agent(`Map the TOTAL change of the andesim branch into reviewable feature groups. Repo: ${ANDESIM} (read-only).

Run 'git -C ${ANDESIM} diff --stat 16a8c53..andesim' to get all ~329 changed files. Explore the final tree (branch 'andesim') to understand the architecture: read CLAUDE.md at the tip, ls key dirs (driver/, qemu_plugin/, runtime/, tests/, scripts/, engines dirs, docs/).

Assign EVERY changed file to exactly one feature group (canonical slugs: build-externalize, abi-submodule, driver-cli, driver-run, hybrid-core, v-transport, csr-andes-v3, csr-mext-v4, l2c-v5, write-mask-v6, liveness-gate, engine-registration, caps-gating, verify, rv32, privilege, fixtures, runtime-vplat, e2e-harness, docs, notebooks, cleanup; invent only if none fits). For each feature give depends_on (what must exist first) and describe the minimal_prototype (the smallest working slice that could be its first commit).

Separately list spine_files: files touched by 3+ features (check with 'git -C ${ANDESIM} log --oneline 16a8c53..andesim -- <file> | wc -l' on suspects like the driver sources, run_e2e.sh, e2e.sh, USER_GUIDE.md, CLAUDE.md, qemu_plugin/hybrid_handoff.c, tests/fixtures/Makefile).

Also note files DELETED vs base (git diff --diff-filter=D --name-only 16a8c53..andesim) - deletions of base files must appear in the series as explicit removal commits. Return ONLY the structured object.`,
    { label: 'andesim-feature-map', phase: 'Feature mapping', schema: FEATURE_MAP_SCHEMA }),

  () => agent(`Map the TOTAL change of the vsim hybrid branch into reviewable feature groups. Repo: ${VSIM} (read-only).

Run 'git -C ${VSIM} diff --stat 03dfe23..qemu-isa-match'. Explore the tip tree: src/hybrid/*.hpp, tests/hybrid/, cmake/HybridConfig.cmake, hybrid/ dir, tools/. Assign EVERY changed file to one feature group (same canonical slugs as the sibling repo: hybrid-core, v-transport, csr-andes-v3, csr-mext-v4, l2c-v5, write-mask-v6, liveness-gate, caps-gating, engine-registration, verify, e2e-harness, build-externalize, abi-submodule, docs, cleanup; invent only if none fits). depends_on + minimal_prototype for each.

spine_files: expect resume_driver.hpp, state_drain.hpp, handoff_controller.hpp, simulator integration, HybridConfig.cmake - verify with 'git log --oneline 03dfe23..qemu-isa-match -- <file> | wc -l'. Also list files deleted vs base. Return ONLY the structured object.`,
    { label: 'vsim-feature-map', phase: 'Feature mapping', schema: FEATURE_MAP_SCHEMA }),

  () => agent(`List the commit history of the shared ABI repo so a rewritten series can pin correct submodule SHAs. Repo: ${ANDESIM}/include (a git submodule checkout of andesim_abi). Read-only.

Run 'git -C ${ANDESIM}/include log --oneline --all' and 'git -C ${ANDESIM}/include log --format="%H %s" main'. For each commit note which ABI version (v1..v6) it corresponds to (check HYBRID_STATE_VERSION in include/hybrid/state_abi.h at each commit via 'git show <sha>:hybrid/state_abi.h | grep -n VERSION' - adjust path if the header lives elsewhere, find it with 'git ls-tree -r --name-only <sha>').

Return features=[{slug: 'abi-vN', title: subject, files: [full sha]}], spine_files=[]. One entry per ABI-version-relevant commit, oldest first.`,
    { label: 'abi-version-map', phase: 'Feature mapping', schema: FEATURE_MAP_SCHEMA }),
]

phase('Legacy hunt')

const legacyTasks = [
  () => agent(`Hunt for unneeded legacy code in the FINAL tree of branch 'andesim' in ${ANDESIM}. Read-only. The user wants all unneeded legacy code REMOVED in an upcoming history rewrite - your job is the candidate inventory with evidence.

Known suspects to verify (do not assume - check who references each):
- hsim.py (retired Python driver; check: does driver/ C++ implement archive/replay? grep the C++ sources. What references hsim.py: tests/hsim/*, tests/andes_sim/parity.sh, docs)
- tests/hsim/* (smoke tests of the retired driver)
- tests/andes_sim/parity.sh (byte-parity vs the golden)
- docs/archive/ and any ROADMAP files for completed work (docs/verilator_externalize_ROADMAP.md, driver/ROADMAP.md - are they historical records or live plans?)
- dead scripts in scripts/ (check each script: is it invoked by anything - other scripts, docs, tests, CI?)
- tests/test_kernel_cycles.sh and other root-level tests - still runnable? reference hsim.py?
- semihost_exit.inc fallback, tests/drivers/, tests/lib/ - who uses them?
- any file in the tip tree referencing removed features (icount trigger, simpoint, cosim, PB sweep, demo subcommand)

For each candidate: evidence (exact reference count, who calls it), risk (safe / loses-feature / unsure), feature_lost if applicable. Be thorough - walk ALL top-level files and scripts/ and decide each one. Untracked files are out of scope (only tracked files). Return ONLY the structured object.`,
    { label: 'legacy-andesim', phase: 'Legacy hunt', schema: LEGACY_SCHEMA }),

  () => agent(`Hunt for unneeded legacy code in the FINAL tree of branch 'qemu-isa-match' in ${VSIM}. Read-only. Candidate inventory with evidence for an upcoming history rewrite that removes unneeded legacy code.

Focus on files the hybrid work touched (git diff --name-only 03dfe23..qemu-isa-match) plus anything referencing removed features: legacy PB CSR-sweep remnants (pb csr_sweep was removed by 747e209/80ab50d - any dead helpers left in src/hybrid/*.hpp or tools?), dead CLI options, orphan tests in tests/hybrid/ that test removed code, dead docs (ROADMAP.md sections for shipped work), hybrid/ dir contents, stubs/. For each src/hybrid header, check every public function is actually called somewhere (grep). Also check tools/ scripts referenced by nothing.

risk classification: safe / loses-feature / unsure. Only tracked files. Return ONLY the structured object.`,
    { label: 'legacy-vsim', phase: 'Legacy hunt', schema: LEGACY_SCHEMA }),

  () => agent(`Check the 3 andesim commits in ${QEMU} (range d2fd7e7d87..andesim, branch 'andesim') for legacy/dead code. Read-only.

Show each commit's full patch. Check: does any part of the 3 patches add code that nothing uses? Is the SimControl device (hw/misc/andes_sim_control.c or similar) wired into the build (meson) and machine init? Any leftover debug printf/dead ifdef? Return candidates=[] if all clean. Return ONLY the structured object.`,
    { label: 'legacy-qemu', phase: 'Legacy hunt', schema: LEGACY_SCHEMA }),
]

const [analysis, features, legacy] = await parallel([
  () => parallel(analysisTasks),
  () => parallel(featureTasks),
  () => parallel(legacyTasks),
])

const commits = (analysis || []).filter(Boolean).flatMap(r => r.commits || [])
log(`Analyzed ${commits.length} commits; ${(features || []).filter(Boolean).length} feature maps; ${(legacy || []).filter(Boolean).flatMap(l => l.candidates || []).length} legacy candidates`)

return {
  commits,
  featureMaps: {
    andesim: features && features[0],
    vsim: features && features[1],
    abi: features && features[2],
  },
  legacy: {
    andesim: legacy && legacy[0],
    vsim: legacy && legacy[1],
    qemu: legacy && legacy[2],
  },
}