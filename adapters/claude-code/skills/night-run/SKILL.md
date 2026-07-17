---
name: night-run
description: Unattended queue-drain: one fresh non-interactive session per task, each stopping at a draft PR; a fit gate excludes ill-suited tasks. Never merges, never touches a protected branch.
argument-hint: [issue-number ...] | --label <l> | --backlog <file> | status | stop
---
# night-run

Unattended queue-drain: one fresh non-interactive session per task, each stopping at a draft PR; a fit gate excludes ill-suited tasks. Never merges, never touches a protected branch.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/pipeline/night-run.md`

Resolve every `{{config.*}}` reference in the core body against the EFFECTIVE config —
the global `~/.claude/workflow.config.yaml` (machine defaults) merged with this project's
`workflow.config.yaml` (project overrides win). Run `node <_core>/setup/config.mjs resolve`
to get it, or read the project file directly when there is no global layer. If a referenced
optional config value is absent, skip that step and record it in the skill's Deferred
ledger. When the host tool lacks parallel subagents or a named-agent registry, follow the
core body's sequential fallback.
