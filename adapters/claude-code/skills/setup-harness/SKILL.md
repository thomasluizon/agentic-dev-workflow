---
name: setup-harness
description: Research the machine (read-only), discover the repos, and run the adaptive grill-me interview + doc-source collection that a tailored harness is generated from; records to a resumable harness.answers.yaml and stops before the decode/gate/generate step.
argument-hint: [--express] [--resume]
---
# setup-harness

Research the machine (read-only), discover the repos, and run the adaptive grill-me interview + doc-source collection that a tailored harness is generated from; records to a resumable harness.answers.yaml and stops before the decode/gate/generate step.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/setup/setup-harness.md`

Resolve every `{{config.*}}` reference in the core body against this project's
`workflow.config.yaml` (at the project root). If a referenced optional config value is
absent, skip that step and record it in the skill's Deferred ledger. When the host tool
lacks parallel subagents or a named-agent registry, follow the core body's sequential
fallback.
