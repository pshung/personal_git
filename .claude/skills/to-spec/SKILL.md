---
name: to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker(use 'tea' tool): no interview, just synthesis of what we've already discussed."
disable-model-invocation: true
---

------------------------------

# To Spec

Turn the decisions already settled in the current session into one or more **behavioral specifications**, then publish them as **Gitea issues** for a coder to implement.

This skill acts as a **specifier**.

It defines the contract that the finished system must satisfy.

It does NOT design the implementation.

## Core Principle

Specify:

> **WHAT must be observably true when the work is complete.**

Do not specify:

> **HOW the coder should make it true.**

However, in systems software, externally required behavior may include low-level properties.

A property is valid specification material when the requirement itself makes that property part of the contract.

Examples include:

* command-line behavior,
* compiler diagnostics,
* generated machine instructions when instruction selection is explicitly required,
* ABI behavior,
* calling conventions,
* binary or object-file properties,
* protocol behavior,
* memory ordering,
* register preservation,
* compatibility requirements,
* execution semantics,
* resource limits,
* deterministic behavior,
* performance thresholds,
* hardware-visible behavior.

These are not considered implementation details when they are themselves required observable outcomes.

Do not prescribe internal choices such as:

* module structure,
* classes,
* internal functions,
* internal interfaces,
* private data structures,
* internal compiler passes,
* algorithms,
* helper abstractions,
* source file layout,
* refactoring strategy,
* implementation sequence,
* or internal test architecture.

Those decisions belong to the coder.

## Source of Truth

Use the current session as the primary source.

Capture decisions already settled through the session's decision tree or equivalent discussion.

Do NOT interview the user again.

Do NOT reopen settled decisions.

Do NOT invent answers to unresolved decisions.

Separate the session into:

* settled requirements,
* behavioral constraints,
* compatibility requirements,
* edge cases,
* failure behavior,
* explicitly excluded behavior,
* and unresolved decisions.

Only fully settled behavior may receive `ready-for-agent`.

Use terminology from the project's domain model and respect existing ADR constraints.

## Specification Boundary

Choose the highest externally meaningful verification boundary appropriate for the feature.

For systems software this may be:

1. execution of the complete system or tool,
2. public command-line interface,
3. public API,
4. compiler or linker input/output behavior,
5. generated executable/object/binary artifacts,
6. protocol or wire behavior,
7. target-machine behavior,
8. externally observable performance or resource behavior.

Do not descend into internal components merely because they are easier to test.

The specification should survive a complete rewrite of the internal implementation as long as the required external contract remains satisfied.

## Issue Granularity

Split Gitea issues by independently meaningful behavior.

Good issue boundaries include:

* one compiler capability,
* one language or ISA behavior,
* one externally visible optimization outcome,
* one compatibility requirement,
* one diagnostic behavior,
* one runtime behavior,
* one protocol capability,
* or one independently verifiable system property.

Do NOT split issues according to internal implementation components.

Bad examples:

* Add LLVM pass
* Modify scheduler
* Add helper class
* Change internal IR node
* Refactor register allocator

Good examples:

* Support operation X for RVV targets
* Emit the required diagnostic for unsupported configuration Y
* Preserve ABI behavior when feature Z is enabled
* Allow workloads larger than VL=32 on VLEN=1024 targets

## Acceptance Scenarios

Express behavioral acceptance criteria using Gherkin when Given/When/Then clearly represents the requirement.

Example:

```gherkin
Feature: Vector operation supports VLEN 1024

Scenario: Process an input larger than the previous VL limitation
  Given a target with VLEN 1024
  And an input containing 64 rows
  When the workload is compiled and executed
  Then all 64 rows are processed correctly
  And the result matches the reference result
```

Scenarios must describe observable contracts.

Avoid implementation assertions such as:

```gherkin
Then optimization pass X invokes helper Y
```

Prefer:

```gherkin
Then the generated program produces the expected result
```

If the required behavior explicitly concerns generated code, that may be specified:

```gherkin
Then the generated code contains the required target instruction
```

only when instruction selection itself is part of the settled requirement.

## Scenario Matrices

Systems software frequently has parameterized behavior.

Use `Scenario Outline` and example tables instead of repeating nearly identical scenarios.

Example:

```gherkin
Scenario Outline: Operation behaves correctly across supported vector configurations
  Given SEW is <sew>
  And LMUL is <lmul>
  And VLEN is <vlen>
  When the program is compiled and executed
  Then the result matches the reference implementation

Examples:
  | sew | lmul | vlen |
  | 8   | 1    | 128  |
  | 16  | 1    | 256  |
  | 32  | 2    | 512  |
  | 32  | 4    | 1024 |
```

Large conformance spaces may be expressed as a test matrix rather than hundreds of individual scenarios.

## Correctness Dimensions

Consider which of the following dimensions were explicitly settled in the session:

### Functional behavior

Does the system produce the correct semantic result?

### Compatibility

Does behavior remain compatible with required:

* targets,
* architectures,
* ABI versions,
* formats,
* existing programs,
* or previously supported configurations?

### Failure behavior

For invalid or unsupported inputs:

* must the operation fail,
* produce a diagnostic,
* fall back,
* or preserve existing behavior?

### Determinism

If determinism is required, specify which observable results must remain deterministic.

### Concurrency

If concurrent behavior is relevant, specify externally observable ordering, atomicity, synchronization, or progress guarantees.

Do not prescribe the synchronization implementation.

### Resource behavior

If part of the requirement, specify observable limits such as:

* memory consumption,
* stack use,
* code size,
* latency,
* throughput,
* or hardware resources.

### Performance

Performance may be part of the specification when the session explicitly defines a performance objective.

Do not invent performance thresholds.

Prefer measurable conditions.

For example:

```gherkin
Then performance must not regress by more than 2% against the agreed baseline
```

only when that threshold and baseline have already been established.

## Reference Behavior

For algorithms, compilers, runtimes, numeric software, or architecture features, prefer semantic comparison against an agreed reference when appropriate.

Example:

```gherkin
Then the result matches the scalar reference implementation
```

or:

```gherkin
Then observable program behavior is identical with and without the optimization enabled
```

Reference behavior should be used when it expresses correctness more robustly than exact internal output.

Do not require exact generated code unless exact generated code is itself part of the requirement.

## QA Procedure

Every issue must contain a **QA Procedure**.

The QA procedure demonstrates that the completed system satisfies the specification through an externally meaningful interface.

Unlike application software, a graphical UI is NOT preferred by default.

Use the natural interface of the system.

Examples include:

* invoking a compiler,
* executing a binary,
* running a command-line tool,
* submitting an input file,
* communicating through a public protocol,
* running on target hardware,
* running under an emulator,
* inspecting externally defined binary properties,
* measuring an agreed performance metric.

A QA procedure may contain commands when commands are the normal way a human exercises the system.

Example:

1. Prepare the specified test input.
2. Compile it for the RVV target with VLEN 1024.
3. Execute the resulting program on the supported target or emulator.
4. Compare its output against the reference implementation.
5. Verify that all 64 rows are processed.
6. Repeat with the optimization disabled.
7. Verify that observable results are equivalent.

QA must exercise the integrated behavior.

It must not require understanding internal implementation details.

## Gitea Issue Template

````markdown
## Problem

Describe the observable problem or missing capability.

## Required Behavior

Describe the contract that must hold when the work is complete.

Do not describe how it should be implemented.

## Acceptance Scenarios

```gherkin
Feature: ...

Scenario: ...
  Given ...
  When ...
  Then ...
````

Use Scenario Outlines or behavioral matrices where appropriate.

## Compatibility and Constraints

List only externally required constraints already settled in the session.

Examples:

* supported targets,
* ABI compatibility,
* required input/output formats,
* semantic invariants,
* performance requirements,
* resource limits.

Do not list internal architectural constraints unless an existing project-level ADR already makes them mandatory.

## QA Procedure

Provide a human-executable procedure that exercises the real system through its natural external interface.

## Out of Scope

List related behavior explicitly excluded by the current decisions.

## Notes

Include only information needed to preserve requirement intent.

Do not suggest implementation.

````

## Relationship to the Coder

The responsibility boundary is:

```text
Current session
      ↓
Decision tree
      ↓
   to-spec
      ↓
Observable contract
Gherkin / matrices
QA Procedure
      ↓
 Gitea Issues
      ↓
    Coder
      ↓
Implementation design
Internal tests
Production code
````

`to-spec` owns:

> **What constitutes correct behavior.**

The coder owns:

> **How to achieve that behavior.**

The coder may choose any internal implementation that satisfies the complete observable contract.

## Definition of Ready

Apply `ready-for-agent` only when:

* relevant product decisions are settled,
* the observable contract is unambiguous,
* normal behavior is specified,
* important boundary and failure cases are specified,
* required compatibility constraints are known,
* required system-level properties are known,
* QA can verify the behavior,
* and no unresolved requirement requires the coder to guess product intent.

The coder may still make implementation and architectural decisions.

That is expected.

## Definition of Done for This Skill

The skill is complete when:

1. Settled decisions from the session have been captured.
2. They are expressed as observable system contracts.
3. Gherkin scenarios or behavioral matrices capture acceptance behavior.
4. Relevant compatibility, failure, and system-level constraints are recorded.
5. Each issue contains an executable QA procedure.
6. No unnecessary implementation decisions have been prescribed.
7. Completed specifications are published as Gitea issues.
8. Ready specifications receive `ready-for-agent`.

