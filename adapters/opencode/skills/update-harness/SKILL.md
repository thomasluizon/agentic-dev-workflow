---
description: Monthly, web-grounded staleness audit of the installed harness: stale model pins, deprecated APIs/flags/tools, drifted refs, install-behind-CORE, and new Claude Code / opencode capabilities — every claim citing a live web source. Presents a gated proposal; on approval fixes this machine's install and emits a proposed upstream change for any CORE drift. The proactive counterpart to setup-harness's reactive re-run.
---
# update-harness

Monthly, web-grounded staleness audit of the installed harness: stale model pins, deprecated APIs/flags/tools, drifted refs, install-behind-CORE, and new Claude Code / opencode capabilities — every claim citing a live web source. Presents a gated proposal; on approval fixes this machine's install and emits a proposed upstream change for any CORE drift. The proactive counterpart to setup-harness's reactive re-run.

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** `../_core/meta/update-harness.md`

Resolve every `{{config.*}}` reference in the core body against the EFFECTIVE config —
the global `~/.claude/workflow.config.yaml` (machine defaults) merged with this project's
`workflow.config.yaml` (project overrides win). Run `node <_core>/setup/config.mjs resolve`
to get it, or read the project file directly when there is no global layer. If a referenced
optional config value is absent, skip that step and record it in the skill's Deferred
ledger. When the host tool lacks parallel subagents or a named-agent registry, follow the
core body's sequential fallback.
