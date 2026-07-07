export const meta = {
  name: 'vsim-series-build',
  description: 'Build the curated 22-commit review series for vsim_andesim in a worktree',
  phases: [
    { title: 'Build series', detail: 'one agent per commit, sequential' },
    { title: 'Verify', detail: 'tree parity + full unit-test pass' },
  ],
}

const SCRATCH = '/tmp/claude-1002/-home-nick-work-andesim/669779f8-77ed-406b-ab12-a36a1624de65/scratchpad'
const SPEC = SCRATCH + '/vsim_series.json'
const WT = SCRATCH + '/wt/vsim'
const REPO = '/home/nick/work/vsim_andesim'
const IDS = ['v01','v02','v03','v04','v05','v06','v07','v08','v09','v10','v11','v12','v13','v14','v15','v16','v17','v18','v19','v20','v21','v22']

const RES = {
  type: 'object', required: ['status','summary'],
  properties: {
    status: { type: 'string', enum: ['committed','blocked'] },
    sha: { type: 'string' },
    summary: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'every place you departed from the spec and why' },
    validation_notes: { type: 'string' },
  },
}

const POLICY = `You are building ONE commit of a curated, review-ready git series for the vsim_andesim repo. This series re-synthesizes 46 messy historical commits into ~22 clean ones, prototype-first.

WORKSPACE
- Work ONLY in the worktree ${WT} (branch review/vsim-series). NEVER modify ${REPO}'s main checkout or any other worktree; read-only git commands against ${REPO} are fine (the worktree shares the object db, so 'git -C ${WT} show <sha>' reaches all history).
- NEVER run 'git push'. NEVER touch branches other than review/vsim-series.
- Start by confirming 'git -C ${WT} status --short' is clean (except untracked scratch you then remove). End with EXACTLY ONE new commit and a clean status.

SPEC
- Read ${SPEC}. Find YOUR commit entry by id. Also read the top-level keys: abi_pins, legacy_never_add, expected_delta_vs_old_tip. Where the spec text says SCRATCH, substitute ${SCRATCH}.
- The reference map of historical-commit-to-feature is in ${SCRATCH}/vsim_feature_commits.txt.

SOURCE OF TRUTH
- File content comes from the FINAL tree: 'git -C ${WT} show qemu-isa-match:<path>' (or 'git checkout qemu-isa-match -- <path>' when a file lands at final form). Historical commits ('git show <sha>') are REFERENCE ONLY for what belonged to which feature - never resurrect old buggy versions when the final file has the fixed form.
- Intermediate versions of spine files (resume_driver.hpp etc.) are authored by SUBTRACTING later features from the final file, per your spec entry. After subtracting, verify no dangling references remain.
- NEVER introduce anything on the legacy_never_add list. The final series tree must equal qemu-isa-match EXCEPT expected_delta_vs_old_tip.

VALIDATION (must pass before committing)
- Header-only unit tests: for each tests/hybrid/*.test.cpp your spec says to validate (and any you touched), compile+run from the worktree:
    g++ -std=c++20 -I <ABI> -I ${REPO}/external/doctest/doctest -I ${WT}/src <test file> -o /tmp/claude-1002/vtest && /tmp/claude-1002/vtest
  where <ABI> is ${SCRATCH}/abi/vN for the ABI version pinned at YOUR commit (see spec). Tests needing SystemC (shared_mem_smoke, shared_mem_offset, possibly memory_map) may be skipped with a note.
- If a validation cannot pass, DO NOT commit a broken tree: either fix the construction, or return status=blocked with a precise explanation.

GITLINK RECIPE
- To (re)pin external/andesim_abi: git -C ${WT} update-index --add --cacheinfo 160000,<full sha>,external/andesim_abi   (the directory itself may stay empty; compile checks use the ${SCRATCH}/abi/vN checkouts).

COMMIT MESSAGE
- First line: the spec's subject verbatim. Blank line. Body: flesh out the spec's body_points into 3-8 full sentences a reviewer can follow (what + why, present tense). End with exactly:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

REPORT
- Return status/sha (git rev-parse --short HEAD)/summary plus EVERY deviation from the spec.`

phase('Build series')
const done = []
for (const id of IDS) {
  const r = await agent(
    POLICY + `\n\nYOUR COMMIT: ${id}\n\nCommits already in the series (oldest first): ${JSON.stringify(done)}\n\nBuild ${id} now.`,
    { label: id, phase: 'Build series', schema: RES }
  )
  if (!r || r.status !== 'committed' || !r.sha) {
    log(`ABORTED at ${id}: ${r ? r.summary : 'agent died'}`)
    return { status: 'aborted', at: id, reason: r, done }
  }
  done.push({ id, sha: r.sha, dev: (r.deviations || []).join('; ').slice(0, 240) })
  log(`${id} -> ${r.sha}`)
}

phase('Verify')
const VER = {
  type: 'object', required: ['verdict','issues'],
  properties: {
    verdict: { type: 'string', enum: ['clean','issues-found'] },
    issues: { type: 'array', items: { type: 'string' } },
    delta_report: { type: 'string', description: 'full name-status diff vs qemu-isa-match with per-file assessment' },
    test_report: { type: 'string' },
  },
}
const v = await agent(`Verify the finished review series on branch review/vsim-series in worktree ${WT} (repo ${REPO}, read-only outside the worktree; never push).

1. TREE PARITY: 'git -C ${WT} diff qemu-isa-match HEAD --name-status'. Read ${SPEC} expected_delta_vs_old_tip. Every D line must be on the deleted list, every M/A line on the edited list (gitlink external/andesim_abi must be IDENTICAL at v6). For each edited file, read the actual diff ('git -C ${WT} diff qemu-isa-match HEAD -- <file>') and confirm it contains ONLY the sanctioned legacy removals/text fixes; quote anything else as an issue.
2. FULL TESTS: compile+run EVERY tests/hybrid/*.test.cpp at the tip with g++ -std=c++20 -I ${SCRATCH}/abi/v6 -I ${REPO}/external/doctest/doctest -I ${WT}/src (skip SystemC-linked ones with a note). All must pass.
3. SERIES QUALITY: 'git -C ${WT} log --reverse --stat 03dfe23..HEAD' - flag any commit whose message contradicts its diff, any file added by one commit and deleted by a later one (churn - forbidden), and any commit touching files unrelated to its subject.
Return the structured verdict; be exhaustive in issues.`,
  { label: 'verify', phase: 'Verify', schema: VER })

return { status: 'complete', done, verify: v }