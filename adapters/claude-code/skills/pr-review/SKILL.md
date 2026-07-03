---
name: pr-review
description: Deep multi-dimension review of a diff against the project rubric; parity/i18n/contract are config-gated.
argument-hint: [scope]
---
# pr-review

Deep multi-dimension review of a diff against the project rubric; parity/i18n/contract are config-gated.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/review/pr-review.md`

Resolve every `{{config.*}}` reference in the core body against this project's
`workflow.config.yaml` (at the project root). If a referenced optional config value is
absent, skip that step and record it in the skill's Deferred ledger. When the host tool
lacks parallel subagents or a named-agent registry, follow the core body's sequential
fallback.
