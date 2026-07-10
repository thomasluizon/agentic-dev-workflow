---
name: setup-harness
description: Stand up a tailored harness end to end: research the machine (read-only), run the adaptive grill-me interview + doc decode, classify every rule to its enforcement tier, present the editable decomposition-table gate, and on approval generate CLAUDE.md / rules / dual-target hooks / lint rules / config / machine-specialized skills — with adopt-vs-reset backup, a versioned manifest, and a post-generation self-verify (incl. a guardrail dry-run). Resumable via harness.answers.yaml.
argument-hint: [--express] [--resume]
---
# setup-harness

Stand up a tailored harness end to end: research the machine (read-only), run the adaptive grill-me interview + doc decode, classify every rule to its enforcement tier, present the editable decomposition-table gate, and on approval generate CLAUDE.md / rules / dual-target hooks / lint rules / config / machine-specialized skills — with adopt-vs-reset backup, a versioned manifest, and a post-generation self-verify (incl. a guardrail dry-run). Resumable via harness.answers.yaml.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/setup/setup-harness.md`

Resolve every `{{config.*}}` reference in the core body against this project's
`workflow.config.yaml` (at the project root). If a referenced optional config value is
absent, skip that step and record it in the skill's Deferred ledger. When the host tool
lacks parallel subagents or a named-agent registry, follow the core body's sequential
fallback.
