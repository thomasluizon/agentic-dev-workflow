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
core/          ← tool-agnostic skill bodies + hook logic — the SINGLE source of truth
  _shared/     ← verification-protocol + behavioral-baseline (read by many skills)
  pipeline/ review/ intake/ research/ ops/ meta/ agents/
  hooks/       ← the dual-target hook engine: logic/ + templates.mjs + lint-generators/
adapters/      ← per-tool wrappers off the one core; no logic duplicated
  claude-code/ ← .claude/skills + .claude/agents (generated) · hooks/ + workflows/ (authored engine)
  opencode/    ← .opencode/skills + .opencode/agents (generated) · plugin/ (authored engine)
scripts/       ← install / sync / gen-adapters / check-genericity / test-hook-engine
workflow.config.example.yaml   ← config schema (copy → workflow.config.yaml)
hooks.policy.example.json      ← hook-policy schema (setup writes hooks.policy.json)
```

Each **skill/agent** wrapper is a few lines: the tool's required frontmatter plus a
pointer to the matching `core/**` body — generated from a manifest. Each **hook**
adapter is a thin shell that imports the shared logic core and translates one tool's
block mechanism. Either way, logic lives once — fix it in `core/` and every tool inherits it.

## Enforcement — dual-target hook engine

Skills are procedures; some rules must be **enforced**, not suggested. Every enforceable
invariant is written once in `core/hooks/logic/` and enforced in **both** Claude Code (a
`.mjs` hook, `exit 2` / `decision:block`) and opencode (a plugin, `tool.execute.before` →
throw) off that one core — no twin drift. The library covers git actions (branch name,
protected ref, ticket ref, no `--no-verify`, forbidden trailers, large binaries), content
(em dash, banned phrases, secrets), and the proactivity guard (a re-injected reminder +
a model-configurable turn review). Code-level policies route to a **real ESLint / Roslyn /
ruff rule** where the stack supports it; the content hook is the fallback. All policy lives
in `hooks.policy.json` (JSON, zero runtime deps) — **no SDLC constant is baked in**, so a
machine that bans an authorship trailer and one that requires it are one field apart. See
`core/hooks/README.md`; `node scripts/test-hook-engine.mjs` proves it end to end.

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

`core/**` and the authored engine adapters (`adapters/*/hooks`, `adapters/*/plugin`,
`adapters/claude-code/workflows`) must never contain a project-specific string **or** a
hardcoded SDLC policy constant. CI runs `node scripts/check-genericity.mjs`, which fails the
build on two classes of leak:

1. **Project strings** — any project name, brand, author handle, or absolute machine path.
2. **Policy constants** — a `Co-Authored-By` commit trailer, the `gh` tracker CLI, a
   squash-only merge, or a literal branch prefix baked in instead of read from config. A
   policy line is allowed only when it also carries a `{{config.*}}` reference (so the
   behavior is genuinely parameterized and the constant is just an inline illustration).

This is what keeps the pack reusable — project specifics *and* git policy belong in
`workflow.config.yaml`, always.

## Maintaining the pack

- Skill + hook logic lives once in `core/`. Edit there; every adapter inherits the change.
- The **skill/agent** adapters are generated from a manifest — after changing the roster,
  run `node scripts/gen-adapters.mjs` and commit the regenerated `skills/` + `agents/` trees.
  The **hook engine** adapters (`hooks/`, `plugin/`, `workflows/`) are authored shells and are
  preserved across regeneration — edit them directly.
- `node scripts/check-genericity.mjs` and `node scripts/test-hook-engine.mjs` must stay green;
  CI runs both on every push and PR.

## License

MIT © 2026 Thomas Luizon Rodrigues Gregorio
