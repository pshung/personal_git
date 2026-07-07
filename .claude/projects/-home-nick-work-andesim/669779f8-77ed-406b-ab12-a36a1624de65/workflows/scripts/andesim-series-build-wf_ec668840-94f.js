export const meta = {
  name: 'andesim-series-build',
  description: 'Build the curated 38-commit review series for andesim in a worktree',
  phases: [
    { title: 'Build series', detail: 'one agent per commit, sequential' },
    { title: 'Verify', detail: 'tree parity + build pass at tip' },
  ],
}

const SCRATCH = '/tmp/claude-1002/-home-nick-work-andesim/669779f8-77ed-406b-ab12-a36a1624de65/scratchpad'
const SPEC = SCRATCH + '/andesim_series.json'
const WT = SCRATCH + '/wt/andesim'
const REPO = '/home/nick/work/andesim'
const IDS = ['c01','c02','c03','c04','c05','c06','c07','c08','c09','c10','c11','c12','c13','c14','c15','c16','c17','c18','c19','c20','c21','c22','c23','c24','c25','c26','c27','c28','c29','c30','c31','c32','c33','c34','c35','c36','c37','c38']

const RES = {
  type: 'object', required: ['status','summary'],
  properties: {
    status: { type: 'string', enum: ['committed','blocked'] },
    sha: { type: 'string' },
    summary: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
    validation_notes: { type: 'string' },
  },
}

const POLICY = `You are building ONE commit of a curated, review-ready git series for the andesim repo. This series re-synthesizes 238 messy historical commits into ~38 clean ones, prototype-first, with all retired/legacy code removed for good.

WORKSPACE
- Work ONLY in the worktree ${WT} (branch review/andesim-series). NEVER modify ${REPO}'s main checkout or other worktrees; read-only git against ${REPO} is fine ('git -C ${WT} show <sha>' reaches all history).
- NEVER run 'git push'. Only branch review/andesim-series.
- Start: 'git -C ${WT} status --short' must be clean (config.env and build outputs are allowed untracked). End: EXACTLY ONE new commit, clean status.

SPEC
- Read ${SPEC}: your commit entry by id, plus top-level abi_pins, env, include_submodule_recipe, legacy_never_add, expected_delta_vs_old_tip. Substitute ${SCRATCH} for SCRATCH and ${WT} for WT in spec text.
- Historical-commit-to-feature reference map: ${SCRATCH}/andesim_feature_commits.txt.

SOURCE OF TRUTH
- Final tree = branch 'andesim' ('git -C ${WT} show andesim:<path>', 'git -C ${WT} checkout andesim -- <path>'). Historical commits are reference only; the final file is the fixed, correct form.
- Spine-file intermediates (hybrid_handoff.c, cmd_run.cpp, state_diff.cpp, tests/fixtures/Makefile, e2e scripts, USER_GUIDE/CLAUDE.md...) are authored by SUBTRACTING later features from the final version per your spec entry; verify no dangling references.
- NEVER introduce anything in legacy_never_add. Final series tree must equal branch 'andesim' EXCEPT expected_delta_vs_old_tip.

INCLUDE/ SUBMODULE
- At c07 the in-tree include/hybrid headers are replaced by the andesim_abi submodule. Setup for c07: after 'git rm -r' of the in-tree headers, remove the leftover include/ dir, then 'git -C ${REPO}/include worktree add --detach ${WT}/include <v2 pin sha>' and 'git -C ${WT} add include' plus the .gitmodules entry (copy from the final tree). To advance the pin later (c26/c28/c34/c35): 'git -C ${WT}/include checkout <pin sha>' then 'git -C ${WT} add include'. Never turn include/ into a plain tracked directory after c07.

VALIDATION ENV
- export QEMU_BIN_DIR=/home/nick/work/qemu_andesim/build/qemu VSIM_BIN_DIR=/home/nick/work/vsim_andesim/build HYBRID_TOOLCHAIN=/home/nick/nds64le-elf-newlib-v5d and PATH additions as needed; create ${WT}/config.env (untracked) with those values at c04 if your spec says so.
- Run every validate item in your spec entry from ${WT}. Cheap standing checks once the pieces exist: 'make -C qemu_plugin', the driver build + unit tests (discover how scripts/test_all.sh runs its unit/contract phases and use the relevant subset), 'make -C runtime', 'make -C tests/fixtures'. An 'EXPECTED TO FAIL' note in the spec means record, don't gate.
- If validation cannot pass, DO NOT commit a broken tree: fix it or return status=blocked with precise detail.

COMMIT MESSAGE
- First line: spec subject verbatim. Blank line. Body: 3-8 full sentences fleshing out body_points (what + why). End with exactly:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

REPORT
- Return status/sha (git rev-parse --short HEAD)/summary + EVERY deviation.`

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
    delta_report: { type: 'string' },
    build_report: { type: 'string' },
  },
}
const v = await agent(`Verify the finished review series on branch review/andesim-series in worktree ${WT} (repo ${REPO}; never push; do not touch other checkouts).

1. TREE PARITY: 'git -C ${WT} diff andesim HEAD --name-status'. Read ${SPEC} expected_delta_vs_old_tip. Every D must be on the deleted list, every M/A on the edited list; include/ gitlink must sit at the v6 pin. For each edited file read the full diff and confirm ONLY sanctioned removals/text fixes; quote anything else.
2. BUILD PASS at tip (env: QEMU_BIN_DIR=/home/nick/work/qemu_andesim/build/qemu VSIM_BIN_DIR=/home/nick/work/vsim_andesim/build HYBRID_TOOLCHAIN=/home/nick/nds64le-elf-newlib-v5d): make -C qemu_plugin; driver build + unit/contract test subset that does not need long e2e runs (see scripts/test_all.sh); make -C runtime; make -C tests/fixtures. All green.
3. SERIES QUALITY: 'git -C ${WT} log --reverse --stat 16a8c53..HEAD' - flag message/diff mismatches, add-then-delete churn (forbidden), unrelated file touches, and any commit that would obviously not build (e.g. references a file added only later - spot-check the riskiest).
Return the structured verdict; be exhaustive.`,
  { label: 'verify', phase: 'Verify', schema: VER })

return { status: 'complete', done, verify: v }