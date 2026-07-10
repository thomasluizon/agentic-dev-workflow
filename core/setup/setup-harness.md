# Setup Harness: Research the machine + grill-me interview

> **Machinery (ships beside this body in `setup/`):** `detect.mjs` · `commands.mjs` · `discovery.mjs` · `questions.mjs` · `answers.mjs` · `trackers.mjs` · `docs.mjs`
> **Produces:** a confirmed machine profile, the confirmed repo set, and `harness.answers.yaml` — the resumable interview record, plus the doc-derived normative statements — that the decode → gate → generate step reads next.

**Input**: run inside the project you are standing up. Flags: `--express` (essentials only), `--resume` (continue an interrupted session).

Stand up the harness the way this whole pack was built: **research what the machine already tells you, interview for what it can't, collect the company's own rule docs** — then hand a complete interview record to the decode step. This slice is deliberately **read-only and non-generating**: it inspects and records; it writes nothing enforcing. The tier decomposition, the approval gate, and artifact generation are the **next** step (they read the record this one produces).

## Operating rules

- **Detect, don't ask what you can see.** Run the detectors first and present findings for confirmation. Never ask for something a probe already answered.
- **Read-only, always.** Detection reads files, asks the OS where a binary lives, runs `--version` on known-safe tools, and reads git metadata. It **never** runs a project's test/build/install script, starts a server, or mutates anything. Every inferred command is shown for the user to confirm or correct — you never trust the guess silently.
- **A grill, not a form.** Walk the fixed core question set, but for each node ask only the follow-ups that detection or a prior answer make relevant. Branch on what you learn. One topic at a time; confirm before moving on.
- **Resumable.** Every confirmed answer is written to `harness.answers.yaml` **immediately** (via `answers.mjs set`), so a long session survives interruption. `--resume` continues from the first unanswered question.
- **Never store secrets.** Tokens, keys, passwords never enter `harness.answers.yaml`. For an interactive auth you can't script, record the *command the user should run*, not the credential.
- **Never block.** A dead doc URL, a down MCP, an ambiguous detection → skip, flag it, and continue. The session always completes with a gaps report.
- **Stop before generating.** This slice ends at a complete interview record. Do not write a `CLAUDE.md`, a rule, a hook, or `hooks.policy.json` here — that is the decode step's job, behind its own approval gate.

## Phase 0 — Locate the machinery + resume check

Find the `setup/` directory that ships beside this skill body (the pack's `core/setup/`, its vendored `_core/setup/` copy in an installed project, or the global install a bootstrap placed in `~/.claude`). Call it `SETUP_DIR`; every script below is `node "<SETUP_DIR>/<script>.mjs"`.

Check for an existing `harness.answers.yaml` at the project root:
- **Present and `--resume` (or the user confirms):** load it, read `progress.answeredIds`, and continue from `nextUnanswered`. Re-confirm the machine profile only if stale.
- **Present, no resume intent:** ask keep-and-extend vs restart. Never silently clobber it.
- **Absent:** initialize it — `node "<SETUP_DIR>/answers.mjs" init harness.answers.yaml --mode <express|thorough>`.

Also note any existing `CLAUDE.md` / `AGENTS.md` / hooks / rules the detectors report: they are an **adopt-vs-reset** decode source handled in the next step. Flag them now; don't act on them yet.

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

Walk the fixed core set from `questions.mjs` (thorough = all; `--express` = the `repos / commands / tracker / git-flow` essentials). The topics: **scale · projects-root + repos · per-repo commands · VCS host + tracker · git-flow (branch grammar, protected refs, merge strategy, ticket-ref, review reqs, authorship-trailer policy) · text/style bans · code-level policies · tool defaults · doc sources · prod-investigation · deploy/ship · bespoke flows.**

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

## Handoff — STOP (decode is the next step)

Print the interview summary and **stop**. Do not generate any artifact.

```
## Harness setup — interview complete (records ready to decode)

- **Machine**: {os} · {shell} · CLIs {…} · MCP {…}
- **Repos** ({N}): {name — role — commands} …
- **Tracker**: {host} → {resolved tool} ({cli|mcp|web})
- **Git-flow captured**: branch {…} · protected {…} · merge {…} · ticket {…} · trailers {…}
- **Policies captured**: text bans {…} · code policies {…} · tool defaults {…}
- **Docs**: {L} links · {S} sources · {K} normative statements extracted
- **Record**: harness.answers.yaml ({answered}/{total} questions · mode {…})
- **Existing setup**: {CLAUDE.md/hooks/rules found → adopt-vs-reset pending} or "none — greenfield"
- **Gaps / deferred**: {dead doc link, down MCP, skipped question} …

Next: decode → gate → generate — classify every captured rule + normative statement to
its enforcement tier, present the editable decomposition table for approval, and only then
write CLAUDE.md / rules / hooks / config. Nothing enforcing has been written yet.
```

## Suggested next step

Run the decode + gate step against `harness.answers.yaml` to tier every captured rule and present the approval table.
