# agentic-dev-workflow

A config-driven, tool-agnostic pack of agentic development skills — a battle-tested
pipeline (`prime → grill → plan → implement → validate → ship`) plus review, audit,
intake, and research skills — that drops into **any** project and **any** agentic
coding tool. You fill in one config file; the skills carry everything else.

Nothing in the skill bodies knows your project's name, paths, stack, vendors, or SDLC
policy. All of that lives in a single `workflow.config.yaml`. The skill logic lives once,
in `core/`, and two thin adapters expose it to Claude Code and OpenCode.

## Why

Most "AI dev workflow" skill collections are welded to the repo they were born in —
hardcoded paths, project names, one specific model, one specific tool, one team's git
policy. This pack extracts the *shape* of a good agentic pipeline and makes every
project-specific value a config field, so the same skills work on a solo side project and
a multi-repo product, on Claude or an open-source-class model, under either supported tool.
Even SDLC policy is config, not constant — a machine that BANS co-authored commits or
requires `TB-####` branches is one config away from the opposite one.

> **Direction (in progress).** The pack is evolving from "fill in a YAML by hand" into an
> AI-installed harness: a `setup-harness` skill that researches the machine, interviews you,
> decodes your company's own rule docs, and generates a tailored harness — hooks for what
> must be enforced, skills for procedures, rules/facts for the rest. The generic `core/`
> skills below are the proven foundation that installer builds on.

## What's in it

| Group | Skills |
|---|---|
| **Pipeline** | `prime` · `grill` · `plan` · `implement` · `validate` · `execute` · `ship` · `clean` |
| **Review** | `pr-review` · `audit-security` · `audit-tests` · `audit-performance` · `audit-code-quality` · `thermo-nuclear` · `prod-readiness` · `second-opinion` |
| **Intake** | `feature` (idea → PRD → issues) · `prd` (warm or cold) · `stories` (PRD → tracer-bullet issues) |
| **Research** | `deep-research` · `llm-council` |
| **Ops** | `investigate` (root-cause a prod incident end to end, read-only until a human gate) |
| **Meta** | `handoff` (compact a session to resume clean) · `lesson` (capture a correction as a graduating gate) |
| **Agents** | `security-reviewer` (generic; parity / i18n / contract checks are config-gated inside `pr-review`, not separate agents) |

`execute` is the gated conductor (`issue → prime → grill → plan → implement`) with hard,
default-deny stage gates. `pr-review` keeps full multi-dimension orchestration; its
parity, i18n, and contract dimensions activate only when your config declares them, and its
Phase 6 folds in an adversarial skeptic pass plus an optional cross-model `second-opinion`
on Critical findings. Every review/audit skill shares one `verification-protocol` (coverage
contract → adversarial verify → loop-until-dry → deferred ledger) and one behavioral
baseline that ships in `core/_shared/`.

## Architecture

```
core/          ← tool-agnostic skill bodies — the SINGLE source of truth
  _shared/     ← verification-protocol + behavioral-baseline (read by many skills)
  pipeline/ review/ intake/ research/ ops/ meta/ agents/
adapters/      ← thin per-tool wrappers; each points at a core/ body, no logic
  claude-code/ ← .claude/skills + .claude/agents
  opencode/    ← .opencode/skills + .opencode/agents
scripts/       ← install / sync / gen-adapters / check-genericity
workflow.config.example.yaml   ← the config schema (copy → workflow.config.yaml)
```

Each adapter wrapper is a few lines: the tool's required frontmatter plus a pointer to
the matching `core/**` body. Logic is never duplicated across tools — fix a skill once
in `core/` and every adapter inherits it.

## Install

1. Copy the config and fill it in:
   ```bash
   cp workflow.config.example.yaml /path/to/your-project/workflow.config.yaml
   # edit workflow.config.yaml — set repos, paths, commands, trackers
   ```
2. Vendor the pack for your tool:
   ```bash
   node scripts/install.mjs --tool claude-code --into /path/to/your-project
   #                         --tool opencode
   ```
   This copies `core/` and the chosen adapter into your project's skills directory and
   writes `skills-lock.json` pinning what was installed.
3. Copy and customize the rubric the review/audit skills score against:
   ```bash
   cp core/review/pr-review.rubric.example.md /path/to/your-project/pr-review.rubric.md
   ```
   Point `review.rubricPath` in your config at it.

Preview without writing anything:
```bash
node scripts/install.mjs --tool claude-code --into /path/to/your-project --dry-run
```

### Install layout per tool

| Tool | Wrappers land in | Core vendored to |
|---|---|---|
| claude-code | `.claude/skills/<skill>/SKILL.md`, `.claude/agents/` | `.claude/skills/_core/` |
| opencode | `.opencode/skills/<skill>/SKILL.md`, `.opencode/agents/` | `.opencode/skills/_core/` |

## Update

```bash
node scripts/sync.mjs --into /path/to/your-project
```
Re-vendors the pack and re-pins `computedHash` in `skills-lock.json`. Idempotent — a
no-op when nothing changed.

## Configuration

`workflow.config.example.yaml` is fully commented; every field is documented inline. The
essentials:

- **`repos[]`** — one entry per repository (1..N). Each carries its `path` and the exact
  `testCmd` / `lintCmd` / `typeCheckCmd` / `buildCmd` the `validate` skill runs. Empty
  command → that step is skipped.
- **`conventionsDocs[]`** — the docs `prime` reads to build project context.
- **`parity` / `i18n` / `contract`** — optional. Set them and `pr-review` runs those
  dimensions; omit them and the dimension is reported N/A. No dangling checks.
- **`review.rubricPath`** — the standards the review + audit skills score against.
- **`auditAnchors`** — calibrates severity to your scale (`solo` / `team` / `enterprise`).
- **`issueTracker`** — where `stories` / `feature` create issues.
- **`worktree`** — where `prime` / `implement` create isolated per-issue worktrees.
- **`execution`** — capability flags for graceful degradation (see below).

## Graceful degradation

The pack targets open-source-class models and minimal tools, not just frontier stacks.
Every orchestrator (`execute`, `pr-review`, the audits, `deep-research`, `llm-council`)
states a **sequential fallback**: when the host tool lacks parallel subagents, a named
agent registry, or hooks, the same steps run serially in one thread. Set
`execution.maxParallelSubagents: 1` and `execution.hasNamedAgentRegistry: false` to force
it. The pack never requires hooks.

## Genericity guarantee

`core/**` must never contain a project-specific string **or** a hardcoded SDLC policy
constant. CI runs `node scripts/check-genericity.mjs`, which fails the build on two classes
of leak:

1. **Project strings** — any project name, brand, author handle, or absolute machine path.
2. **Policy constants** — a `Co-Authored-By` commit trailer, the `gh` tracker CLI, a
   squash-only merge, or a literal branch prefix baked in instead of read from config. A
   policy line is allowed only when it also carries a `{{config.*}}` reference (so the
   behavior is genuinely parameterized and the constant is just an inline illustration).

This is what keeps the pack reusable — project specifics *and* git policy belong in
`workflow.config.yaml`, always.

## Maintaining the pack

- Skill logic lives once in `core/`. Edit there; every adapter inherits the change.
- The adapters are generated from a manifest — after changing the skill roster, run
  `node scripts/gen-adapters.mjs` and commit the regenerated `adapters/` tree.
- `node scripts/check-genericity.mjs` must stay green; CI runs it on every push and PR.

## License

MIT © 2026 Thomas Luizon Rodrigues Gregorio
