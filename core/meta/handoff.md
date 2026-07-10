# Handoff: compact the session for a fresh agent

> **Config inputs:** `config.repos`, `config.paths.workflowDir`, `config.issueTracker.repo`

**Input**: an optional note on what the next session should focus on.

## Objective

Squeeze the current conversation down to its resumable core: a single document a fresh
session (any tool) can read to pick up exactly where this one left off, without inheriting
this session's bloated context.

## Principles

- **Compaction, not transcript.** Capture only what is needed to resume: the active task,
  the decisions that matter, and the next concrete steps.
- **Reference, never copy.** Anything already written down (a tracker issue, a plan under
  `{{config.paths.plansDir}}`, a PRD, an ADR, a commit, a diff, a PR) is linked by path or
  number, never pasted in.
- **Redact secrets.** Strip API keys, tokens, and PII before writing.

## Steps

1. Identify the live thread: what is actively being worked on now, the key decisions made
   this session, and what is left. Exclude anything already captured in a durable artifact.
2. Gather references: open PR(s), the current branch in each repo of `{{config.repos}}`, the
   issue number in `{{config.issueTracker.repo}}`, plan/PRD/report paths under
   `{{config.paths.workflowDir}}`, and any files mid-edit.
3. Note the suggested next skills/steps (e.g. `implement`, `pr-review`) and any open question
   or risk.
4. Write the handoff to `{{config.paths.workflowDir}}/handoffs/<kebab-topic>.md` (create the
   dir if missing). Tailor the emphasis to the input note if one was given.

## Output format

```
# Handoff: <topic>
Written: <date> · Next session: <the input focus, or "continue">

## State
- Task: <one line>
- Branch(es): <repo> <branch> · <repo> <branch> (one per touched repo)
- PR(s): #<n> (<status>)  ·  Issue: #<n>

## Done this session
- <decision / change, referencing files by path>

## Next steps
1. <concrete next action> — suggested: <skill>
2. ...

## References (not copied)
- Plan: {{config.paths.plansDir}}/<file>
- <other artifacts by path/URL>

## Open questions / risks
- <anything unresolved>
```

Keep it short. A good handoff is the conversation squeezed to just its resumable core.
