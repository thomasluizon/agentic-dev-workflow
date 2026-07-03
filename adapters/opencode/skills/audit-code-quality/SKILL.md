---
description: Repo-wide code-quality audit against the shared rubric: dead code, SOLID, DRY, naming, size.
---
# audit-code-quality

Repo-wide code-quality audit against the shared rubric: dead code, SOLID, DRY, naming, size.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/review/audit-code-quality.md`

Resolve every `{{config.*}}` reference in the core body against this project's
`workflow.config.yaml` (at the project root). If a referenced optional config value is
absent, skip that step and record it in the skill's Deferred ledger. When the host tool
lacks parallel subagents or a named-agent registry, follow the core body's sequential
fallback.
