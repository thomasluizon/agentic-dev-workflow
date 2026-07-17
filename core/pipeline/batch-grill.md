# Batch Grill: frontier grilling across correlated issues

> **Config inputs:** `config.paths.plansDir`, `config.paths.specsDir`, `config.worktree.branchPattern`, `config.execution.hasNamedAgentRegistry`, `config.execution.maxParallelSubagents`

Multi-issue grilling done as ONE interrogation over the whole set, not N serial ones. It builds on `grill` — every individual question still follows `grill`'s contract (structured question interface, recommended answer first, research the codebase instead of asking) — and adds only the cross-issue layer: ask each shared question once, catch conflicts between issues, and attribute answers back per issue. Interactive, main-session only; **NEVER a subagent** (it is a conversation with the user).

## Precondition

The issues are already primed (via `prime <N…>`), each with its **open questions / risks** surfaced — batch-grill consumes those. If an issue's open questions are missing, request them before starting. Requires **2+ issues**; for a single issue use `grill`.

## The loop

1. **Collect the frontier.** Gather the union of every issue's open questions. Tag each question with the issue(s) it belongs to.
2. **Cluster.** Merge questions that are the SAME decision across issues into one shared question (e.g. "which toast component for errors?" raised by #12 and #15 → one question, applies to both). Leave issue-specific questions standalone.
3. **Detect conflicts.** Flag where two issues imply INCOMPATIBLE answers to a shared concern (e.g. #12 assumes cursor pagination, #15 assumes offset). Surface the conflict as its own question — resolving it matters more than either issue's local answer, and it must be resolved before planning either.
4. **Grill the frontier in rounds.** Ask following `grill`'s mechanics (structured question interface, recommended answer first, batch the maximum independent questions per call). Ask each shared/conflict question ONCE. Research codebase-answerable facts (`Glob`/`Grep`/`Read`) instead of asking. Respect dependencies — hold a question whose prerequisite is unanswered to the next round; repeat until the frontier is empty.
5. **Attribute + persist.** Write each issue's resolved decisions to the **caller's durable store**, exactly:
   - invoked by `execute` → `{{config.worktree.branchPattern}}` worktree's `{{config.paths.plansDir}}/issue-<N>.decisions.md`, a `## Decisions (from grilling)` block.
   - invoked by `drive` → the issue's `{{config.paths.specsDir}}/issue-<N>.spec.md` **Decisions** section.
   - invoked directly → `{{config.paths.plansDir}}/issue-<N>.decisions.md` per issue.

   A shared answer is written into EVERY affected issue's store, marked as a cross-issue decision. A resolved conflict is recorded in every issue it touched.

## Rules

- Follow `grill` for every individual question — do not restate or override those mechanics.
- Do not write code or plans during batch-grilling.
- **Attribution must be exact** — never apply a shared answer to an issue it does not affect.
- Interactive, main-session only — never delegate the frontier to a subagent. When `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, batch-grill is unaffected: it is a main-session conversation either way.
- The caller (`execute`'s grill gate, `drive`) or the user exits the loop; that exit is the caller's grill gate. On direct invocation, stop when the frontier is empty and report the per-issue decisions files written.
