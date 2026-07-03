# Stories: Break a PRD or plan into issues (tracer-bullet vertical slices)

> **Config inputs:** `config.repos`, `config.issueTracker.host`, `config.issueTracker.repo`, `config.issueTracker.labels`, `config.issueTracker.milestones`

Break a PRD, spec, or plan into independently grabbable issues, each a **thin vertical slice** (a tracer bullet) that cuts end-to-end through every relevant layer. Mirror them to a local stories file, then — after an explicit approval gate — create issues in the tracker.

**Usage**: `stories <path-to-prd-or-plan> [--milestone "<name>"] [--no-create]`

- `--milestone <name>` — assign every issue to this milestone (created if missing, when the tracker supports milestones).
- `--no-create` — write the local stories file only; skip issue creation entirely.

---

## Conventions

### Single backlog

All issues live in `{{config.issueTracker.repo}}` on tracker host `{{config.issueTracker.host}}` — one backlog hub, even for work that only touches one repo. A repo-routing label (below) tells downstream skills which repo(s) in `{{config.repos}}` each issue touches.

### Labels

Apply the labels defined in `{{config.issueTracker.labels}}` (leave issues unlabelled if that list is empty). Use them to encode, at minimum, **which repo role(s)** an issue touches (matched against the `role` values in `{{config.repos}}`) and its **type** (feature / enhancement / bug / tech / spike). If the project mirrors surfaces, a label also flags any slice that must update every mirrored surface together.

### Tracker host

Describe issue creation tool-neutrally and adapt to `{{config.issueTracker.host}}`:

- **github** — `gh issue create --repo {{config.issueTracker.repo}} --title … --body-file … --label … --milestone …`; labels via `gh label`, milestones via `gh api …/milestones`.
- **gitlab** — `glab issue create` (labels `--label`, milestone `--milestone`).
- **linear** — the Linear CLI/API: create issues in the configured team, map labels to Linear labels, milestones to a project/cycle.
- **none** — skip all creation; the local stories file IS the deliverable regardless of `--no-create`.

---

## Phase 1 — Load

Read the source from the argument. If none was passed, look in order for a PRD under the working PRDs directory (`{{config.paths.prdsDir}}/*`), then a `PRD.md` at repo root, then a tracker issue/URL the user names (fetch it with the host's CLI, e.g. `gh issue view <n> --comments`); otherwise work from the conversation, and if nothing exists, ask which source to use.

Extract: user stories, implementation phases, the Repo Touch Matrix, and API-contract / data-model sections. Parse `--milestone` and `--no-create`.

## Phase 2 — Explore (if needed)

If you have not already explored the affected repos in `{{config.repos}}`, do a focused pass (targeted glob/grep/read) over the feature area so slices land against the real code shape.

## Phase 3 — Draft vertical slices (tracer bullets)

Break the work into **tracer-bullet issues**. Each issue is a thin vertical slice that cuts through every relevant layer end-to-end — schema, API, UI, tests — narrow but complete. Rules:

- Each slice is **demoable or verifiable on its own**.
- Prefer **many thin slices** over a few thick ones.
- Do NOT create horizontal, single-layer slices unless that layer-only work is independently demoable or is an unblocking prerequisite.
- Flush out unknown-unknowns early with a thin end-to-end slice first.
- Establish **blocking relationships explicitly** (a valid DAG).

For each slice capture:

1. **User story** — "As a [user], I want to [action], so that [benefit]".
2. **Acceptance criteria** — 3-5 in Given/When/Then form, testable without re-asking the author.
3. **Complexity** — small (1 file, clear) / medium (multi-file, design choices) / large (cross-cutting). If a slice would take more than ~1-2 days, split it.
4. **Repo scope** — which role(s) in `{{config.repos}}` it touches. A server endpoint + its client consumer can be one cross-repo slice if small, or a server slice that blocks a client slice.
5. **Type** — feature / enhancement / bug / tech / spike.
6. **Dependencies** — blocked-by / blocks.
7. **Interaction mode** — `AFK` (can be implemented and merged without human interaction) vs `HITL` (needs an architectural decision or design review). Prefer `AFK`.

### Slice body template

```markdown
## {Slice Title}

**Type**: feature | enhancement | bug | tech | spike
**Repos**: {roles it touches}
**Complexity**: small | medium | large
**Interaction**: AFK | HITL
**Phase**: {from PRD, if any}
**Mirror-all-surfaces**: yes | no   (yes if a mirrored-surface slice must update every surface)

### User Story
As a {user}, I want to {action}, so that {benefit}.

### Acceptance Criteria
- [ ] Given {context}, when {action}, then {result}
- [ ] Given {context}, when {action}, then {result}
- [ ] Given {context}, when {action}, then {result}

### What To Build
End-to-end behavior of this slice — not a layer-by-layer implementation dump.

### Technical Notes
- Patterns to follow (reference the project's conventions docs, not brittle file paths).
- Validation: lint, type-check, tests for every touched repo.
- Cross-repo order: server change → shared types → client.

### Dependencies
- Blocked by: #{issue} or "none — can start immediately"
- Blocks: #{issue} or "none"
```

Order slices by phase, then dependencies (blockers first), then priority.

## Phase 4 — Validate

- [ ] Every PRD/plan requirement maps to at least one slice.
- [ ] Every slice has a repo scope and testable acceptance criteria.
- [ ] No slice is too large (split if > 1-2 days).
- [ ] Dependencies form a valid DAG.
- [ ] Slices cover the full path where needed: schema → API → shared types → each client → tests.

## Phase 5 — Write the local stories file

Save to `{{config.paths.storiesDir}}/{source-name}.md` containing:
- A summary table (number/placeholder, title, repos, complexity, interaction, depends-on).
- Each slice's full body block from Phase 3.

## Phase 6 — Quiz the user & GATE the creation (HARD)

Present the breakdown as a numbered list. For each slice show: title, type (AFK/HITL), blocked-by, and the user stories it covers. Ask:

- Is the granularity right — too coarse, too fine, or right?
- Are the dependency relationships correct?
- Should any slices merge or split?
- Are the right slices marked HITL vs AFK?

**Iterate until the user approves.** Then, before creating anything, halt with an explicit confirmation:

> About to create {N} issues in `{{config.issueTracker.repo}}`. Confirm?

**Create nothing until the user confirms.** Skip this entire phase — and all creation — if `--no-create` was passed or `{{config.issueTracker.host}}` is `none`; the local stories file is then the deliverable.

## Phase 7 — Create issues

After approval, create issues **in dependency order (blockers first)** so real issue numbers can be referenced in blocked-by fields, using the host mapping above.

1. **Ensure labels exist.** For any label in `{{config.issueTracker.labels}}` missing from the tracker, create it first.
2. **Ensure the milestone exists** (if `--milestone` was passed and the host supports milestones); create it if missing.
3. **Create each issue** with its title, body (from the Phase 3 block), the routing/type labels from `{{config.issueTracker.labels}}`, and the milestone. Capture each returned issue number/URL.
4. **Wire dependencies.** If the host lacks native blocker links, edit each issue body (or comment) to record "Blocked by #B / Blocks #C" using the resolved numbers. Do not modify any parent issue beyond this.

## Phase 8 — Report

```markdown
## Stories Created

**Source**: {prd/plan path}
**Local file**: {{config.paths.storiesDir}}/{name}.md
**Backlog**: {{config.issueTracker.repo}} ({{config.issueTracker.host}})
**Milestone**: {name or "none"}

| # | Title | Repos | Type | Complexity |
|---|-------|-------|------|------------|
| #N | … | {roles} | … | … |

**Total**: {N} issues (or "0 — local stories file only")

### Next step
Pick an issue → run the priming/planning flow (`prime <n>` → `plan <n>`).
```

---

## Tips

- Slices must be independently mergeable; a cross-repo slice lands its paired changes together.
- For a server-only slice, state "no client changes required" explicitly — zero-scope prevents accidental work.
- Reference the PRD section for each slice so reviewers can trace back.
- Do not convert a PRD into architecture-only tasks unless the work truly cannot be sliced vertically.
