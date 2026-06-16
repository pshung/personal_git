export const meta = {
  name: 'repo-organize-audit',
  description: 'Audit design docs (keep/delete/archive) and verify all notebooks against the live build',
  phases: [
    { title: 'DocAudit', detail: 'one agent per design doc: classify status vs codebase' },
    { title: 'Notebooks', detail: 'one agent per notebook: execute against build, report cell health' },
  ],
}

const CONTEXT = `Repo: /home/nick/work/hybrid_sim - Andes hybrid RISC-V co-simulator (QEMU functional + vsim cycle-accurate, two-phase handoff QEMU1 -> vsim).
CANONICAL docs that are the source of truth and MUST be kept (do not recommend deleting these): CLAUDE.md, README.md, docs/USER_GUIDE.md (always-current user guide), docs/FRS.md, docs/MRD.md, ROADMAP.md (master FR tracker, "single source of truth"), driver/ROADMAP.md (C++ andes-sim driver tracker), docs/engine_interface.md, docs/andes_sim_limitations.ipynb (the L-id capability-gap envelope).
The other top-level *.md and a few docs/*.md are WORKING / DESIGN notes written while building features. Many describe features that are now DONE (merged into code + USER_GUIDE + ROADMAP), so the note is redundant scratch. Some may still hold open items not captured anywhere.
docs/archive/ already holds superseded docs (commercial_v1_roadmap.md, driver_ROADMAP.md, TODO.md).`

const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    doc: { type: 'string' },
    topic: { type: 'string', description: 'what feature/topic this doc covers, one line' },
    self_declared_status: { type: 'string', description: 'any status the doc itself states (e.g. DONE/SUPERSEDED/REMOVED), or "none"' },
    verified_status: { type: 'string', enum: ['done', 'partial', 'open', 'stale-superseded', 'canonical-keep', 'unknown'], description: 'verified against git log / ROADMAP / USER_GUIDE / actual code+tests' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'concrete proof: commit hashes, code files, USER_GUIDE section names, ROADMAP feature ids/status' },
    content_absorbed_in: { type: 'array', items: { type: 'string' }, description: 'where this docs info now lives (USER_GUIDE section / code file / ROADMAP entry); empty if nowhere' },
    open_items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      item: { type: 'string' },
      already_tracked_in: { type: 'string', description: 'ROADMAP feature id / limitations L-id if already captured, else "NOT-tracked"' },
      route: { type: 'string', enum: ['limitations-notebook', 'TODO', 'roadmap', 'already-tracked', 'none'] },
    }, required: ['item', 'already_tracked_in', 'route'] } },
    recommendation: { type: 'string', enum: ['keep', 'delete', 'archive', 'extract-then-delete'] },
    rationale: { type: 'string', description: '2-3 sentences tying recommendation to the evidence' },
  },
  required: ['doc', 'topic', 'self_declared_status', 'verified_status', 'evidence', 'content_absorbed_in', 'open_items', 'recommendation', 'rationale'],
}

const DOCS = [
  'andes_sim_runtime_lib.md', 'cosim_redesign.md', 'cosim_roi.md', 'f4_cleanup.md',
  'gemm_modes.md', 'hybrid_plan.md', 'kanata_roi.md', 'mmap_portability.md',
  'mode_consolidation.md', 'one_elf_three_engines.md', 'priv_modes.md',
  'project_hsim_cpp_rewrite.md', 'roi_markers.md', 'rvv_gemm_tutorial.md',
  'verify_oracle.md', 'vscratch_reservation.md',
  'docs/switching_modes_tutorial.md', 'docs/v_csr_plan.md', 'docs/vsim_semihosting_investigation.md',
]

const NB_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    notebook: { type: 'string' },
    executed: { type: 'boolean' },
    exec_method: { type: 'string' },
    total_cells: { type: 'integer' },
    code_cells: { type: 'integer' },
    failed_cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      cell_index: { type: 'integer' },
      ename: { type: 'string' },
      evalue: { type: 'string' },
      snippet: { type: 'string', description: 'first ~3 lines of the failing cell source' },
    }, required: ['cell_index', 'ename', 'evalue', 'snippet'] } },
    health: { type: 'string', enum: ['pass', 'partial', 'fail', 'not-executable'] },
    issues: { type: 'array', items: { type: 'string' } },
    fix_suggestions: { type: 'array', items: { type: 'string' } },
    runtime_seconds: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['notebook', 'executed', 'exec_method', 'total_cells', 'code_cells', 'failed_cells', 'health', 'issues', 'fix_suggestions'],
}

const NOTEBOOKS = [
  'docs/andes_sim_tutorial.ipynb', 'docs/andes_sim_demo.ipynb', 'docs/andes_sim_gemm_tutorial.ipynb',
  'docs/andes_sim_memory_tutorial.ipynb', 'docs/andes_sim_cosim_tutorial.ipynb',
  'docs/andes_sim_limitations.ipynb', 'docs/competition_landscape.ipynb',
]

const docPrompt = (d) => `${CONTEXT}

YOU ARE AUDITING ONE DOC (READ-ONLY - do not edit, move, or delete any file): \`${d}\`

Steps:
1. Read \`${d}\` fully. Note its topic and any status it self-declares (DONE/SUPERSEDED/REMOVED/etc).
2. VERIFY the real status against the codebase - do not trust the doc:
   - \`git log --oneline -- <relevant paths>\` and \`git log --oneline --all -S '<keyword>'\` for the feature it describes.
   - Search ROADMAP.md for the matching feature id / FR row and its Status (done/partial/not-started/REMOVED).
   - Search docs/USER_GUIDE.md for whether the feature is documented for users.
   - Search docs/andes_sim_limitations.ipynb for related L-ids.
   - Confirm the implementation + tests actually exist in the tree (grep code).
3. Decide verified_status: done (implemented, tested, in USER_GUIDE/ROADMAP) | partial | open | stale-superseded | canonical-keep | unknown.
4. List content_absorbed_in: where the doc's info now lives. If the feature is DONE and fully captured in code+USER_GUIDE+ROADMAP, the doc is redundant.
5. List open_items the doc still records, and for EACH say whether it is already_tracked_in ROADMAP (feature id) or limitations (L-id) or NOT-tracked, and the route (limitations-notebook / TODO / roadmap / already-tracked / none).
6. recommendation:
   - delete: feature DONE and fully absorbed; doc is pure redundant scratch with NO untracked open items.
   - extract-then-delete: doc has open items NOT tracked anywhere - they must be routed to limitations/TODO/roadmap first, then the doc can go.
   - archive: historical value (a removed-feature rationale, a superseded plan worth keeping for provenance) -> move to docs/archive/.
   - keep: still an active/canonical reference.
Be concrete in evidence (real commit hashes, file paths, section names). Return ONLY the structured object.`

const nbPrompt = (nb) => `Repo: /home/nick/work/hybrid_sim. The compiled driver is at build/andes-sim and all vsim engines are built. A python venv with nbconvert is at /tmp/nbenv (kernel name "nbenv", inherits system matplotlib).

YOUR JOB: execute the notebook \`${nb}\` end-to-end against the live build and report exactly which cells work and which fail. Do NOT edit the original notebook.

How to execute (run from repo root, capture ALL failures in one pass with --allow-errors):
  cd /home/nick/work/hybrid_sim
  out=/tmp/nbout_$(basename ${nb} .ipynb).ipynb
  timeout 580 /tmp/nbenv/bin/jupyter nbconvert --to notebook --execute --allow-errors \\
    --ExecutePreprocessor.kernel_name=nbenv --ExecutePreprocessor.timeout=420 \\
    --output "$out" ${nb} 2>&1 | tail -15

Then inspect the executed output notebook ($out) for cells whose outputs contain an error (output_type == "error"); for each, record the cell index, ename, evalue, and the first ~3 lines of that cell's source. Use python to parse the json (e.g. /tmp/nbenv/bin/python).

Notes / cautions:
- Some cells shell out to ./andes-sim or build/andes-sim and run cycle-accurate vsim - these are slow but should finish in minutes for the small fixtures used in tutorials. This host has 128 cores; if a single cell itself spawns the parallel e2e harness, that can saturate CPU - if you see such a cell, note it but it should still complete.
- If the whole nbconvert run hits the 580s timeout, report executed=false-ish (health=partial/fail) and identify the cell index it was stuck on (the last cell with no output in $out).
- A cell that intentionally demonstrates an error/limitation (the limitations notebook may do this) is NOT a failure if its output is the expected demonstrated message - judge by whether the cell's behavior matches the surrounding markdown's intent. Flag ambiguous ones in issues.
- Count total_cells and code_cells. Set health: pass (all code cells ran clean), partial (some failed but most work), fail (most/all fail or not executable), not-executable (missing kernel/deps unrelated to the notebook's own logic).
Return ONLY the structured object.`

log(`Auditing ${DOCS.length} design docs + verifying ${NOTEBOOKS.length} notebooks`)

const [docResults, nbResults] = await Promise.all([
  parallel(DOCS.map((d) => () => agent(docPrompt(d), { schema: DOC_SCHEMA, phase: 'DocAudit', label: `doc:${d}`, agentType: 'Explore' }))),
  parallel(NOTEBOOKS.map((nb) => () => agent(nbPrompt(nb), { schema: NB_SCHEMA, phase: 'Notebooks', label: `nb:${nb.replace('docs/', '')}` }))),
])

return {
  docs: docResults.filter(Boolean),
  notebooks: nbResults.filter(Boolean),
}
