# Plan: Create `wiki-writer` Skill

## Context

The `/optimize` skill's `learn` phase writes to `docs/wiki/` but has no style guidance. Current wiki pages are jargon-heavy -- terms like GEMM, im2col, LMUL, vsetvli used without definitions. The user wants a skill that enforces "naive expression" -- plain language any engineer can understand, with examples that are clear to both humans and LLMs.

This skill is a prompt-only skill (SKILL.md read by the optimize agent during `learn`), not a standalone invocable skill.

## Files to Create (1)

### `.claude/skills/wiki-writer/SKILL.md` (~320 lines)

The skill has 6 sections:

**1. Frontmatter + Purpose (~20 lines)**
- Name, description (internal skill, called by /optimize learn)
- 3 core principles: define every acronym on first use, lead with plain-English summary, use concrete numbers not vague words

**2. Jargon Glossary (~35 lines)**
- Reference table mapping domain terms to plain-English expansions
- Terms: GEMM, im2col, LMUL, VL, VLEN, vsetvli, vd4dots, SEW, VLSU, IPC, VQ/VD/VC/VW, dual-issue, VREDSUM, tiling
- Internal reference only -- not written into pages verbatim, used to construct inline definitions

**3. Style Rules with Before/After Examples (~65 lines)**
- 3 concrete pairs showing jargon vs naive transformation:
  1. Technique description (vector utilization -- "256-seat bus with 32 passengers")
  2. Anti-pattern symptom (vd4dots small-K -- "conveyor belt running mostly empty")
  3. Pipeline insight (memory-bound IPC -- explain what the numbers actually mean)
- Rule: code comments must explain "what this does" not just "what instruction this is"

**4. Page Templates (~120 lines)**
- 4 templates matching SCHEMA.md page types:
  - `technique`: What This Does (Plain English), The Problem, The Fix, Results table, When to Apply, When NOT to Apply
  - `anti-pattern`: What This Is (Plain English), Why It Fails (with math), Evidence table, What to Do Instead
  - `pipeline-insight`: What This Means (Plain English), How to Detect, Impact on Optimization
  - `operator`: What This Function Does (Plain English), Current Approach, Optimization History table, Key Techniques, Current State
- Each template includes frontmatter matching SCHEMA.md conventions
- All templates require the "(Plain English)" section as the first content section

**5. Update Operations (~60 lines)**
- Operation 1: Update/create operator page
  - If exists: append history row, update frontmatter if improved, update "Current State"
  - If new: use operator template, derive slug from function name
- Operation 2: Create general page (conditional)
  - Only if new reusable pattern discovered
  - Check index.md for existing coverage first
  - Anti-patterns prefixed `anti-`
- Operation 3: Update index.md (conditional)
  - Only if Operation 2 created new page
  - Add wikilink under appropriate section, update Operator Profiles table
- Operation 4: Append to log.md
  - Under today's date heading, format: function, round, approach, result, lesson
  - Rewrite jargon using glossary

**6. Style Checklist (~20 lines)**
- Pre-write checklist: acronyms defined, plain-English section present, numbers concrete, analogies included, code commented, frontmatter valid, wikilinks correct

## Files to Modify (1)

### `.claude/skills/optimize/SKILL.md` (lines 442-447)

Replace the 5 inline wiki-update bullets with:

```
1. Update the wiki following the wiki-writer skill:
   - Read .claude/skills/wiki-writer/SKILL.md
   - Input context from state: function, source_file, round, optimization_level,
     hypothesis, changes, cycles_before, cycles_after, speedup, pipeline_insight, outcome
   - Execute all 4 operations: operator page, general page (if applicable), index, log
   - All content must follow the naive expression style defined in wiki-writer
```

Keep the rest of the learn step (lines 449-461) unchanged.

## Verification

1. Read the finished SKILL.md and confirm all 4 page templates match SCHEMA.md frontmatter
2. Verify the optimize SKILL.md learn step references wiki-writer correctly
3. Spot-check: mentally apply the skill to a real case (e.g., the conv_1x1 optimization) and confirm the template + style rules would produce an accessible page
