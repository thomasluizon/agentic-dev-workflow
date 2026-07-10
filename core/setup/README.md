# setup-harness detection + interview machinery

The read-only, dependency-free Node modules that `setup-harness.md` drives to
*research the machine*, *discover the repos*, and *run the adaptive grill-me
interview*. The runbook (the skill body) is the AI-facing procedure; these are the
deterministic parts it calls so detection and the resumable record are exact, not
guessed. Everything here is **read-only** — nothing runs a project's build/test,
starts a server, or mutates state.

```
core/setup/
  setup-harness.md   ← the gated runbook (phases: research → discover → interview → docs → tracker)
  detect.mjs         ← OS/shell, installed CLIs (which/where + safe --version), git remotes+host,
                       CI configs, convention docs, MCP servers (~/.claude.json), inferred commands
  commands.mjs       ← infer test/lint/typecheck/build from package.json / *.csproj / pyproject.toml /
                       Makefile — each with its source, evidence, and confidence (never executed)
  discovery.mjs      ← current repo + workspace members (npm/pnpm/.sln) + a bounded projects-root scan
  questions.mjs      ← the fixed core question set (section F) + express subset + resume + adaptive
                       follow-ups (activeFollowups fires only what detection/prior answers make relevant)
  answers.mjs        ← harness.answers.yaml read/write/merge, incremental + resumable; a tiny scoped
                       YAML emitter/parser pair (the pack has no YAML dependency)
  trackers.mjs       ← per-tracker best-tool driver: resolve GitHub→gh / Jira→MCP-or-CLI / Linear→MCP…
                       by availability, not a blanket MCP-first rule
  docs.mjs           ← classify doc pointers (explicit link vs taught source) + extract every normative
                       statement ("must/never/always/required", hard vs soft) from fetched text
```

## What each phase produces

`setup-harness` runs these in order and records to `harness.answers.yaml`:

1. **Research** (`detect.mjs` + `commands.mjs`) → a machine profile; inferred commands shown for confirm.
2. **Discover** (`discovery.mjs`) → the confirmed repo set (current + workspace + siblings).
3. **Interview** (`questions.mjs` + `answers.mjs`) → each core question + its active follow-ups, written incrementally.
4. **Docs** (`docs.mjs`) → normative statements extracted from fetched policy docs, deduped and tagged.
5. **Tracker** (`trackers.mjs`) → the best available tool for the chosen tracker.

## Where it stops

This is the **first half** of the installer: it *inspects and records*. It writes
nothing enforcing — no `CLAUDE.md`, rule, hook, or `hooks.policy.json`. The decode
→ gate → generate step reads `harness.answers.yaml` (the durable, resumable record
that also explains *why* each future artifact exists) and does the tiering,
approval gate, and generation.

## Genericity + proof

Everything here lives under `core/`, so `scripts/check-genericity.mjs` guarantees
no project string or baked SDLC policy leaks in — a tracker's CLI verbs are held as
argument arrays, policy questions are neutral (required / banned / none are equal
options). `node scripts/test-setup.mjs` proves every module against the pack's own
repo, throwaway fixture trees, and an answers YAML round-trip; CI gates on it.
