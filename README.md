# agentic-dev-workflow

A **smart, AI-installed development harness** for agentic coding tools. You don't
hand-fill a config — you `git clone`, run one bootstrap, then run **`/setup-harness`**
inside any project. The skill researches the machine, interviews you like a grill
session, decodes your company's own rule docs, and generates a harness tailored to
that project: **hooks** for what must be enforced, **skills** for procedures,
**rules/facts** for the rest — all decoded to the tier that actually holds.

Nothing in the portable core knows your project's name, paths, stack, vendors, or SDLC
policy. A machine that **bans** co-authored commits and one that **requires** them are a
single interview answer apart. The genericity CI gate proves the core carries zero
project strings and zero baked-in policy constants.

## The two layers — CORE vs OVERLAY

| | CORE (ships in this repo) | OVERLAY (generated per project by `/setup-harness`) |
|---|---|---|
| **What** | The behavioral baseline + proactivity guard, the generic pipeline / review / intake / research / ops / meta skills, the `second-opinion` skill, the dual-target hook-template library, and `/setup-harness` itself. | `CLAUDE.md` facts, `.claude/rules/*`, `hooks.policy.json` (dual-target enforcement), lint scaffolds, `workflow.config.yaml`, machine-specialized skills. |
| **Where** | `~/.claude` (machine-wide), installed once by `bootstrap.mjs`. | `<project>/.claude` + project root, decoded from your interview + docs. |
| **Portable?** | Yes — no project strings, no policy constants. | No — it *is* your project's policy. |

The interview only ever **adds** to the CORE baseline; it never replaces it. The
disposition (verify-don't-guess, do-it-yourself, best-implementation) is auto-applied on
every machine, before and independent of any company overlay.

## Install (the normal path)

```bash
git clone https://github.com/thomasluizon/agentic-dev-workflow
cd agentic-dev-workflow
node bootstrap.mjs          # or: node scripts/bootstrap.mjs
```

`bootstrap.mjs` (cross-platform — Windows / macOS / Linux, no bash-isms):

1. **Hard-checks Node** is present and new enough (18+).
2. **Copies** — never symlinks, so it survives moving or deleting the clone — the Claude
   Code CORE (skills + agents + hooks + workflows + the vendored `_core` bodies/logic)
   into `~/.claude`. It replaces only the skills it owns; your other `~/.claude` skills
   are left untouched.
3. Installs the **behavioral baseline** as a global auto-loading rule.
4. Wires the machine-wide **proactivity guard** into `~/.claude/settings.json`
   (idempotent, backed up; skip with `--no-hooks`).
5. Records **`~/.claude/harness.bootstrap.json`** — a versioned manifest of exactly what
   it installed, so re-running `bootstrap.mjs` **updates in place** and prunes anything
   the pack dropped.

Then, in any project you want the harness on:

```bash
cd /path/to/your-project
# in your agentic tool (Claude Code / opencode):
/setup-harness            # add --express for a fast essentials-only pass
```

`/setup-harness` runs a gated runbook: **research → discover repos → interview → collect
docs → decode every rule to its tier → present an editable decomposition table (the
gate) → on approval, generate + self-verify.** Nothing enforcing is written before you
approve the table. It resumes from `harness.answers.yaml` if interrupted, and offers an
**adopt-vs-reset** path (with a timestamped backup) for a project that already has a
bloated `CLAUDE.md`/hooks.

Honors `CLAUDE_CONFIG_DIR` if you keep your Claude config somewhere other than `~/.claude`.

## The lifecycle — config, answers, manifest, sync

`/setup-harness` records three durable files at the project root, and never asks you to
hand-edit the machine-managed ones:

| File | Role | Hand-edit? |
|---|---|---|
| `harness.answers.yaml` | The resumable interview record — every confirmed answer + the doc-derived rules. **No secrets.** Everything is re-decoded deterministically from here. | AI-managed |
| `harness.manifest.json` | Ties every generated artifact to the answers rows it came from + its content hash, so a re-run/`sync` can tell a hand-edit from a stale file. | AI-managed |
| `workflow.config.yaml` + `hooks.policy.json` | The mechanical values the generic skills read + the runtime enforcement policy. | AI-managed |
| `CLAUDE.md`, `.claude/rules/*`, lint scaffolds, specialized skills | Facts, guidance, and procedures you *are* meant to refine. | Yours — preserved |

**Keep an installed project current:**

```bash
node scripts/sync.mjs --into /path/to/your-project
```

`sync` does two things, each optional: it **refreshes CORE** if the project self-vendored
it (see below), then **re-applies the overlay** by re-decoding `harness.answers.yaml`,
honoring the approved decomposition, and **preserving every hand-edit** the manifest
detects — the AI-managed policy/config refresh freely, but a hand-edited `CLAUDE.md` or
rule is never clobbered without `--force`.

**Two entry points, one refresh model:** re-running `/setup-harness` is the *reactive*
update — you know a process changed and bring it (it decodes only the delta, gated).
`node scripts/sync.mjs` is the *deterministic* re-apply from the saved answers. Refresh
the machine-wide CORE itself by re-running `node bootstrap.mjs`.

## Enforcement — the dual-target hook engine

Skills are procedures; some rules must be **enforced**, not suggested. Every enforceable
invariant is written once in `core/hooks/logic/` and enforced in **both** Claude Code (a
`.mjs` hook, `exit 2` / `decision:block`) and opencode (a plugin, `tool.execute.before` →
throw) off that one core — no twin drift. The template library covers git actions (branch
name, protected ref, ticket ref, no `--no-verify`, forbidden trailers, large binaries),
content (em dash, banned phrases, secrets), and the proactivity guard. Code-level policies
route to a **real ESLint / Roslyn / ruff rule** at the strongest layer the stack supports;
the content hook is the fallback. All policy lives in `hooks.policy.json` (JSON, zero
runtime deps) — **no SDLC constant is baked in**. See `core/hooks/README.md`.

## What's in the CORE

| Group | Skills |
|---|---|
| **Pipeline** | `prime` · `grill` · `plan` · `implement` · `validate` · `execute` · `ship` · `clean` |
| **Review** | `pr-review` · `audit-security` · `audit-tests` · `audit-performance` · `audit-code-quality` · `thermo-nuclear` · `prod-readiness` · `second-opinion` |
| **Intake** | `feature` (idea → PRD → issues) · `prd` (warm or cold) · `stories` (PRD → tracer-bullet issues) |
| **Research** | `deep-research` · `llm-council` |
| **Ops** | `investigate` (root-cause a prod incident end to end, read-only until a human gate) |
| **Meta** | `handoff` (compact a session to resume clean) · `lesson` (capture a correction as a graduating gate) |
| **Setup** | `setup-harness` (research → discover → interview → doc decode → tier every rule → the editable gate → generate + self-verify) |
| **Agents** | `security-reviewer` (generic; parity / i18n / contract checks are config-gated inside `pr-review`) |

`execute` is the gated conductor (`issue → prime → grill → plan → implement`) with hard,
default-deny stage gates. Every review/audit skill shares one `verification-protocol`
(coverage contract → adversarial verify → loop-until-dry → deferred ledger) and one
behavioral baseline in `core/_shared/`. The pipeline skills stay generic and read
`workflow.config.yaml` at runtime, so a single source in `core/` drives every project.

## Architecture

```
core/          ← tool-agnostic skill bodies + hook logic — the SINGLE source of truth
  _shared/     ← verification-protocol + behavioral-baseline (read by many skills)
  pipeline/ review/ intake/ research/ ops/ meta/ agents/
  hooks/       ← the dual-target hook engine: logic/ + templates.mjs + lint-generators/
  setup/       ← setup-harness runbook + detect/discover/interview + decode/gate/generate/adopt/manifest/verify
adapters/      ← per-tool wrappers off the one core; no logic duplicated
  claude-code/ ← .claude/skills + .claude/agents (generated) · hooks/ + workflows/ (authored engine)
  opencode/    ← .opencode/skills + .opencode/agents (generated) · plugin/ (authored engine)
scripts/
  bootstrap.mjs   ← install/update the CORE globally into ~/.claude (the normal path)
  install.mjs     ← vendor CORE + an adapter into ONE project (self-contained installs)
  sync.mjs        ← refresh an installed project: re-vendor CORE + re-apply the overlay
  gen-adapters / check-genericity / test-* (the CI gates)
```

Each **skill/agent** wrapper is a few lines: the tool's required frontmatter plus a
pointer to the matching `core/**` body — generated from a manifest. Each **hook** adapter
is a thin shell that imports the shared logic core. Fix logic once in `core/` and every
tool inherits it.

## Advanced — per-project vendored install

`bootstrap.mjs` installs CORE globally (the recommended model). If you instead want a
project to carry a **self-contained, pinned** copy of the pack — useful for opencode,
which reads `.opencode/plugin/` per project, or for reproducible CI — vendor it in:

```bash
node scripts/install.mjs --tool claude-code --into /path/to/your-project
#                         --tool opencode
node scripts/install.mjs --tool claude-code --into /path/to/your-project --dry-run   # preview
```

This copies `core/` and the chosen adapter into the project (`.claude/skills/_core/` or
`.opencode/skills/_core/`) and writes `skills-lock.json` pinning what was installed.
`node scripts/sync.mjs --into <project>` then re-vendors that copy **and** re-applies the
overlay in one pass.

## Genericity guarantee

`core/**` and the authored engine adapters must never contain a project-specific string
**or** a hardcoded SDLC policy constant. CI runs `node scripts/check-genericity.mjs`,
which fails the build on two classes of leak:

1. **Project strings** — any project name, brand, author handle, or absolute machine path.
2. **Policy constants** — a `Co-Authored-By` commit trailer, the `gh` tracker CLI, a
   squash-only merge, or a literal branch prefix baked in instead of read from config. A
   policy line is allowed only when it also carries a `{{config.*}}` reference.

## Maintaining the pack

- Skill + hook logic lives once in `core/`. Edit there; every adapter inherits the change.
- The **skill/agent** adapters are generated — after changing the roster, run
  `node scripts/gen-adapters.mjs` and commit the regenerated `skills/` + `agents/` trees.
  The **hook engine** adapters (`hooks/`, `plugin/`, `workflows/`) are authored shells,
  preserved across regeneration — edit them directly.
- CI runs every gate on push + PR: `check-genericity`, `test-hook-engine`, `test-setup`,
  `test-generate`, `test-wiring`, `test-bootstrap`, and the adapters-in-sync check. All
  must stay green.

## License

MIT © 2026 Thomas Luizon Rodrigues Gregorio
