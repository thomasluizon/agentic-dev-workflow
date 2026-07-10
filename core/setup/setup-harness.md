# Setup Harness: research → interview → decode → gate → generate

> **Machinery (ships beside this body in `setup/`):** `detect.mjs` · `commands.mjs` · `discovery.mjs` · `questions.mjs` · `answers.mjs` · `trackers.mjs` · `docs.mjs` · `decode.mjs` · `gate.mjs` · `generate.mjs` · `config.mjs` (two-layer resolve + store) · `../hooks/logic/store.mjs` (repo-clean out-of-repo store) · `adopt.mjs` · `manifest.mjs` · `verify.mjs`
> **Produces:** a confirmed machine profile + repo set, the resumable `harness.answers.yaml` record, and — after an approval gate — the generated harness: `CLAUDE.md`, `.claude/rules/*`, dual-target hooks (`hooks.policy.json`), lint rules, `workflow.config.yaml`, machine-specialized skills, a versioned `harness.manifest.json`, and a self-verify report. In **repo-clean mode** all of those live in the out-of-repo store instead, and NOTHING is written into the repo.

**Input**: run inside the project you are standing up. Flags (all optional accelerators — every one has an interview question that is asked and confirmed regardless): `--express` (essentials only), `--resume` (continue an interrupted session), `--global` (write the machine-wide DEFAULTS layer, not a project overlay — see "Two-layer config" below), `--repo-clean` (pre-select repo-clean install mode — see "Repo-clean mode" below).

Stand up the harness the way this whole pack was built: **research what the machine already tells you, interview for what it can't, collect the company's own rule docs, decode every rule to its enforcement tier, and — only after you approve the decomposition — generate the tailored harness.** The interview half (phases 0–5) is read-only. The generate half (phases 6–10) is **gated**: nothing enforcing is written until you sign off on the decomposition table.

## Operating rules

- **Detect, don't ask what you can see.** Run the detectors first and present findings for confirmation. Never ask for something a probe already answered.
- **Read-only until the gate.** Detection reads files, asks the OS where a binary lives, runs `--version` on known-safe tools, and reads git metadata. It **never** runs a project's test/build/install script, starts a server, or mutates anything. Every inferred command is shown for the user to confirm or correct — you never trust the guess silently.
- **A grill, not a form.** Walk the fixed core question set, but for each node ask only the follow-ups that detection or a prior answer make relevant. Branch on what you learn. One topic at a time; confirm before moving on.
- **Resumable.** Every confirmed answer is written to `harness.answers.yaml` **immediately** (via `answers.mjs set`), so a long session survives interruption. `--resume` continues from the first unanswered question.
- **Never store secrets.** Tokens, keys, passwords never enter `harness.answers.yaml`. For an interactive auth you can't script, record the *command the user should run*, not the credential.
- **Never block.** A dead doc URL, a down MCP, an ambiguous detection → skip, flag it, and continue. The session always completes with a gaps report.
- **Gate before generating.** Nothing enforcing — no `CLAUDE.md`, rule, hook, or `hooks.policy.json` — is written before the user approves the decomposition table (phase 8). Precedence on any conflict is **always-ask**: never auto-resolve.

## Phase 0 — Locate the machinery + resume check

Find the `setup/` directory that ships beside this skill body (the pack's `core/setup/`, its vendored `_core/setup/` copy in an installed project, or the global install a bootstrap placed in `~/.claude`). Call it `SETUP_DIR`; every script below is `node "<SETUP_DIR>/<script>.mjs"`.

Check for an existing `harness.answers.yaml` at the project root:
- **Present and `--resume` (or the user confirms):** load it, read `progress.answeredIds`, and continue from `nextUnanswered`. Re-confirm the machine profile only if stale.
- **Present, no resume intent:** ask keep-and-extend vs restart. Never silently clobber it.
- **Absent:** initialize it — `node "<SETUP_DIR>/answers.mjs" init harness.answers.yaml --mode <express|thorough>`.

Also note any existing `CLAUDE.md` / `AGENTS.md` / hooks / rules the detectors report: they are an **adopt-vs-reset** decode source handled in **Phase 6**. Flag them now; don't act on them yet.

## Phase 1 — Research the machine

Run the detector and read its JSON:

```
node "<SETUP_DIR>/detect.mjs" --dir <project-root>
```

It reports: OS + shell; installed CLIs (vcs / forge / runtime / package-manager / container / automation, each with version); git remotes + inferred forge host; existing CI config; existing convention/agent docs; connected MCP servers (from `~/.claude.json`); and — via `commands.mjs` — the inferred test/lint/typecheck/build commands for the repo, each with the manifest and evidence it came from.

Present a tight summary and **confirm the inferred commands** (each carries a `confidence`; scrutinize the `low` ones — they are stack defaults, not named scripts). Record the confirmed machine profile with `answers.mjs`.

## Phase 2 — Repo discovery

```
node "<SETUP_DIR>/discovery.mjs" --dir <project-root> --projects-root <folder-if-known>
```

It returns the current repo, its workspace members (npm/pnpm workspaces or a `.sln`/`.slnx` project list), and — if you pass a projects-root — the sibling repos under it. Ask the user for a **projects-root** if you don't have one ("a folder with all your repos inside" is a valid answer); scan it and present the union. **Confirm the repo set once.** For each in-scope repo, run command inference (Phase 1's `commands.mjs`) and confirm per-repo commands. Record `repos[]`.

## Phase 3 — The adaptive interview

Walk the fixed core set from `questions.mjs` (thorough = all; `--express` = the `install-mode / repos / commands / tracker / git-flow` essentials). The topics: **install mode · scale · projects-root + repos · per-repo commands · VCS host + tracker · git-flow (branch grammar, protected refs, merge strategy, ticket-ref, review reqs, authorship-trailer policy) · text/style bans · code-level policies · tool defaults · doc sources · prod-investigation · deploy/ship · bespoke flows.**

**Install mode is the FIRST question** (`installMode`) and it decides *where* everything lands, so ask it up front. Pre-fill a recommendation from detection — a locked or scanned checkout, or a stated policy that no AI/Claude file may be added or committed to a repo, recommends **repo-clean**; otherwise **in-repo committed** (the default) — then confirm. The three modes:

- **in-repo committed** (default, current behavior): artifacts are generated at the project root (`CLAUDE.md`, `.claude/*`, `workflow.config.yaml`, `hooks.policy.json`) and committed.
- **in-repo gitignored**: the same files, but added to `.gitignore` so they live in the working dir without being committed. Use when commits are policed but untracked files are fine.
- **repo-clean / global-only**: NOTHING is written into the repo — every artifact lives in the out-of-repo store under `~/.claude`, keyed to this repo's git root. Use on a machine that forbids any AI/Claude file in a checkout. See "Repo-clean mode" below; it changes Phase 9's generate + wire steps.

The `--repo-clean` flag only pre-selects the answer; the question is still asked and confirmed.

For each question:
1. Pre-fill from detection where possible; state the guess and ask to confirm/correct rather than asking cold.
2. Ask the **active follow-ups only** — the ones `activeFollowups(question, { detect, answers })` returns for this machine, where `detect` is the merged machine + discovery profile (so a workspace-member follow-up can fire) and `answers` is the running record. (Enterprise scale → security-tier scoping; a Jira MCP → ticket-format; a linted stack → "make this a real lint rule, not a note"; workspace members present → which are in scope; and so on.)
3. Record each confirmed answer immediately: `node "<SETUP_DIR>/answers.mjs" set harness.answers.yaml <answersKey> '<json>'`.

Keep every policy question **neutral** — authorship trailers may be required, banned, or ignored; a merge may be squash, rebase, or a merge commit; the pack assumes none of these. Capture path-scopes and exceptions when a rule has them (a ban that applies to docs but not a changelog is a scope, not a disabled rule).

## Phase 4 — Doc sources

Ask for two things:
- **Explicit links** — specific pages that carry policy (a standards page, a handbook section).
- **A taught doc-source** — *where* such docs live (a Confluence space, a wiki base, a docs repo) so you can search it for relevant standards over time.

Classify each pointer with `docs.mjs classify`. For each **link**, fetch it (a connected Confluence/Notion MCP if the page needs auth; otherwise WebFetch). For each **source**, search it for the topics the interview surfaced (git flow, security, style) and fetch the hits. Run each fetched page's text through:

```
node "<SETUP_DIR>/docs.mjs" extract <saved-text-file>
```

to pull every normative statement ("must / never / always / required", hard vs soft). Review the list, drop false hits, and record the survivors with `answers.mjs recordNormative` (source + text + strength). These are the candidate rules the decode step tiers. A dead link is skipped and flagged for retry, never fatal.

## Phase 5 — Resolve the per-tracker best tool

From the confirmed tracker host + the detected inventory, resolve the best driver:

```
resolveTracker(host, { clis, mcp })   // trackers.mjs
```

This is **per-tracker best-tool, by availability** — GitHub → its CLI when present, else its MCP, else the API; Jira → an Atlassian/Jira MCP, else the `jira` CLI; Linear → its MCP; each with a web/API fallback. Confirm the pick with a live auth probe (e.g. the CLI's own `auth status`) and record `tracker` (host + chosen tool). This binding is what the pipeline's issue-creating skills use later — not a hardcoded assumption.

## Phase 6 — Adopt-vs-reset (only if an existing setup was found)

If Phase 0 flagged an existing `CLAUDE.md` / hooks / rules, **ask reset-vs-adopt** before decoding.

- **Reset** — ignore the old content; decode only the interview + docs.
- **Adopt** — refactor the bloat into tiers, losing nothing:
  1. `node "<SETUP_DIR>/adopt.mjs" backup <project-root>` — copies the existing artifacts to `.harness-backup/<timestamp>/` (nothing is deleted; this is the safety net).
  2. `node "<SETUP_DIR>/adopt.mjs" decompose <project-root>` — turns the old prose (CLAUDE.md, AGENTS.md, the rules dir) into **decode candidates** (each a normative statement) and reports the existing hooks as already-enforced.

Pass the decompose candidates into the decode step as `existing` so the old rules are re-tiered alongside the new ones — a bloated `CLAUDE.md` line that is really an enforceable rule becomes a hook; a stale note is dropped at the gate.

## Phase 7 — Decode into tiers

Classify **every** captured rule — the interview answers, each doc-derived normative statement, and any adopt candidates — to its authority tier:

```
node "<SETUP_DIR>/decode.mjs" decode harness.answers.yaml
```

The rule of thumb (`decode.mjs` applies it deterministically; you sanity-check and adjust at the gate):

- **enforcement → HOOK** (a git-action or content gate) — or a **real LINT rule at the strongest layer** (`lint-generators/`) when the repo's stack has a linter that expresses it.
- **procedure → SKILL** (machine-specialize `investigate`/`ship`, or propose a new skill from a described flow).
- **facts / conventions → CLAUDE.md (FACT)** or a re-injected **RULE**.
- **proactive tool default → an unscoped RULE** ("always use the AWS CLI", "use the Jira MCP").

The decode also **flags conflicts inline** — where the interview, the config, and a doc disagree on the same subject (a banned trailer vs a required one, two branch regexes). Precedence is **always-ask**: nothing is auto-resolved.

## Phase 8 — The approval gate (the editable decomposition table)

Write the ONE decomposition table and hand it to the user:

```
node "<SETUP_DIR>/gate.mjs" render harness.answers.yaml   # writes harness.decomposition.md
```

`harness.decomposition.md` lists every rule with its proposed **Tier** and **Action** (`enforce` / `soften` / `drop`), path-scopes/exceptions, and any conflict flagged with ⚠. **The user edits the Tier and Action columns** (softening a hook to an advisory rule, dropping a false hit, picking a winner for a conflict) and then says **go**. Re-read the edited file with `parseGateTable` + `applyEdits`, and confirm `pendingConflicts` is empty — **do not proceed while any conflict is unsettled**. Nothing enforcing has been written yet.

## Two-layer config — machine defaults vs project overrides

On a PC where **every project follows the same conventions**, you don't re-answer the machine-wide questions each repo. The mechanical config layers, exactly like the hook policy:

- **Global (`~/.claude/workflow.config.yaml`)** — machine/company defaults: tracker host + driver, branch grammar, merge strategy, forbidden trailers, tool defaults, audit scale, the enforcement mirror. Written once by **`/setup-harness --global`**, which generates the *global slice* (`generate.mjs` → `planGlobalArtifacts`) plus a global `~/.claude/hooks.policy.json`, and — with `node bootstrap.mjs --enforce-globally` (or automatically on the next `bootstrap` once that global policy exists) — wires the git/content guardrails machine-wide so enforcement holds in every repo.
- **Project (`<project>/workflow.config.yaml`)** — only this repo's `repos[]`, name, conventions, and any overrides. When a global layer exists, a project run writes the **lean project slice** (`planArtifacts` with `configScope: "project"`), not the full config.

Skills read the **effective** config = global merged with project (**project wins**): `node "<SETUP_DIR>/config.mjs" resolve --dir <project>`. `loadPolicy` merges the policy the same way (`DEFAULT < global < store < project`). So machine-wide facts/tool-defaults (via a global `~/.claude/CLAUDE.md` + `~/.claude/rules/*`) AND machine-wide enforcement both hold, and a new repo only needs its `repos[]`.

## Repo-clean mode — the out-of-repo store

On a machine where the repo working directory must stay pristine (a company PC that forbids adding — or committing — any AI/Claude file in a checkout), the whole overlay lives OUTSIDE the repo. There is no native per-project out-of-repo mechanism for the FACT/instructions tier (`~/.claude/CLAUDE.md` and `~/.claude/rules/*` load for *every* project; a rule's `paths:` scopes by file glob, not repo root), so repo-clean mode adds one: a store keyed by the repo's absolute git root, plus a global `UserPromptSubmit` hook that injects that project's facts by cwd.

- **Store** (`~/.claude/harness/`, honoring `CLAUDE_CONFIG_DIR`): `index.json` (`{ "<abs repo root>": { slug, mode } }`) + `projects/<slug>/{workflow.config.yaml, hooks.policy.json, facts.md, rules/*, harness.answers.yaml, harness.manifest.json, harness.mode}`. The slug is a deterministic sanitized abs path (`store.mjs slugForPath`, Claude Code's own `~/.claude/projects/<encoded>` convention) so a hook computes the entry path from cwd with no index read; the index is only for listing/migration/collision.
- **Root + worktrees:** the entry is keyed by the git root resolved with a pure-fs `.git` walk-up (`store.mjs resolveRepoRoot`). A linked worktree's `.git` FILE is followed to the MAIN worktree root, so every worktree of one repo shares a single store entry.
- **Precedence:** the store sits just below the in-repo layer — `DEFAULT < global < store < in-repo` for both config (`resolveConfig`) and policy (`loadPolicy`). In-repo always wins; a mode-1/mode-2 repo has no store entry, so it is completely unaffected.
- **Delivery is dual-target and cwd-keyed for free:** the config + enforcement tiers already key off cwd (the CC hooks and the opencode plugin both pass it), so they resolve the store with no new mechanism. Only the FACT/RULE tier needs a built injector — the CC `project-facts.mjs` UserPromptSubmit hook and the opencode `experimental.chat.system.transform` hook, both calling the one `store.mjs buildInjectedContext`.

**Two known constraints (documented, never silent — surface them in the gaps report):**

- **LINT tier:** a code policy a linter could express as a real rule cannot be wired into the pristine repo (no repo file). The rule is recorded in the store for the record, and enforcement falls back to the content-scan hook on the store policy. Each such row appears in the gaps report.
- **SKILL tier:** the machine-specialized `investigate`/`ship` skills are machine-wide — install them via `/setup-harness --global` (they live under `~/.claude/skills`). A bespoke project skill is written to the store for record + sync and is surfaced by the fact injector, but it is NOT auto-discovered as a slash command (Claude Code discovers skills only under `~/.claude/skills` or `<repo>/.claude/skills`).

**Migrating between modes.** To move a project from one mode to another, re-run `/setup-harness` and choose the target mode. Then clean up the OLD location, **manifest-guided and gated**: read the previous `harness.manifest.json` and remove ONLY the artifacts it lists (a hand-edited file is surfaced for the user to salvage first, never silently deleted), so files the harness did not generate are never touched. Moving *into* repo-clean removes the in-repo `CLAUDE.md`/`.claude/*`/`workflow.config.yaml`/`hooks.policy.json` the old manifest owned; moving *out of* repo-clean removes the store entry (`store.mjs` entry dir + its `index.json` row) after the in-repo overlay is generated. Confirm the deletion list before acting.

## Phase 9 — Generate + wire (after approval)

**Branch on the install mode chosen in Phase 3:**

- **in-repo committed** (default): generate at the project root as below and commit.
- **in-repo gitignored**: identical, then add the generated paths to the repo's `.gitignore` instead of committing them.
- **repo-clean**: generate into the out-of-repo store and write ZERO files to the repo. Steps:
  1. **Ensure the global install** — repo-clean requires it. If `~/.claude/harness.bootstrap.json` is missing, run `node bootstrap.mjs` (it also wires the fact injector). Then wire machine-wide enforcement: `node bootstrap.mjs --enforce-globally` (the git/content guardrails must fire in every repo, since the store policy has no in-repo `hooks.policy.json` to trigger the per-project wiring). Both are idempotent and backed up.
  2. **Register the entry** — `store.mjs registerStoreEntry(repoRoot, { mode: "repo-clean" })` records `index.json` + writes `harness.mode`. Compute `repoRoot` with `store.mjs resolveRepoRoot(<project>)`.
  3. **Generate to the store** — `planArtifacts(answers, approved, { stack, layout: "store", configScope })` remaps `CLAUDE.md`→`facts.md`, `.claude/rules/*`→`rules/*`, `.claude/skills/*`→`skills/*`, and writes with `writeArtifacts(plan, storeEntryDir(repoRoot))`. Use `configScope: "full"` (the store config is self-contained) unless a `--global` layer exists, then `configScope: "project"` for the lean slice. Write `harness.answers.yaml` + `harness.manifest.json` into the same store entry dir.
  4. **Verify from the store** — the facts injector now emits this project's facts for its cwd; `resolveConfig`/`loadPolicy` resolve the store layer; the guardrail dry-run blocks a protected-branch push via the store policy (Phase 10, pointed at the store entry).

From the approved decomposition, generate every artifact. In a normal (project) run use `generate.mjs` → `planArtifacts` (`writeArtifacts` commits it); in a `--global` run use `planGlobalArtifacts` and write to `~/.claude`; in a repo-clean run use `planArtifacts(..., { layout: "store" })` and write to the store entry:

- **`hooks.policy.json`** — the dual-target enforcement policy the Claude Code hooks **and** the opencode plugin both read (filled from the enforce rows via the template library).
- **`workflow.config.yaml`** — the mechanical values the generic pipeline skills read (repos + commands, branch/merge/tracker conventions, the `hooks:` mirror). AI-managed; never hand-edited.
- **`CLAUDE.md`** — the FACT tier (project + repo facts, conventions).
- **`.claude/rules/*.md`** — the RULE tier + a `tool-defaults.md` for the proactive defaults.
- **lint scaffolds** (`.harness/lint/**`) — a real ESLint/Roslyn/ruff rule per code policy a linter can express; wire each into the repo's lint config (flagged in the gaps report).
- **machine-specialized skills** (`.claude/skills/investigate`, `ship`) bound to this machine's tools, and **new skills** proposed from described bespoke flows.

Then record the **versioned manifest**:

```
node "<SETUP_DIR>/manifest.mjs"   # via generate — writes harness.manifest.json
```

`harness.manifest.json` ties every generated file to the answers rows it came from and stores its hash, so a re-run or `sync` can `detectHandEdits` and **preserve hand-edits** (ask before clobbering a changed hand-editable file; refresh the AI-managed policy/config freely).

## Phase 10 — Self-verify + gaps report

Prove the harness actually stands up (`verify.mjs run` — in repo-clean mode point its `root` at the store entry dir, since that is where the generated files live):

- `workflow.config.yaml` parses; `hooks.policy.json` parses and has the expected shape.
- Every generated skill/rule loads.
- **Guardrail dry-run** — feed the real logic core the generated policy and a simulated push to a protected branch: it must **BLOCK** (and an ordinary feature push must pass, so a rule that blocks everything is caught too).

Report pass/fail per artifact, then print the completion summary. **Never-block holds to the end**: a failed check is reported, not raised — the user decides.

```
## Harness setup — complete

- **Machine**: {os} · {shell} · CLIs {…} · MCP {…}
- **Mode**: {in-repo committed | in-repo gitignored | repo-clean → ~/.claude/harness/projects/{slug}}
- **Repos** ({N}): {name — role — commands} …
- **Tier tally**: {H} hooks · {L} lint rules · {R} rules · {F} facts · {S} skills
- **Generated**: hooks.policy.json · workflow.config.yaml · CLAUDE.md · {R} rules · {S} skills
- **Adopt**: backed up to {.harness-backup/…} or "greenfield — nothing to back up"
- **Self-verify**: {P}/{T} checks passed · guardrail dry-run {BLOCK ✓ | ✗}
- **Gaps / deferred**: {lint scaffold to wire, dead doc link, dropped/softened rule, unresolved conflict} …

The harness is live. Re-run `/setup-harness` when a process changes (it decodes only the delta);
run `/update-harness` monthly for web-grounded staleness.
```
