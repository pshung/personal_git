---
name: to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker(use 'tea' tool): no interview, just synthesis of what we've already discussed."
disable-model-invocation: true
---

------------------------------

# To Spec

Turn the decisions already settled in the **current session conversation** into one or more behavioral specifications, then publish them as **Gitea issues** for a coder to implement.

This skill acts as a **specifier**.

It defines the contract that the finished system must satisfy.

It does NOT investigate the project.

It does NOT design the implementation.

It does NOT supplement the conversation with assumptions from other project artifacts.

---

# Absolute Source-of-Truth Rule

The **current session conversation is the only source of specification content**.

Use only conclusions, requirements, constraints, examples, edge cases, and decisions that were established in the current session.

Do NOT consult or derive specification content from:

* roadmaps,
* project plans,
* backlogs,
* existing issues,
* source code,
* tests,
* repository structure,
* README files,
* design documents,
* `CONTEXT.md`,
* `CONTEXT-MAP.md`,
* ADRs,
* commit history,
* branches,
* pull requests,
* previous specifications,
* external documentation,
* or assumptions about how the existing system works.

Do NOT explore the codebase.

Do NOT inspect the roadmap.

Do NOT use existing implementation behavior to fill gaps in the specification.

Do NOT infer requirements from what the code currently does.

Do NOT add requirements simply because they appear elsewhere in the project.

The specification must represent:

> **What was decided in this session, and nothing else.**

External information may only be used mechanically to publish the issue, such as:

* Gitea repository identity,
* issue tracker configuration,
* required triage labels,
* authentication or connection details.

Such information must never introduce, modify, or resolve product requirements.

---

# No Hidden Context

The Gitea issue must be **self-contained**.

The coder should not need access to:

* this conversation,
* the decision tree,
* a roadmap,
* another issue,
* the codebase history,
* an ADR,
* or undocumented background knowledge

in order to understand what behavior is required.

If context is necessary to understand the requirement, write that context **directly into the issue ticket**.

If terminology needs explanation, explain it directly in the issue.

If a constraint matters, state it directly in the issue.

If an example is necessary to remove ambiguity, include the example directly in the issue.

If an edge case was settled in the session, describe it directly in the issue.

If a previous decision affects the required behavior, restate the relevant effect directly in the issue.

Never write instructions such as:

* "See the conversation for details."
* "Follow the existing roadmap."
* "As discussed previously."
* "Use the existing implementation as reference."
* "See ADR-..."
* "Refer to the current code."
* "Follow the existing behavior."

Instead, make the issue independently understandable.

---

# Core Principle

Specify:

> **WHAT must be observably true when the work is complete.**

Do not specify:

> **HOW the coder should make it true.**

The coder owns implementation decisions.

The specifier owns the required observable contract.

---

# Systems Software Interpretation

For systems software, observable behavior is not limited to UI behavior.

A valid specification may describe externally or contractually observable properties such as:

* command-line behavior,
* compiler input/output behavior,
* compiler diagnostics,
* generated machine instructions when instruction selection itself is a requirement,
* executable behavior,
* object or binary properties,
* ABI behavior,
* calling conventions,
* protocol behavior,
* wire formats,
* memory ordering,
* register preservation,
* target-machine behavior,
* semantic equivalence,
* compatibility requirements,
* deterministic behavior,
* resource limits,
* performance requirements,
* and failure behavior.

A low-level property is valid specification content when the current session explicitly established that property as part of the required contract.

For example:

> "Generated code must contain instruction X"

is valid when producing instruction X is itself the feature requirement.

It is not valid merely because the specifier believes instruction X would be a good implementation.

---

# Implementation Boundary

Do NOT prescribe implementation choices such as:

* modules,
* classes,
* internal functions,
* private interfaces,
* source files,
* internal APIs,
* internal compiler passes,
* algorithms,
* internal IR structures,
* helper abstractions,
* data structures,
* libraries,
* frameworks,
* internal state representation,
* mocking strategy,
* internal test architecture,
* refactoring strategy,
* code organization,
* or implementation sequence.

Do not turn observations from the session into implementation instructions unless the session explicitly made that property part of the external contract.

A good specification should remain correct if the coder completely changes the internal implementation while preserving all specified behavior.

---

# Session Decision Rule

Review the current session and identify what has actually been settled.

Separate conversation content into:

* settled requirements,
* settled behavioral decisions,
* observable constraints,
* compatibility requirements,
* examples,
* boundary conditions,
* failure behavior,
* performance requirements,
* explicitly excluded behavior,
* and unresolved decisions.

Do NOT interview the user again.

Do NOT reopen settled decisions.

Do NOT resolve unanswered branches yourself.

Do NOT guess.

Do NOT use the roadmap or codebase to resolve an unanswered question.

If a decision remains unresolved and prevents correct specification, do not silently choose an answer.

Either:

* omit the unresolved behavior from a `ready-for-agent` issue, or
* explicitly mark that issue as not ready.

Only behavior supported by the current session may become part of a ready implementation contract.

---

# Preserve Decision-Tree Results

When the session used a decision tree, treat the settled leaves and branches as specification inputs.

The issue does not need to reproduce the conversational decision-tree structure unless that structure itself helps explain the behavior.

Instead, convert the settled decisions into:

* explicit required behavior,
* acceptance scenarios,
* constraints,
* examples,
* failure cases,
* and out-of-scope statements.

The final Gitea issue must contain the resulting conclusions directly.

The coder must not need to reconstruct the decision tree.

---

# Issue Granularity

Create one or more Gitea issues.

Split issues according to **independently meaningful observable behavior**, not according to implementation components.

Good boundaries may include:

* one compiler capability,
* one ISA behavior,
* one externally visible optimization outcome,
* one compatibility requirement,
* one diagnostic behavior,
* one runtime behavior,
* one protocol capability,
* one independently verifiable system property,
* or one coherent user/developer workflow.

Do NOT create implementation-task issues such as:

* Add LLVM pass
* Add database table
* Modify scheduler
* Add helper class
* Create service layer
* Change internal IR node
* Refactor register allocator

unless the session explicitly established the named artifact itself as the required deliverable.

Prefer the smallest number of issues that still gives each issue a coherent acceptance contract.

---

# Acceptance Scenarios

Express behavioral acceptance criteria using **Gherkin** when Given/When/Then clearly represents the requirement.

Example:

```gherkin
Feature: Vector operation supports VLEN 1024

Scenario: Process an input larger than the previous VL limitation
  Given the target has VLEN 1024
  And the workload contains 64 rows
  When the workload is processed
  Then all 64 rows are processed correctly
  And the result matches the agreed reference result
```

Every statement must come from a decision or requirement established in the current session.

Do not introduce new behavior merely to make a scenario look complete.

---

# Observable Assertions

Scenarios should assert externally meaningful behavior.

Avoid:

```gherkin
Then optimization pass X invokes helper Y
```

Prefer:

```gherkin
Then the resulting program produces the expected result
```

When generated code itself is part of the requirement, it may be asserted:

```gherkin
Then the generated code contains the required target instruction
```

but only when that requirement was explicitly established in the current session.

---

# Scenario Matrices

Systems software often has parameterized behavior.

Use `Scenario Outline` and example tables when several settled cases differ only by parameters.

Example:

```gherkin
Scenario Outline: Operation behaves correctly across supported vector configurations
  Given SEW is <sew>
  And LMUL is <lmul>
  And VLEN is <vlen>
  When the workload is processed
  Then the result matches the agreed reference result

Examples:
  | sew | lmul | vlen |
  | 8   | 1    | 128  |
  | 16  | 1    | 256  |
  | 32  | 2    | 512  |
  | 32  | 4    | 1024 |
```

Only include combinations actually established or implied unambiguously by decisions in the current session.

Do not expand the matrix based on what the codebase appears to support.

---

# Correctness Dimensions

Include a dimension only when it was relevant to and settled in the current session.

Possible dimensions include:

## Functional behavior

What semantic result must be produced?

## Compatibility

What compatibility contract must be preserved?

Examples may include:

* architectures,
* ISA variants,
* ABI versions,
* input formats,
* output formats,
* existing supported configurations.

## Failure behavior

For invalid or unsupported input, what externally observable behavior is required?

For example:

* reject,
* diagnose,
* fall back,
* preserve prior behavior,
* terminate with a particular result.

## Determinism

If determinism was explicitly required, specify what observable results must remain deterministic.

## Concurrency

If concurrency behavior was decided, specify externally observable:

* ordering,
* atomicity,
* synchronization guarantees,
* progress guarantees.

Do not specify the internal synchronization mechanism.

## Resource behavior

When explicitly required, specify measurable properties such as:

* memory usage,
* stack usage,
* code size,
* latency,
* throughput,
* hardware resource use.

## Performance

Performance belongs in the specification only when the session established it as a requirement.

Do NOT invent:

* thresholds,
* baselines,
* benchmark configurations,
* allowed regressions,
* performance targets.

For example:

```gherkin
Then execution performance must not regress by more than 2% against the specified baseline
```

is valid only if the session already established both the 2% threshold and the baseline.

---

# Reference Behavior

For compilers, runtimes, numeric software, architecture features, and transformations, semantic comparison against an agreed reference may be used when the current session established that reference.

Examples:

```gherkin
Then the result matches the scalar reference implementation
```

or:

```gherkin
Then observable program behavior is identical with and without the optimization enabled
```

Do not select a reference implementation yourself.

Do not inspect the repository to discover one.

If the session did not establish the reference, do not invent it.

---

# QA Procedure

Every ready Gitea issue must contain a **QA Procedure**.

The QA Procedure demonstrates that the finished system satisfies the specification through the natural externally meaningful interface of that system.

For systems software this may include:

* invoking a compiler,
* invoking a command-line tool,
* processing an input,
* executing a resulting binary,
* running on target hardware,
* running under an emulator,
* communicating through a public protocol,
* inspecting externally defined binary properties,
* measuring an explicitly agreed metric.

A graphical UI is not preferred unless the feature actually uses one.

The QA Procedure must derive entirely from the current session's agreed contract.

Do not inspect the codebase to discover how QA "should" be performed.

Do not invent project-specific commands, scripts, filenames, test targets, paths, or infrastructure that were not established in the session.

When exact mechanics are unknown, describe the procedure at the behavioral level rather than guessing commands.

For example:

1. Prepare an input matching the agreed 64-row case.
2. Process it for a target configured with VLEN 1024.
3. Execute the resulting program on a supported execution environment.
4. Compare the output with the agreed reference result.
5. Verify that all 64 rows are processed.

The procedure must be understandable without knowledge of the implementation.

---

# Detail Must Live in the Issue

The Gitea issue is the complete handoff artifact.

Do not keep important explanation only in:

* chat,
* hidden reasoning,
* temporary notes,
* a decision tree,
* another document,
* or an unpublished draft.

Whenever additional explanation is necessary for the coder to implement or verify the requirement correctly, put that explanation **directly into the relevant Gitea issue**.

This includes:

* definitions,
* motivation necessary to interpret behavior,
* examples,
* terminology,
* precise meanings,
* distinctions between similar cases,
* boundary conditions,
* expected failure behavior,
* compatibility requirements,
* scenario assumptions,
* reference behavior,
* QA expectations,
* and explicit exclusions.

Prefer a slightly longer self-contained issue over a short issue that depends on undocumented context.

However, do not add background material that does not help define or verify the required behavior.

---

# Gitea Issue Template

````markdown
## Problem

Describe the observable problem or missing capability.

Include enough context for the coder to understand the problem without access to the original conversation.

Do not describe implementation.

## Required Behavior

State the complete observable contract.

Explain terminology or distinctions here when necessary.

Include all relevant conclusions from the current session directly in this ticket.

Do not rely on roadmap, codebase, ADRs, previous discussions, or other documents to supply missing meaning.

## Acceptance Scenarios

```gherkin
Feature: ...

Scenario: ...
  Given ...
  When ...
  Then ...
````

Use Scenario Outlines or behavioral matrices where appropriate.

Every scenario must represent behavior established in the current session.

## Compatibility and Constraints

List externally required constraints established in the current session.

Examples may include:

* supported targets,
* ABI requirements,
* semantic invariants,
* input/output contracts,
* resource limits,
* performance requirements,
* required low-level observable behavior.

Do not add constraints discovered from the implementation.

## QA Procedure

Provide a human-executable procedure that demonstrates the real required behavior through the system's natural external interface.

Do not assume undocumented repository-specific commands or infrastructure.

## Out of Scope

List related behavior explicitly excluded by the decisions made in the current session.

## Notes

Add any remaining explanation required to make this ticket fully self-contained.

Do not reference hidden conversation context.

Do not provide implementation suggestions.

````

---

# Publishing to Gitea

Publish each completed behavioral specification as a Gitea issue.

The issue itself must contain the complete specification.

Do not publish a short issue that links elsewhere for the actual requirements.

Apply the `ready-for-agent` label only when the issue contains enough settled information for a coder to implement without guessing product intent.

Issue-tracker configuration may be read only as necessary to determine:

- which Gitea repository receives the issue,
- how to create the issue,
- and which configured triage label corresponds to `ready-for-agent`.

Issue-tracker metadata must not be treated as a source of requirements.

If the required Gitea project or triage configuration has not been provided, tell the user to run:

`/setup-matt-pocock-skills`

Do not perform additional triage.

---

# Relationship to the Coder

The responsibility boundary is:

```text
Current session conversation
          ↓
   settled decision tree
          ↓
        to-spec
          ↓
 self-contained behavioral contract
     Gherkin + QA Procedure
          ↓
       Gitea Issues
          ↓
         Coder
          ↓
   investigates codebase
   chooses architecture
   chooses implementation
   writes tests and code
````

The important separation is:

### to-spec may know

Only what the current session established about required behavior.

### coder may investigate

The actual repository, architecture, existing implementation, tests, APIs, constraints, and appropriate implementation strategy.

`to-spec` owns:

> **What constitutes correct behavior.**

The coder owns:

> **How the existing system should be changed to achieve it.**

---

# Definition of Ready

Apply `ready-for-agent` only when:

* the relevant decisions were settled in the current session,
* the observable contract is unambiguous,
* the issue itself contains all necessary requirement context,
* normal behavior is specified,
* important settled boundary cases are specified,
* important settled failure cases are specified,
* required compatibility constraints are explicit,
* required system-level properties are explicit,
* QA can determine whether the behavior works,
* the coder does not need the original conversation to understand the requirement,
* the coder does not need to consult a roadmap to discover missing requirements,
* and no unresolved product decision requires the coder to guess intent.

The coder may still need to investigate the codebase and make implementation or architectural decisions.

That is expected and is outside the responsibility of `to-spec`.

---

# Definition of Done for This Skill

This skill is complete when:

1. Only decisions from the current session have been used as specification content.
2. No roadmap has been consulted for requirements.
3. No codebase has been consulted for requirements.
4. No external project artifact has been used to fill specification gaps.
5. Settled decisions have been converted into observable contracts.
6. Necessary details have been written directly into the relevant Gitea issue.
7. Gherkin scenarios or behavioral matrices capture the acceptance behavior.
8. Relevant settled compatibility, failure, performance, and system-level constraints are explicit.
9. Each ready issue contains a self-contained QA Procedure.
10. No unnecessary implementation decisions have been prescribed.
11. The coder can understand the required behavior without access to the original session.
12. Completed specifications have been published as Gitea issues.
13. Ready specifications receive `ready-for-agent`.

