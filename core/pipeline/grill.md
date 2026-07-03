# Grill Me

> **Config inputs:** none

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding.

Walk down each branch of the design tree, resolving dependencies between decisions one by one. For each question, provide your recommended answer.

Ask questions through the host tool's structured question interface where one exists (never as buried plain text). Batch the maximum number of independent questions the interface allows per call, unless fewer independent questions remain or a question depends on an unanswered one. If the host has no structured question UI, ask in plain text but keep the same discipline: one clearly numbered decision per question, recommended answer first.

If a question can be answered by exploring the codebase, explore the codebase instead. Prefer targeted glob, grep, and read calls. Use a broad exploration subagent only when the answer requires wide codebase discovery.

## Rules

- Do not write code during grilling unless the user explicitly exits the grilling loop and asks for implementation.
- Do not jump to a plan before the key design branches are resolved.
- Keep questions concrete and decision-oriented.
- When there is a likely best answer, make it the FIRST option and label it "(Recommended)"; put the consequence of the decision in the option descriptions.
- Track dependencies between answers. If a later answer invalidates an earlier assumption, revisit it.
