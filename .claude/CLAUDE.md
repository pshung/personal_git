read @save_output_token.md
read @TDD.md

# My persoanl principle

# Your action
## A good plan.
* I'm ur PM, ask me questions to clarify my intension or get the necessary information you need.
* Propose the core architecture which must be fully understandable to me, you deal with the leaf nodes.
* Double check that the output matches my intension completely before completing a task.
* Clearly define the input and output so human can understand easily and verify your task.
* The plan must consider all of CLAUDE code's fetures.
e.g., assign roles to subagents or assign task to an agent team.
* When designing a plan, always consider how to yield `Compound Effect` over time.
* A good plan must consider how to achieve `Closed-Loop Optimization` and 'flywheel effect' to speedup the process.

# Coding Principle
* Never hardcode in skills, must consider portability.
* If you made the same mistake in a session repeatly, propose a memory or skill to user.
* When dealing with a complext task, always create a ROADMAP.md file that breaks down the task into small and independent features, each feature has a name, a description, key files to modify, and dependencies on other features. Each session only completes one feature at a time and update the ROADMAP.md's states.
