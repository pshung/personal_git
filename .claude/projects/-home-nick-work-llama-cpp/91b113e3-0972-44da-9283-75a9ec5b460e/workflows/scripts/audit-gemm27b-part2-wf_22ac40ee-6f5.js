export const meta = {
  name: 'audit-gemm27b-part2',
  description: 'Complete the profiling_gemm_27b.md audit: the four lenses lost to the session limit, plus adversarial verification of the contested claims from the salvaged lenses',
  phases: [
    { title: 'Lenses', detail: 'harness fairness, arithmetic, selection bias, simulator validity' },
    { title: 'Contested', detail: 'adversarial checks on claims the salvaged auditors disagreed about or asserted without a second pair of eyes' },
  ],
}

const CWD = '/home/nick/work/llama.cpp'

const COMMON = `
You are an INDEPENDENT, IMPARTIAL THIRD-PARTY AUDITOR. You did not write the document
and have no stake in its conclusions. The client asks two questions:
  (Q1) FAIRNESS: was the measurement fair and unbiased, or is the "before" handicapped /
       the "after" flattered?
  (Q2) REPRODUCIBILITY: can a third party regenerate these results?

Working directory: ${CWD}
Document under audit: ${CWD}/profiling_gemm_27b.md  (read it in full FIRST)

PRIMARY EVIDENCE:
  ${CWD}/sweep-gemm-27b/*.log   48 raw logs: {pristine,baseline,prefetch,d4}-k{48..59}.log
  ${CWD}/sweep-gemm/*.log       4B prefill;  ${CWD}/sweep-gemv/*.log  4B decode
  ${CWD}/sweep.sh  ${CWD}/build.sh  ${CWD}/measure.sh  ${CWD}/verify.sh
  ${CWD}/check-prefetch.sh  ${CWD}/check-vd4dots.sh
  ${CWD}/ggml/src/ggml-cpu/  (arch/riscv/repack.cpp, arch/riscv/quants.c, ggml-cpu.c, roi.h)
  git history on branch q1_0-rvv-opt; sibling docs profiling_gemv_27b.md, opt_roadmap.md,
  q1_0_reproduce.md, q1_0_layout_rvv_vs_vd4dot.md
  ${CWD}/bin-* and ${CWD}/b-* are the built binaries / build trees.
  ${CWD}/../andesim is the simulator driver (ANDESIM=/home/nick/work/andesim).

Log format:
  [roi] MUL_MAT #57 src0=blk.7.attn_v.weight [5120 x 1024] nrows=4
  [andesim] 1630251 cycles

HARD RULE - DO NOT RUN LONG SIMULATIONS. One RTL leg can take 20 HOURS. Never invoke the
simulator, never run a full 'bash sweep.sh' sweep, never rebuild. You MAY read files, grep,
git, run python3/awk arithmetic, run 'bash sweep.sh --md' (verify from the script first that
it only re-formats existing logs), inspect binaries with readelf/objdump/strings/nm/cmp/md5sum.

ALREADY ESTABLISHED by the lead auditor - treat as given, do not re-derive:
  - All 48 published 27B cycle counts match the logs exactly; every leg is nrows=4; every
    tensor name matches its label.
  - Layer 6's LAYER row and both geomeans (20.60x, 17.65x), the 5-node column
    (7.04/1.07/2.75/20.67), the 10-node column (6.62/1.06/2.58/18.15) all reproduce exactly.
  - Layer 7's LAYER row is WRONG in two cells: +repack published 241,152,929 vs true
    195,052,238 (+23.6%); +prefetch published 225,336,152 vs true 182,336,759 (+23.6%).
    The upstream and +vd4dots cells of that row are correct.
  - Layer 7's geomean over only the 4 MEASURED nodes is 15.02x, vs 17.65x published with the
    3 carried rows included.
  - build.sh gives all four variants an identical cmake configuration (Release, -static,
    GGML_RV_MARCH_LETTERS=g, ZFH=OFF, ZVFH=OFF, ZICBOP=ON, OPENMP=OFF, NATIVE=OFF); only
    GGML_CPU_REPACK / Q1_PREFETCH_DIST / GGML_RV_XANDESVDOT differ.
  - The ROI bracket (ggml-cpu.c:1744-1790, 1913) opens before the extra-buffer dispatch and
    closes after the compute in BOTH paths, so both count their own activation quantization.
  - ssm_alpha+ssm_beta are 0.128% of layer 6's weights (the doc's Notes says 0.06%, wrong by
    2x; the earlier 0.12% is right) and 2.74% of its d4 cycles. ssm_alpha's four builds
    agree to 0.30% but ssm_beta's to 0.46%, so "within 0.3%" is slightly overstated.

RULES OF EVIDENCE:
  - Cite the exact file/line/log/command behind every finding. Quote the doc verbatim.
  - Report what CHECKS OUT as well as what does not. Populate verified_ok generously.
  - No speculation. If you cannot verify, mark it unverifiable and name the missing evidence.
  - Severity: critical = a headline number is wrong or the comparison is rigged; major = a
    real bias or a blocked reproduction; minor = imprecision that changes no conclusion;
    info = observation.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Three to five sentences: your verdict on this lens, with numbers.' },
    verified_ok: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { claim: { type: 'string' }, evidence: { type: 'string' } },
        required: ['claim', 'evidence'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          kind: { type: 'string', enum: ['fairness', 'reproducibility', 'arithmetic', 'evidence-gap', 'transparency'] },
          claim_in_doc: { type: 'string' },
          what_i_checked: { type: 'string' },
          finding: { type: 'string' },
          impact: { type: 'string', description: 'Does it change a headline number? By how much?' },
          fix: { type: 'string', description: 'The smallest concrete edit or extra measurement that would close it.' },
        },
        required: ['title', 'severity', 'kind', 'claim_in_doc', 'what_i_checked', 'finding', 'impact', 'fix'],
      },
    },
  },
  required: ['summary', 'verified_ok', 'findings'],
}

const LENSES = [
  {
    key: 'harness',
    prompt: `LENS: HARNESS FAIRNESS - IS THE A/B RIGGED?

build.sh flag parity and ROI placement are already established (see above). Go past them:
  1. THE ONE-TIME REPACK COST. The repacked weight layout is produced once, outside the
     measured ROI (find where - extra_buffer_type from_float / init_tensor / set_tensor in
     ggml/src/ggml-cpu/repack.cpp and ggml-backend). Confirm exactly where and when the
     conversion happens, whether ANY of it lands inside the ROI, and how large it is
     relative to one matmul. Then judge: is excluding an amortized one-time load-time cost
     legitimate (upstream llama.cpp does the same for its own repack types - verify that),
     or does the document owe the reader a disclosure? Give a verdict with a number.
  2. THE ACTIVATION-QUANTIZER ASYMMETRY. A salvaged auditor claims pristine and the repack
     builds do NOT run the same activation-quantization code: pristine goes through
     ggml_compute_forward_mul_mat's from_float (vectorized quantize_row_q8_0), while the
     repack path at repack.cpp:4456-4469 uses ggml_quantize_mat_t / the scalar 4x1 routine.
     Verify this from source. Then answer the fairness question BOTH ways: does it flatter
     the optimized build or handicap it? Quantify: roughly what fraction of each build's
     measured cycles is activation quantization, and would fixing it raise or lower the
     published speedups?
  3. A second salvaged auditor claims 'there is no RISC-V vector twin of the 4x1 quantizer
     at all - ggml/src/ggml-cpu/arch-fallback.h:221 aliases the generic scalar routine to
     the arch name, so both arms of the #if at repack.cpp:347 call the same scalar function,
     and GGML_RV_ZVFH=ON would change nothing.' Verify or refute this precisely, quoting the
     lines. If true, the document's sentence 'Its vector twin is gated behind __riscv_zvfh,
     and the measurement build sets -DGGML_RV_ZVFH=OFF' is factually wrong and its
     recommendation ('vectorizing it is the clearest remaining prefill win') rests on a
     misdiagnosis of WHY it is scalar. Say which.
  4. Does 'GGML_CPU_REPACK=OFF' disable anything OTHER than the Q1_0 repack that upstream
     would have had ON? Check what else that option gates for this build (other repack
     types, aarch64 kernels, llamafile sgemm). Confirm or refute that pristine == upstream
     default behaviour FOR THESE Q1_0 NODES.
  5. Read sweep.sh's resume/retry logic and sweep-gemm-27b.out / sweep-gemm-retry.out. Any
     evidence of legs re-run until they looked good, or of a leg's result being replaced?
  6. Is there anything in the harness that could make the pristine leg slower for a reason
     unrelated to the kernel (different binary layout, different ROI node index, icache,
     the ANDESIM_ROI_CLEAR_DPREF knob accidentally on)? Check the actual binaries in
     ${CWD}/bin-* with readelf/strings where useful.`,
  },
  {
    key: 'arith',
    prompt: `LENS: ARITHMETIC AND STATISTICS - RECOMPUTE WHAT IS LEFT.

The per-node ratios, both geomeans, the 5-node and 10-node columns and the layer-6 LAYER
row are already confirmed correct; the layer-7 LAYER row is already confirmed wrong by
23.6% in two cells. Do NOT re-derive those. Focus on:
  1. THE WEIGHTS COLUMN. Verify every 'weights' cell equals ne0*ne1 and that both LAYER
     weights totals are right. Note the doc labels the column 'weights' while the cells are
     element counts, and the model is 1.125 bits/weight - is any figure in the doc derived
     from this column in a way that mixes elements with bytes? Check the '3.80 GB' and
     '1.125 bits/weight' setup claims against the actual gguf if present
     (ls -l ${CWD}/models/, gguf metadata if a reader tool exists) - is 3.80 GB consistent
     with 27B params at 1.125 bits?
  2. MEAN CHOICE. For each layer compute BOTH the geometric mean of per-node speedups and
     the cycle-weighted speedup (sum of upstream cycles / sum of optimized cycles), with and
     without ssm_alpha/ssm_beta, and for layer 7 with and without the 3 carried rows. Present
     a small table. State plainly whether the geometric mean flatters or understates the
     result versus the weighted mean, and by how much. Do the same for the 5-node and 10-node
     head-to-head columns, and for the decode side using profiling_gemv_27b.md's numbers.
  3. THE 4B FITS. Refit 'cycles = F + T*tiles' yourself from ${CWD}/sweep-gemm/ and
     ${CWD}/sweep-gemv/ logs for all six (variant x path) pairs. Report for each: the number
     of data points, the fitted F and T, R^2, and the max residual. Then judge every claim
     built on the fits: 'gemv residuals within 1.1%', 'F = 489,581', '12.4x the per-call
     fixed cost', '1.88x more efficient per token', 'F is 59% of 4B attn_v's total and only
     12% of its ffn_gate', 'T collapses 3.5x (gemm) and 6.2x (gemv)', 'F stays put'. For
     'F stays put', note the gemv F column goes 13,379 -> 27,294 -> 39,491 (a 3x rise) and
     say whether the sentence is defensible. Give the honest uncertainty on F: with N points,
     what is the confidence interval, and does 'at ~490K cycles per node it is the largest
     single item in a small prefill matmul - bigger than the kernel it feeds' survive it?
  4. Is the 12.4x fixed-cost gap a like-for-like comparison? gemm F is measured at 4 tokens
     and gemv F at 2 tokens. If F scales with token count, part of 12.4x is just 2x more
     tokens. Compute the per-token fixed cost for both and report what is left of the gap.
  5. Any other arithmetic in the document not covered above - check it all, including every
     percentage in the prose and the Notes section.`,
  },
  {
    key: 'bias',
    prompt: `LENS: SELECTION BIAS, FRAMING AND OMISSION.

  1. EXCLUSIONS. ssm_alpha/ssm_beta are dropped from every average. Compute layer 6's
     cycle-weighted speedup with and without them and report both. Judge whether the
     exclusion is defensible given the doc's own Notes section discloses it. Be fair: state
     the case for AND against, then decide.
  2. SCOPE FRAMING - THE BIGGEST RISK. These are PER-NODE matmul speedups inside an ROI, not
     an end-to-end model speedup. Quote every sentence a reader could mistake for end-to-end.
     Then estimate what the honest end-to-end prefill number would be: MUL_MAT is not all of
     a prefill pass. Using the measured nodes, the layer mix (48 SSM + 16 attention), and
     whatever you can establish about non-MUL_MAT work and the LM head / output projection,
     bound the whole-model speedup from above (Amdahl). The repo's prior work notes the LM
     head fails the rows%64 gate - verify whether the 27B LM head (result_output /
     output.weight) passes or fails it, how many weights it holds, and whether the document
     discloses this. This is the single most important thing for a reader to know and the
     doc does not appear to address it. Give a number.
  3. NUMERATOR CHOICE. Speedups are vs upstream with .nrows=1, i.e. upstream has NO prefill
     kernel - it runs 4 separate gemv passes. Is '20.67x prefill vs 12.64x decode' therefore
     a comparison of the optimization, or partly a comparison of upstream's own weakness on
     prefill? Compute what the prefill speedup would be against a hypothetical upstream that
     had M-tile sharing, using the doc's own 'upstream is exactly linear in tokens' finding.
     Judge whether the document's framing ('Prefill takes its win from the layout') is
     supported or is an artifact of the baseline.
  4. CORRECTNESS GATE. Search the whole repo for evidence the four builds produce the SAME
     output: verify.sh, check-prefetch.sh, check-vd4dots.sh, tests/, test-backend-ops,
     perplexity, any bit-exactness claim in opt_roadmap.md or git log. Report exactly what is
     verified, on which model and which shapes, and whether the 27B d4 build specifically was
     ever checked. Then state whether profiling_gemm_27b.md mentions correctness AT ALL. A
     speedup with no correctness gate is not a result - say how strong the gate actually is.
     Also check the logs themselves: all 48 runs used the prompt 'The capital of France' with
     -n 32; do the generated continuations differ between pristine and d4? If the logs
     contain the generated text, DIFF IT - that is a free end-to-end output check and either
     confirms or breaks bit-exactness. Report what you find.
  5. LANGUAGE. Flag every sentence that overstates: 'Every figure is a cycle-accurate RTL
     measurement of one MUL_MAT node; nothing here is inferred except layer 7's three ffn_*
     rows', 'That is the whole 12.4x fixed-cost gap', 'the clearest remaining prefill win',
     'The carry is sound', 'measuring one of each covers the whole model'. For each, say
     whether the evidence carries it. On 'nothing here is inferred except...', note the doc
     ALSO carries the entire 27B decode column from a sibling doc with no logs on disk - is
     that disclosed?
  6. CROSS-DOC CONSISTENCY. Compare every shared number with profiling_gemv_27b.md: node
     names, shapes, per-node decode speedups, the layer figures 12.53x/12.17x/12.20x/12.64x.
     Any number appearing in both docs with different values is a finding. Also check whether
     profiling_gemv_27b.md marks its carried rows with a 'source' column while this doc does
     not.`,
  },
  {
    key: 'engine',
    prompt: `LENS: IS THE MEASURING INSTRUMENT SOUND?

  1. VLEN. Every log prints 'RVV_VLEN = 128' yet the doc's Setup says VLEN 1024. One
     salvaged auditor says the doc is right and the log line is a compile-time constant;
     another flagged it as merely 'info'. SETTLE IT with primary evidence: find where
     llama.cpp prints RVV_VLEN (grep the source), find where the engine's VLEN is configured
     (${CWD}/../andesim, the engine name vsim:ax46mpv_fpga_l3, any engine config file or
     andesim --help), and find any runtime evidence in the logs or binaries (a vlenb read,
     __riscv_vlenb, ggml_cpu_get_sve_cnt equivalent). If VLEN were actually 128 the whole
     64-row-per-vector-lane kernel design would be impossible - use that as a consistency
     check but do not treat it as proof. State the answer with the evidence.
  2. Is 'cycle-accurate RTL measurement' true? Determine what vsim:ax46mpv_fpga_l3 actually
     is - RTL, an FPGA image, or a performance model - from andesim's own docs/help/config.
     Report what is claimed by the tool versus what the document asserts. If it cannot be
     established from what is on disk, say so - that is an evidence gap, not a defect.
  3. Does the stated config (VLEN 1024, 1 hart, 32 KB L1D, no L2, 2 MB L3) match what the
     runs used? Find where those parameters live. Is DRAM/L3 latency modelled or idealised?
     If idealised, the +prefetch stage (1.05-1.08x) and part of +repack would not transfer to
     silicon - assess and say so.
  4. COLD vs STEADY STATE. The ROI brackets ONE call of node #K. Is it the first execution of
     that node in the process, or a later one? Read ggml-cpu.c:1744-1790 (the static counter
     is never reset) and the run shape (-n 32, --no-warmup, 4-token prompt) to determine
     exactly which call is measured. Then judge: does measuring a single cold-ish call
     systematically favour or penalise any of the four variants - especially +prefetch, and
     especially the d4 build whose kernel is longer code (icache)? This is the most likely
     hidden bias in the whole setup. Quantify if you can; if not, state the direction and the
     magnitude you would expect.
  5. DETERMINISM. sweep.sh's header claims 'the cycle figure comes from a cycle-accurate RTL
     model, so host load cannot move it', and --selfcheck is advertised as proving it. Read
     the selfcheck function. Does it actually re-run anything, or just compare a file to a
     stored constant? A salvaged auditor claims it is a file comparison with a tolerance 20x
     the observed noise floor, and that the only repeat measurement available shows ~0.6%
     spread. Verify both claims. If run-to-run spread is ~0.6%, does that threaten any
     conclusion? (Compare against the effect sizes: +prefetch is only 1.05-1.08x = 5-8%.)
  6. Any caveat about this engine recorded elsewhere in the repo (opt_roadmap.md,
     q1_0_reproduce.md, other md files, git log) that this document should have disclosed?`,
  },
]

phase('Lenses')
const lensResults = await parallel(LENSES.map((l) => () =>
  agent(`${COMMON}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDINGS_SCHEMA })
    .then((r) => (r ? { key: l.key, ...r } : null))
))

const CONTESTED = [
  {
    key: 'decode-provenance',
    q: `The 27B DECODE column. profiling_gemm_27b.md compares prefill against 27B decode numbers
(2.24x / 1.60x / 3.54x / 12.64x; per-node 12.03x, 11.86x ... ; 'decode 2 tokens 73,356,044
cycles'). There is NO sweep-gemv-27b/ directory. Establish where those numbers actually come
from: read profiling_gemv_27b.md, search the whole repo and git history for the raw logs or
any file containing 73,356,044 and the other decode cycle counts (grep -r across the repo and
'git log -S'), check for other sweep output directories, .out files, or deleted paths. Then
answer: (a) can a third party reproduce the decode half at all, (b) does profiling_gemm_27b.md
disclose that its decode column is carried from elsewhere, (c) are the decode numbers at least
internally consistent with profiling_gemv_27b.md? Be precise about what exists and what does
not.`,
  },
  {
    key: 'binary-provenance',
    q: `A salvaged auditor claims 'one of the twelve d4 binaries is provably a different build
from the other eleven'. Verify or refute. Inspect ${CWD}/bin-d4* and ${CWD}/b-d4*: file sizes,
mtimes, build-id (readelf -n), .comment section, embedded strings, and the CMakeCache.txt of
each b-d4* tree (compare the flag sets). Do the same spot-check across bin-pristine*,
bin-baseline*, bin-prefetch* - are all 48 binaries mutually consistent within their variant?
Then judge the IMPACT: if one d4 binary differs, which published number does it produce, and
is that number an outlier in the table? Also compare each binary's mtime against its log's
mtime to confirm each log was produced by the binary that is still on disk. State clearly
whether any published figure is actually suspect, or whether the difference is benign
(e.g. only ROI_K, or a rebuild with identical flags).`,
  },
  {
    key: 'output-diff',
    q: `FREE END-TO-END CORRECTNESS CHECK. All 48 runs used the same prompt ('The capital of
France' for gemm) with -n 32 and a printed sampler seed. If the logs contain generated text,
extract the continuation from every log and compare pristine vs baseline vs prefetch vs d4 for
the SAME node index. Identical text across variants is strong evidence the optimization is
output-preserving; differing text is a red flag that must be reported. Do the same for
${CWD}/sweep-gemv/ and ${CWD}/sweep-gemm/ (4B). Report exactly what the logs contain, whether
the seed is identical across legs (grep 'sampler seed'), and what the comparison shows. If the
runs were truncated by the ROI or the text is absent, say so - do not invent a result. Also
report whether the sampler seed differs between legs, because a differing seed would make the
text comparison meaningless and that itself is worth knowing.`,
  },
  {
    key: 'lmhead-amdahl',
    q: `WHAT IS THE HONEST WHOLE-MODEL NUMBER? profiling_gemm_27b.md reports per-node speedups
up to 22.44x and layer geomeans of 20.60x / 17.65x, but never states an end-to-end prefill
speedup. Build the bound yourself:
 (a) Enumerate the Bonsai-27B MUL_MAT nodes per layer from the doc and profiling_gemv_27b.md
     (48 SSM layers of the layer-6 shape set, 16 attention layers of the layer-7 set), plus
     the LM head / output projection. Find the LM head's shape (vocab x 5120) - check the
     model, the gguf, q1_0_* docs, or the repo's prior notes - and determine whether its row
     count passes the repack gate 'ne[1] % 64 == 0'.
 (b) Compute the model-wide MUL_MAT cycle total at 'pristine' and at 'd4' by weighting each
     measured node by how many layers use it, INCLUDING ssm_alpha/ssm_beta at 1.00x and the
     LM head at whatever its gate outcome implies. Report the resulting whole-model MUL_MAT
     speedup and compare it to the headline 18.15x / 20.60x.
 (c) State clearly how much of the gap is (i) the un-repacked ssm tensors, (ii) the LM head,
     (iii) the choice of geometric over cycle-weighted mean.
 (d) Note explicitly that this still excludes all non-MUL_MAT work, so it is an upper bound.
This is the number a reader most needs and the document does not give it. Be careful and show
your arithmetic.`,
  },
]

phase('Contested')
const contested = await parallel(CONTESTED.map((c) => () =>
  agent(`${COMMON}\n\nTARGETED VERIFICATION TASK\n\n${c.q}\n\nReport as findings + verified_ok.`,
    { label: `check:${c.key}`, phase: 'Contested', schema: FINDINGS_SCHEMA })
    .then((r) => (r ? { key: c.key, ...r } : null))
))

return {
  lenses: lensResults.filter(Boolean),
  contested: contested.filter(Boolean),
}
