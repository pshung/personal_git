export const meta = {
  name: 'audit-profiling-gemm-27b',
  description: 'Independent third-party audit of profiling_gemm_27b.md: fairness of measurement and reproducibility, checked against raw logs, harness scripts and source',
  phases: [
    { title: 'Audit', detail: 'seven independent auditors, each a distinct lens, verifying against primary evidence' },
    { title: 'Refute', detail: 'adversarial verification of every finding' },
    { title: 'Synthesize', detail: 'single verdict report' },
  ],
}

const CWD = '/home/nick/work/llama.cpp'

const COMMON = `
You are an INDEPENDENT, IMPARTIAL THIRD-PARTY AUDITOR. You did not write the document
and you have no stake in its conclusions. Your client wants to know two things:

  (Q1) FAIRNESS: was the measurement process fair and unbiased? Is the comparison
       apples-to-apples, or is the "before" case handicapped / the "after" case flattered?
  (Q2) REPRODUCIBILITY: can a third party regenerate these results from what is on disk
       and what is documented?

Working directory: ${CWD}
Document under audit: ${CWD}/profiling_gemm_27b.md  (read it in full FIRST)

PRIMARY EVIDENCE available to you (use it - do not trust the document's own words):
  - ${CWD}/sweep-gemm-27b/*.log   48 raw run logs: {pristine,baseline,prefetch,d4}-k{48..59}.log
  - ${CWD}/sweep-gemm/*.log       4B prefill logs
  - ${CWD}/sweep-gemv/*.log       4B decode logs
  - ${CWD}/sweep.sh               the measurement harness (305 lines)
  - ${CWD}/verify.sh ${CWD}/measure.sh ${CWD}/check-prefetch.sh ${CWD}/check-vd4dots.sh
  - ${CWD}/ggml/src/ggml-cpu/     the kernel source (arch/riscv/repack.cpp, arch/riscv/quants.c, ggml-cpu.c)
  - git history (branch q1_0-rvv-opt), git log/show/diff
  - sibling docs: profiling_gemv_27b.md, opt_roadmap.md, q1_0_reproduce.md

A log line looks like:
  [roi] MUL_MAT #57 src0=blk.7.attn_v.weight [5120 x 1024] nrows=4
  [andesim] 1630251 cycles

HARD RULE - DO NOT RUN LONG SIMULATIONS. A single RTL leg can take up to 20 HOURS.
Never invoke the simulator, never run a full 'bash sweep.sh' sweep, never build the model.
You MAY run: reading files, grep/awk/sed, git commands, arithmetic (python3/awk),
and cheap re-derivation from logs already on disk (e.g. 'bash sweep.sh --md' which only
re-formats existing logs - check the script first to confirm it does not launch runs).

RULES OF EVIDENCE:
  - Every finding must cite the exact file/line/log/command that establishes it.
  - Quote the document's claim verbatim in claim_in_doc.
  - Report BOTH what checks out and what does not. An audit that only lists problems is
    as useless as one that only praises. Populate verified_ok generously.
  - Do not speculate. If you cannot verify something with the evidence at hand, mark it
    'unverifiable' and say precisely what evidence would be needed.
  - Severity: critical = a headline number is wrong or the comparison is rigged;
    major = a real methodological bias or a blocked reproduction;
    minor = imprecision that does not change a conclusion; info = an observation.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Two to four sentences: your overall read on this lens.' },
    verified_ok: {
      type: 'array',
      description: 'Claims you independently checked and found CORRECT, each with the evidence used.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['claim', 'evidence'],
      },
    },
    findings: {
      type: 'array',
      description: 'Problems, biases, gaps or unverifiable claims. Empty array is a legitimate answer.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'One line, specific.' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          kind: { type: 'string', enum: ['fairness', 'reproducibility', 'arithmetic', 'evidence-gap', 'transparency'] },
          claim_in_doc: { type: 'string', description: 'Verbatim quote from profiling_gemm_27b.md, or "N/A - omission".' },
          what_i_checked: { type: 'string', description: 'Exact commands/files/lines used.' },
          finding: { type: 'string', description: 'What is actually true, and why it differs.' },
          impact: { type: 'string', description: 'Does this change any headline number or conclusion? By how much?' },
        },
        required: ['title', 'severity', 'kind', 'claim_in_doc', 'what_i_checked', 'finding', 'impact'],
      },
    },
  },
  required: ['summary', 'verified_ok', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does not hold up' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string', description: 'What you re-checked, with commands/paths.' },
    corrected_statement: { type: 'string', description: 'If the finding is right but mis-stated, the accurate version. Else "".' },
    severity_should_be: { type: 'string', enum: ['critical', 'major', 'minor', 'info', 'drop'] },
  },
  required: ['refuted', 'confidence', 'reasoning', 'corrected_statement', 'severity_should_be'],
}

const LENSES = [
  {
    key: 'logs',
    title: 'Table-vs-raw-log reconciliation',
    prompt: `LENS 1 - DO THE PUBLISHED NUMBERS COME FROM THE LOGS?

Reconcile EVERY cycle count in profiling_gemm_27b.md against ${CWD}/sweep-gemm-27b/*.log.
Build a full 4-variant x 12-node table by extracting the '[andesim] N cycles' line and the
'[roi]' line from each of the 48 logs (script it - do not eyeball). Then check:
  1. Does every published cycle number appear in the matching log, exactly?
  2. Does every published 'ne0 x ne1' shape match the '[roi] src0=... [A x B]' line?
  3. Does every leg report nrows=4 (the document asserts "asserted per leg from the [roi] line")?
     Flag any leg that is not nrows=4, and any node whose tensor name does not match the label.
  4. Are there logs whose numbers were NOT published, or published numbers with NO log?
     Note that layer 7's ffn_* rows are declared "carried" from layer 6 - check whether
     k60/k61/k62 logs exist and, if they do, whether the carried numbers agree with them.
     If those logs exist and DISAGREE, that is a critical finding.
  5. Do any logs show errors, warnings, retries, truncation, or a different model/prompt?
     Check every log's system_info line and header for consistency (n_threads, model path,
     REPACK flag, RVV_VLEN, seed, prompt text). The document claims VLEN 1024 but a log
     may print 'RVV_VLEN = 128' - determine which is authoritative and whether the doc
     mis-states the machine. Look for how VLEN is actually set (sweep.sh, engine config).
  6. Cross-check sweep-gemm-27b.out / sweep-gemm-retry.out for reruns, failures or
     discarded legs - evidence of selective reporting.`,
  },
  {
    key: 'harness',
    title: 'Harness fairness - are the four builds a fair comparison?',
    prompt: `LENS 2 - IS THE A/B COMPARISON RIGGED?

Read ${CWD}/sweep.sh line by line, plus measure.sh, verify.sh, check-prefetch.sh,
check-vd4dots.sh, and any build script they call. Determine EXACTLY how the four builds
(pristine / baseline / prefetch / d4) differ. Then answer:
  1. Do they differ ONLY in the flags the document claims (GGML_CPU_REPACK,
     Q1_PREFETCH_DIST, GGML_RV_XANDESVDOT)? Diff the full cmake/compiler flag sets.
     Any difference in -O level, -march, LTO, NDEBUG, CMAKE_BUILD_TYPE, or thread count
     between pristine and d4 is a FAIRNESS DEFECT - report it as critical/major.
  2. Is 'pristine' a genuine upstream llama.cpp baseline, or a crippled build? Does turning
     GGML_CPU_REPACK=OFF disable other unrelated optimizations that upstream would have on?
     Check what else that flag gates. Is upstream's own RVV path still active in pristine?
  3. Same model file, same prompt, same seed, same n_threads=1, same context/batch, same
     engine config for all four legs? Anything that changes the work performed rather than
     the speed of it is a defect.
  4. Where is the ROI marker placed, and is it placed IDENTICALLY in all four builds? Find
     the marker code (grep for roi / ROI_K / andesim markers in ggml/src and common/). Does
     the bracket include the same work in every build - in particular, does the pristine
     bracket include work that the optimized bracket excludes (e.g. activation quantization,
     repack of weights done once outside the ROI)?  A one-time repack cost paid OUTSIDE the
     measured region while its benefit is counted INSIDE would be a major fairness defect.
     Establish clearly whether the repack conversion cost is amortized, excluded, or counted.
  5. Does the harness measure one iteration or many? Any warm-up? Any variance/repeat runs?
     Single-shot RTL is deterministic - confirm that claim is actually true for this engine
     (cycle-accurate + fixed seed) rather than assumed.
  6. Does anything in the harness pick the "best" of several runs, or retry until a number
     looks good? Read the retry/resume logic carefully.`,
  },
  {
    key: 'arith',
    title: 'Arithmetic and statistics audit',
    prompt: `LENS 3 - RECOMPUTE EVERY DERIVED NUMBER.

Do not trust a single ratio in the document. Recompute all of it with python3 from the
published cycle counts (and, where they differ, from the raw logs). Check:
  1. Every per-stage speedup in both "Per-stage speedup" tables (upstream/+repack,
     +repack/+prefetch, +prefetch/+vd4dots) and every 'total' column. Verify the stage
     ratios multiply to the total.
  2. Every LAYER total row (sum of the node cycles? or sum including ssm_alpha/beta?) and
     the weights column (ne0*ne1*... - check the weight counts are right for the shapes,
     and that the LAYER weights total matches the sum of its rows).
  3. Both geometric means: layer 6 "20.60x" over 6 nodes, layer 7 "17.65x" over 7 nodes.
     Recompute. Also check whether a geometric mean is the honest choice here versus a
     weighted (by cycles or by weights) mean - compute the cycle-weighted speedup for each
     layer and report how much smaller/larger it is. If geomean flatters the result, say so
     with the number.
  4. The 5-node head-to-head table (7.04x / 1.07x / 2.75x / 20.67x prefill and
     2.24x / 1.60x / 3.54x / 12.64x decode) - recompute from the same five nodes on both
     sides, pulling decode numbers from profiling_gemv_27b.md and/or sweep-gemv logs.
     Check the stage geomeans multiply to the stated total.
  5. The 10-node figures 6.62x / 1.06x / 2.58x = 18.15x, and decode's 12.20x.
  6. The absolute-cycles table: decode 2 tok 73,356,044 vs prefill 4 tok 45,434,691;
     "62% of the cycles" and "3.2x cheaper per token". Recompute both.
  7. The linear fits: 'cycles = F + T * tiles' for 4B, the F/T table for all three variants,
     "gemv residuals within 1.1%", "1.88x more efficient per token", "12.4x the per-call
     fixed cost", "F is 59% of 4B attn_v's total and only 12% of its ffn_gate", and
     "T collapses 3.5x (gemm) and 6.2x (gemv)". Refit from the 4B logs yourself
     (sweep-gemm/ and sweep-gemv/) and report the fit quality (R^2, residuals) and whether
     a 2-parameter fit over so few points is statistically defensible. State how many data
     points each fit had.
  8. Small stated percentages: "agree to 0.3%", "0.11% apart at upstream and 0.01% at d4",
     "0.12% of the layer's weights", "0.06% of the layer's weights but 2.7% of its optimized
     cycles", "agree to 2.4% at upstream", "1.97x to 2.01x for 2x the tokens" (check all 12
     nodes for that last one).
  Report every discrepancy with the correct value, and mark whether it changes a conclusion.`,
  },
  {
    key: 'source',
    title: 'Source-citation audit',
    prompt: `LENS 4 - DO THE CITED CODE LOCATIONS SAY WHAT THE DOCUMENT CLAIMS?

The document makes mechanistic claims anchored to exact source lines. Open each and judge
whether the code supports the claim. Note the document may have been written against a
slightly older tree - if a cited line number no longer points at the claimed code, find the
real location and report the drift (that is a reproducibility defect, severity minor/major
depending on whether the claim still holds).
  1. 'repack.cpp:4889' - the dispatch gate 'cur->ne[1] % 64 == 0'. Is that the real gate?
     Are there OTHER conditions in the same gate the document does not mention (type checks,
     ne0 alignment, nrows, backend checks) that would change which tensors are eligible?
  2. 'arch/riscv/repack.cpp:1967-1972' - "the gemm loads each weight vector once and fires
     four dots against it". Verify.
  3. 'repack.cpp:4456-4469' - activation quantization before the kernel, selected by token
     count. Verify the 4-token vs non-multiple-of-4 dispatch exactly as described.
  4. 'repack.cpp:51' - ggml_quantize_mat_q8_0_4x1_generic being a pure scalar loop with the
     '// scalar' comment; the 128 fabsf + 128 roundf per 32-column block claim.
  5. 'arch/riscv/quants.c:32' - quantize_row_q8_0 RVV-vectorized, gated only on __riscv_v.
  6. 'ggml-cpu.c:257' - '.nrows = 1' for Q1_0, hence "no prefill kernel upstream at all".
  7. The __riscv_zvfh gating of the vector quantizer twin and the claim that the measurement
     build sets -DGGML_RV_ZVFH=OFF - confirm the build actually sets it (check sweep.sh /
     build scripts, not just the prose).
  8. Is the central causal claim - that the ~490K fixed cost is the scalar activation
     quantizer - actually supported, or merely plausible? Was it ever measured directly
     (a profile, a counter, an ablation), or only inferred from a curve fit? Say which.
     If only inferred, that is an evidence gap worth reporting even though the story is good.`,
  },
  {
    key: 'repro',
    title: 'Reproducibility - can a third party regenerate this?',
    prompt: `LENS 5 - REPRODUCIBILITY, TESTED NOT ASSUMED.

Put yourself in the shoes of an outsider handed this repo. Test the documented path:
  1. Read sweep.sh and confirm what '--md' does. If (and only if) it merely re-formats logs
     already on disk without launching any simulation, RUN the three documented commands:
       MODEL=27b NODES="48 49 50 51 52 53 54 55" bash sweep.sh --md
       MODEL=27b NODES="56 57 58 59"             bash sweep.sh --md
       bash sweep.sh --md   and   MODE=gemv bash sweep.sh --md
     and DIFF the regenerated tables against the tables published in profiling_gemm_27b.md.
     Report any cell that differs. If --md would launch a run, do NOT run it - say so.
  2. Run 'bash sweep.sh --selfcheck' if and only if it is cheap (read it first). Report what
     it actually gates and whether it is a meaningful check or a tautology.
  3. Is the environment pinned? Engine version (vsim:ax46mpv_fpga_l3), toolchain version,
     llama.cpp commit, model file hash. Could someone else get the same numbers, or are
     there unpinned inputs? Check whether the doc/repro instructions name a commit; check
     'git log' and whether the working tree was dirty when the logs were produced (compare
     log mtimes to commit dates - 'ls --full-time', 'git log --format=%cd').
  4. Is the model file present and identified (name, size, hash)? Is it obtainable?
  5. Are the four builds reconstructible from what is documented? Find the actual build
     script/commands and check the doc gives enough to rebuild each variant.
  6. The document says layer 7 ffn_* rows are "carried" from layer 6 and that this is
     "sound". Is the carry documented well enough that a reader knows those three rows are
     NOT measurements of layer 7? Are they visually marked as inferred in the tables
     themselves, or only in prose? They feed the layer-7 geomean and the LAYER total -
     recompute layer 7's geomean WITHOUT the three carried rows and report the difference.
  7. Overall: grade reproducibility as (a) fully reproducible from disk, (b) tables
     reproducible but raw runs not, (c) not reproducible - and justify.`,
  },
  {
    key: 'bias',
    title: 'Selection bias, framing and omission',
    prompt: `LENS 6 - SELECTION BIAS, FRAMING, AND WHAT IS NOT SHOWN.

Adopt the posture of a skeptical reviewer looking for flattering framing. Examine:
  1. EXCLUSIONS. ssm_alpha/ssm_beta are dropped from "every average". Is the stated reason
     (the 64-row gate) legitimate, or is it excluding the optimization's own failure mode?
     Compute the layer-6 geomean and the cycle-weighted layer speedup WITH them included and
     report both numbers. Is the document's own Notes section honest about this? Weigh both
     sides and give a verdict on whether the exclusion is defensible.
  2. NODE SELECTION. Only 12 nodes / 2 layers are measured. Does the "measuring one of each
     covers the whole model" argument hold - are all SSM layers really identical in shape,
     and all attention layers? Verify against the model's actual architecture if you can
     (gguf metadata, the gemv doc, model config). What about non-MUL_MAT work, the LM head /
     output projection, embeddings, softmax, RoPE? Is a per-node speedup being presented in
     a way a reader could mistake for an end-to-end model speedup? Quote the exact wording
     and judge whether it invites that misreading. Prior work in this repo noted the LM head
     fails the rows%64 gate - check whether the doc discloses that here.
  3. NUMERATOR CHOICE. Speedups are vs 'pristine' upstream with .nrows=1 - i.e. upstream has
     no prefill kernel at all. Is comparing a 4-token gemm against an upstream that runs
     4 separate gemv passes a fair "speedup", or does it inflate the prefill numbers
     relative to decode? The doc's own head-to-head (20.67x prefill vs 12.64x decode) rests
     on this. Give a clear judgement with numbers.
  4. CORRECTNESS. Is there ANY evidence the four builds produce the same output? Search the
     harness and repo for bit-exactness / accuracy checks (verify.sh, check-*.sh, perplexity,
     test-backend-ops). A speedup with no correctness gate is not a result. Report what
     verification exists and what it covers, and whether the document mentions it at all.
     Note: prior work in this repo claims bit-exactness - check whether THIS document's
     builds were covered by such a check.
  5. LANGUAGE. Flag any sentence that overstates what was measured ("cycle-accurate RTL
     measurement", "nothing here is inferred except...", "the whole 12.4x fixed-cost gap",
     "the clearest remaining prefill win"). For each, say whether the evidence carries it.
  6. Compare against the sibling profiling_gemv_27b.md for consistency: same node names,
     same shapes, same pristine numbers where they should agree? Any number that appears in
     both docs with different values is a finding.`,
  },
  {
    key: 'engine',
    title: 'Simulation validity - does the model measure the machine?',
    prompt: `LENS 7 - IS THE MEASUREMENT INSTRUMENT SOUND?

The numbers are cycles from a simulator, not a real chip. Audit the instrument:
  1. Identify exactly what 'vsim:ax46mpv_fpga_l3' is and how cycles are counted. Find the
     engine config in the repo/scripts (grep for ax46mpv, fpga_l3, andesim, vsim, ROI,
     marker). Is it RTL, or an approximate/functional model? The doc says "cycle-accurate
     RTL measurement" - is that claim supported by what you can see, or is it the user's
     assertion? Look for the andesim invocation and any engine-selection flag.
  2. Does the stated configuration match what the runs used - VLEN 1024, 1 hart, 32 KB L1D,
     no L2, 2 MB L3? Reconcile with the 'RVV_VLEN = 128' that appears in run logs and
     determine which is real (llama.cpp may print a compile-time constant; look for how it
     is derived, e.g. ggml_cpu_get_sve_cnt / vlenb read, and for the engine's VLEN setting).
     If the doc's VLEN is wrong, that is a major finding since the whole kernel design and
     the 64-row tile depend on VLEN.
  3. The '--mem-size 12G' and DRAM/L3 model: is memory latency modelled at all, or ideal?
     If DRAM latency is idealized, the prefetch stage's 1.05-1.08x and the repack stage's
     gains would not transfer to hardware - assess and say so.
  4. Marker-mode ROI: does the ROI bracket count ONLY the matmul, and is the cycle counter
     read the same way in every build? Any chance the marker itself, or icache warm-up on
     the first call, is inside one build's bracket and not another's?
  5. Is the measured node the FIRST call of that node, or a steady-state call? Cold-cache
     first-touch would flatter or penalize particular stages (especially prefetch).
     Determine from the marker code and the logs (the prompt is "The capital of France" and
     the ROI line appears once - is that the first prefill batch?).
  6. Any known caveat in this repo about this engine (search opt_roadmap.md, q1_0_reproduce.md,
     other md files, git log) that the document should have disclosed but did not.`,
  },
]

phase('Audit')
log(`Auditing profiling_gemm_27b.md across ${LENSES.length} independent lenses`)

const REFUTE_LENSES = ['evidence', 'materiality']

const perLens = await pipeline(
  LENSES,
  (lens) => agent(`${COMMON}\n\n${lens.prompt}`, {
    label: `audit:${lens.key}`,
    phase: 'Audit',
    schema: FINDINGS_SCHEMA,
  }),
  (res, lens) => {
    if (!res) return null
    const fs = (res.findings || []).slice(0, 8)
    if (!fs.length) return { lens, summary: res.summary, verified_ok: res.verified_ok || [], findings: [] }
    return parallel(fs.map((f) => () =>
      parallel(REFUTE_LENSES.map((rl) => () =>
        agent(
          `${COMMON}\n\nYou are an ADVERSARIAL VERIFIER. Another auditor filed the finding below on\n` +
          `${CWD}/profiling_gemm_27b.md. Your job is to try to REFUTE it. Default to refuted=true\n` +
          `if you cannot independently reproduce the auditor's evidence.\n\n` +
          `LENS FOR YOUR CHECK: ${rl === 'evidence'
            ? 'EVIDENCE - re-run or re-derive the auditor\'s check yourself from the raw logs/source/scripts. Did they read the right file? Is the quote accurate? Is their arithmetic right? Did they miss context elsewhere in the repo that explains it away?'
            : 'MATERIALITY - grant the fact for argument\'s sake and ask: does it actually make the measurement unfair or irreproducible? Would fixing it change any headline number? If it is a cosmetic nit dressed up as a defect, refute it. If the auditor UNDERSTATED the severity, say so in corrected_statement.'}\n\n` +
          `FINDING\n` +
          `title: ${f.title}\nseverity: ${f.severity}\nkind: ${f.kind}\n` +
          `doc claim: ${f.claim_in_doc}\n` +
          `auditor checked: ${f.what_i_checked}\n` +
          `auditor concludes: ${f.finding}\n` +
          `claimed impact: ${f.impact}`,
          { label: `refute:${lens.key}/${rl}`, phase: 'Refute', schema: VERDICT_SCHEMA }
        )
      )).then((votes) => {
        const v = votes.filter(Boolean)
        const refuted = v.filter((x) => x.refuted).length
        return { ...f, votes: v, survives: v.length > 0 && refuted < v.length, refutedCount: refuted, voteCount: v.length }
      })
    )).then((verified) => ({
      lens,
      summary: res.summary,
      verified_ok: res.verified_ok || [],
      findings: verified.filter(Boolean),
    }))
  }
)

const lensResults = perLens.filter(Boolean)
const allFindings = lensResults.flatMap((r) => r.findings.map((f) => ({ ...f, lens: r.lens.key })))
const survivors = allFindings.filter((f) => f.survives)
const killed = allFindings.filter((f) => !f.survives)
log(`${allFindings.length} findings filed, ${survivors.length} survived adversarial verification, ${killed.length} refuted`)

phase('Synthesize')

const dossier = JSON.stringify({
  lens_summaries: lensResults.map((r) => ({ lens: r.lens.title, summary: r.summary })),
  verified_ok: lensResults.flatMap((r) => r.verified_ok.map((v) => ({ lens: r.lens.key, ...v }))),
  surviving_findings: survivors.map((f) => ({
    lens: f.lens, title: f.title, severity: f.severity, kind: f.kind,
    claim_in_doc: f.claim_in_doc, what_i_checked: f.what_i_checked,
    finding: f.finding, impact: f.impact,
    verifier_votes: f.votes.map((v) => ({ refuted: v.refuted, confidence: v.confidence, severity_should_be: v.severity_should_be, corrected: v.corrected_statement, reasoning: v.reasoning })),
  })),
  refuted_findings: killed.map((f) => ({ lens: f.lens, title: f.title, why_refuted: f.votes.map((v) => v.reasoning).join(' || ') })),
}, null, 1)

const report = await agent(
  `${COMMON}\n\nYou are the LEAD AUDITOR writing the final opinion. Seven auditors have filed\n` +
  `findings and every finding has been through adversarial verification by two independent\n` +
  `verifiers. The full dossier is below.\n\n` +
  `Write the audit opinion. Requirements:\n` +
  `  - Open with a one-paragraph VERDICT answering the client's two questions directly:\n` +
  `    is the measurement fair/unbiased, and is it reproducible? Be decisive. If it is\n` +
  `    largely sound, SAY SO plainly - do not manufacture doubt to look rigorous. If it is\n` +
  `    not, say that just as plainly.\n` +
  `  - Give two grades: FAIRNESS and REPRODUCIBILITY, each A-F with one line of justification.\n` +
  `  - "What we verified" - the concrete checks that passed, with numbers. This section must\n` +
  `    be substantive; it is the backbone of the opinion.\n` +
  `  - "Findings" ordered by severity. For each: the doc's claim, what is actually true, the\n` +
  `    evidence, and the impact on the headline numbers. Merge duplicates across lenses.\n` +
  `  - "Refuted / not upheld" - findings other auditors filed that did not survive scrutiny,\n` +
  `    one line each. Including these is part of being impartial.\n` +
  `  - "Recommendations" - the smallest set of changes that would close the gaps, ranked.\n` +
  `  - Be quantitative everywhere. No adjectives without a number behind them.\n` +
  `  - Before writing, SPOT-CHECK the two or three most consequential claims in the dossier\n` +
  `    yourself against the primary evidence. Do not simply relay what the auditors said.\n` +
  `  - Where auditors disagree, adjudicate and say which side you land on and why.\n` +
  `Return the opinion as markdown. It will be shown to the client verbatim.\n\n` +
  `DOSSIER\n${dossier}`,
  { label: 'lead-auditor', phase: 'Synthesize', effort: 'max' }
)

return {
  filed: allFindings.length,
  survived: survivors.length,
  refuted: killed.length,
  bySeverity: survivors.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {}),
  report,
}
