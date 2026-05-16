---
name: spec-human
description: Create a human-reviewable architecture spec using a 6-section template (Summary, Background, Architecture, Interface, Edge Cases, Alternatives) BEFORE implementing a non-trivial design. Triggered explicitly via /spec-human <topic>, or when the user says "write a human spec", "create a review-ready design doc", "spec this out for review", or "I need a spec for X before we build it". Produces an ASCII markdown document at ./specs/<slug>.md aimed at peer engineers and tech leads who need to validate core architecture and trade-offs in 5 minutes. Do NOT auto-trigger on general design questions or coding tasks - this is a deliberate review gate that only fires on explicit request. For LLM-targeted specs (future sibling skill), use /spec-llm instead.
argument-hint: "<topic-or-slug>"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# /spec-human - Human-Reviewable Architecture Spec

## Purpose

Produce a spec a human reviewer can scan in 30 seconds, drill into in 5 minutes, and either approve or push back on with specific feedback. The audience is a peer engineer or tech lead validating the core architecture BEFORE any implementation begins.

A good spec surfaces decisions, not implementation details:
- What problem are we solving?
- Why this design?
- What could go wrong?
- What alternatives did we reject, and why?

The compound effect: each spec becomes a persistent design archive. Future engineers (and future-you) can answer "why is it built this way?" by reading the spec instead of guessing from code.

## When to Use

Trigger ONLY when the user:
- Types `/spec-human <topic>`
- Asks: "write a human spec", "create a review-ready design doc", "spec this out for review", "draft a spec before we build X"
- Wants architectural alignment BEFORE coding starts

Do NOT trigger on: general design questions, code reviews, implementation tasks, bug investigations, or refactoring requests that do not introduce new architecture. This skill is a deliberate gate, not a default behavior.

For specs targeting LLM consumption (denser, more structured, less narrative), the sibling skill is `/spec-llm`.

## Inputs

- `$ARGUMENTS` - the topic or slug. If empty, ask the user.
- Conversation context - any problem statement, code reviewed, constraints, or alternatives already discussed.

## Output

- File path: `./specs/<slug>.md` (relative to current working directory).
- Slug: kebab-case derived from the topic. See "Slug Generation" below.
- Format: ASCII-only markdown. No Unicode bullets, em dashes, smart quotes, or non-breaking spaces. ASCII diagrams (boxes drawn with `+`, `-`, `|`) are allowed and encouraged.
- If `./specs/` does not exist, create it.
- If the target file already exists, append a date suffix: `<slug>-YYYY-MM-DD.md`. Do not overwrite a prior spec.

## Workflow

### Step 1: Gather context

Before writing, decide what is known vs missing. Critical inputs:

- **Problem** - what is broken or insufficient today, with concrete evidence
- **Goal** - what should be true after this change
- **Constraints** - performance budgets, team size, deadline, compatibility requirements
- **Scope** - what is explicitly out of scope
- **Alternatives** - other approaches considered, and why each was rejected

Read recent conversation, any open files, and `./specs/` for related prior specs.

### Step 2: Ask before writing

If any of {problem, goal, scope, at least one alternative} is unclear from context, ASK the user 2-5 focused questions before drafting. Examples:

- "What is the trigger for this work - a bug, a new feature, or a performance regression?"
- "What is the explicit non-goal you want recorded so reviewers do not derail on it?"
- "Have you already ruled out approach X? If so, on what grounds?"
- "Who is the reviewer? Their seniority and domain knowledge shape how much background Section 2 needs."

Do not fabricate motivation. A spec with `TBD` markers is more useful than a spec with invented justification - the reviewer can fill the gaps; they cannot undo a wrong assumption that has been laundered as fact.

Skip Step 2 only when context is genuinely sufficient (the user has just spent 20+ messages laying out the problem).

### Step 3: Draft the 6 sections

Use the template below. Every section is mandatory. If a section has no real content yet, write:

```
TBD: <specifically what is missing and who needs to provide it>
```

A visible gap invites the reviewer to fill it; a silently-skipped section looks like the author did not think about it.

### Step 4: Save and present

1. Write to `./specs/<slug>.md`.
2. Print a 5-line summary to the chat:
   - File path
   - Problem (1 sentence from Section 2)
   - Proposed approach (1 sentence from Section 3)
   - Top alternative rejected (1 sentence from Section 6)
   - Open TBDs and unresolved questions
3. Tell the user: "Spec saved to `<path>`. Please review before I start implementing."

Do not start implementation until the user explicitly approves the spec.

## Spec Template

Use this exact structure. English in the body. Section headers keep the Chinese (original) followed by English in parentheses.

```markdown
# <Title>

> Status: Draft | Author: <name> | Date: <YYYY-MM-DD> | Reviewers: <names>

## 1. 摘要與目標 (Summary & Objective)

<Two to three sentences. State the problem and the expected end state.>

Goal of this section: a reviewer decides in 10 seconds whether to keep reading.

## 2. 背景與痛點 (Background & Problem Statement)

<Current state of the system. What is the bottleneck, failure mode, or gap?
Why is the existing mechanism insufficient? Include concrete evidence:
latency numbers, error rates, support tickets, past attempts that did not stick.>

Goal of this section: build consensus that the pain is real. If the reviewer
does not believe the pain exists, the rest of the spec is moot.

## 3. 架構設計與核心邏輯 (Architecture & Core Logic)

<The solution. Describe the new module's role in the overall system: what does
it depend on, what does it provide, where does it sit relative to existing
components? Include an ASCII block diagram of the high-level flow.>

```
+----------+      +-------------+      +----------+
|  Caller  | ---> |  NewModule  | ---> | Database |
+----------+      +-------------+      +----------+
                        |
                        v
                  +----------+
                  |  Logger  |
                  +----------+
```

<Then 2-4 paragraphs of core logic: the key algorithm, key invariants, key
state transitions. Stay at the "what and why" level. Implementation details
belong in the PR.>

Goal of this section: confirm coupling is reasonable and no existing
architectural principle is broken.

## 4. 介面與資料合約 (Interface & Data Contract)

<Conceptual inputs and outputs - NOT concrete API types or JSON field names.
Describe what data flows in and out at a logical level so upstream and
downstream engineers understand the module's boundary.>

Example shape (adapt to your domain):

- Input: a batch of user events, each carrying at minimum
  {user_id, event_type, timestamp}.
- Output: a per-user rolling aggregate keyed by user_id, with a 24h TTL.
- Invariants: aggregates are eventually consistent within 5 minutes; events
  with timestamps older than 7 days are dropped.

Goal of this section: define the module's boundary precisely enough that
upstream and downstream teams can build against it in parallel.

## 5. 邊界條件與例外處理 (Edge Cases & Error Handling)

<Enumerate abnormal cases and the strategy for each: crash, retry, default
value, log-and-skip, escalate to human, circuit-break?>

| Scenario | Likelihood | Strategy | Justification |
|----------|------------|----------|---------------|
| Upstream sends malformed payload | Medium | Reject + log + alert at 1% rate | We must not poison downstream state; alert is throttled to avoid pager fatigue |
| Database write times out | Low | Retry 3x with backoff, then dead-letter queue | Most timeouts are transient; DLQ preserves the event for manual replay |
| Two writers race on the same key | Low | Last-write-wins by timestamp | The aggregate is associative; ordering loss is acceptable |

Goal of this section: surface logic holes. This is the most common place
for reviewer pushback - if it is thin, the reviewer will assume you did
not stress-test the design.

## 6. 替代方案與權衡 (Alternatives Considered & Trade-offs)

<List 2-3 other approaches seriously considered. For each, state the trade-off
honestly and explain why the chosen design wins. Typical trade-off axes:
performance vs build cost, complexity vs flexibility, time-to-market vs
maintainability, vendor lock-in vs feature richness.>

### Alternative A: <name>
- Approach: <one-paragraph description>
- Pros: <what it would have given us>
- Cons: <what it would have cost>
- Why rejected: <the deciding factor>

### Alternative B: <name>
- Approach: <...>
- Pros: <...>
- Cons: <...>
- Why rejected: <...>

Goal of this section: defensive writing. When a reviewer asks "why not XXX?",
the answer is already on the page. Shows the design is deliberate, not the
first idea that fit.

## Open Questions / TBD

- [ ] <question 1 - who needs to answer it, by when>
- [ ] <question 2>
```

## Style Rules

- **ASCII only.** No Unicode bullets, em dashes, smart quotes, ellipsis character, or non-breaking spaces. Use hyphens, straight quotes, three plain dots.
- **Concrete over abstract.** "p99 latency is 850ms, target <200ms" beats "performance is poor". "Three customer escalations in Q1" beats "users complain".
- **Decisions over descriptions.** Section 6 records a choice, not a survey. Alternatives must be ones a reasonable engineer might genuinely propose - no strawmen.
- **Mark gaps explicitly.** "TBD: need benchmark data from infra team" is more useful than silence or invention.
- **One section, roughly one screen.** If a section runs longer than ~50 lines of prose, split or link to an appendix file.
- **No code dumps.** A spec is for design, not implementation. Short pseudocode for clarification is fine; full implementations belong in the PR.
- **Reviewer-first ordering.** Section 1 must answer "should I keep reading?" without scrolling.

## Anti-Patterns

The skill should actively avoid these failure modes:

- **Justification spec.** Section 6 lists strawman alternatives that exist only to make the chosen design look better. A reviewer can smell this in 30 seconds and will lose trust in the rest of the doc.
- **Padded background.** Section 2 reads like a Wikipedia entry on the domain. If the reviewer already knows the domain, two sentences of context is plenty.
- **API field names in Section 4.** That is a code contract, not an architecture spec. The reviewer should be able to evaluate the boundary without knowing the implementation language.
- **Missing diagram in Section 3.** Reviewers process visuals roughly 5x faster than prose. If a system has more than one moving part, draw it.
- **Empty Section 5.** Every non-trivial system has failure modes. If fewer than three are listed, either the system is too simple to need a spec, or the author has not thought hard enough.
- **Inventing motivation.** If the user has not stated why the work matters, ASK. Never make up a problem statement to fill Section 2.

## Slug Generation

Derive `<slug>` from the topic argument:

1. Lowercase the input.
2. Replace whitespace and underscores with hyphens.
3. Strip non-alphanumeric characters except hyphens.
4. Collapse repeated hyphens to one.
5. Trim leading and trailing hyphens.

Examples:
- Input: `Async Job Queue` -> `async-job-queue`
- Input: `Auth/Session Rewrite (v2)` -> `auth-session-rewrite-v2`
- Input: `iree__tile_size__tuner` -> `iree-tile-size-tuner`

If `./specs/<slug>.md` already exists, use `./specs/<slug>-YYYY-MM-DD.md` (current date) instead. Never silently overwrite a prior spec - prior specs are review artifacts.

## Reviewer Checklist (Include at the End of Every Spec)

At the bottom of the generated spec, append this checklist for the human reviewer to use while reading:

```markdown
---

## Reviewer Checklist

Use this while reading. If any item is "no", leave a comment in the relevant section.

- [ ] Section 1: I understood the scope and goal in under 30 seconds.
- [ ] Section 2: I agree the problem is real and worth solving now.
- [ ] Section 3: I can draw the data flow on a whiteboard from memory after reading.
- [ ] Section 3: Coupling to existing modules is justified, not incidental.
- [ ] Section 4: The boundary is clear enough that I could implement either side independently.
- [ ] Section 5: At least one failure mode I would have raised is already addressed.
- [ ] Section 6: At least one alternative I would have asked about is already covered.
- [ ] Section 6: The trade-off framing matches reality - no strawmen.
- [ ] Open Questions: every TBD has an owner.
```

This checklist is part of the deliverable. It tells the reviewer how to review and turns vague approval into specific sign-off.
