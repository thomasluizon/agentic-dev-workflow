# Implementation Plan Generator

> **Config inputs:** `config.repos`, `config.conventionsDocs`, `config.issueTracker.host`, `config.issueTracker.repo`, `config.issueTracker.driver`, `config.worktree.root`, `config.worktree.branchPattern`, `config.parity`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: the issue number(s), feature description, or PRD path the caller passed, plus optional `--research` / `--no-research`.

## Objective

Transform the input into a context-rich, battle-tested implementation plan.

**Core Principle**: PLAN ONLY — no code written.
**Order**: CODEBASE FIRST. Solutions must fit existing patterns across every repo in `{{config.repos}}`.

## Mode detection (do this first)

First strip any `--research` / `--no-research` flag from the input (it controls Phase 2.5 only); the remainder is the plan input. Then count numeric tokens (`123`, `#123`) — split on whitespace OR commas.

| Numeric arg count | Mode |
|---|---|
| 0 or 1 (or any non-numeric input) | **Single-plan** — continue with the phases below. |
| ≥ 2 | **Multi-plan** — jump to the "Multi-plan mode" section. |

---

## Single-plan mode

## Phase 1: PARSE

### Determine Input Type

| Input | Action |
|---|---|
| Numeric (`123`) or `#123` | Fetch the issue from `{{config.issueTracker.repo}}` |
| `.prd.md` file | Read the PRD, extract the next pending phase |
| Other `.md` file | Extract the feature description |
| Free-form text | Use directly |
| Blank | Use conversation context |

### Fetch Issue Context (if numeric)

Fetch the issue from `{{config.issueTracker.repo}}` (host `{{config.issueTracker.host}}`) through the resolved tracker driver `{{config.issueTracker.driver}}` — its number, title, body, labels, and milestone (see `stories` for the per-host driver reference).

Extract:
- Title and body
- Which repo `role`(s) in `{{config.repos}}` the labels route the work to
- Any parity flag (if `{{config.parity.enabled}}`, mirrored surfaces must move together)
- Acceptance criteria from the body

### Extract Feature Understanding

- **Problem**: What we're solving
- **User Story**: As a [user], I want to [action], so that [benefit]
- **Type**: NEW_CAPABILITY / ENHANCEMENT / REFACTOR / BUG_FIX
- **Complexity**: LOW / MEDIUM / HIGH
- **Repos Affected**: which entries of `{{config.repos}}`
- **Tracked Issue**: capture the issue number if known. `implement` will close it after completion.

---

## Phase 2: EXPLORE

### Study the Codebase

Use a broad exploration subagent for breadth. Search each affected repo in `{{config.repos}}` (routed by the issue's labels against each repo's `role`). For each repo, locate:

- The shared/contract layer, if any (types, endpoint constants, query keys).
- Similar feature surfaces and components already in the repo.
- The data-access / hook layer that feeds those surfaces.
- For a backend-role repo: similar command/query handlers, domain entities, validators, controllers, and their tests.
- Localization files, if the project has them (`{{config.i18n.paths}}`).

Let the conventions docs in `{{config.conventionsDocs}}` point you at where these live in each repo.

### Document Patterns

Record a table of the exact patterns to mirror, with evidence:

| Category | Repo (role) | File:Lines | Pattern |
|---|---|---|---|
| ... | ... | ... | ... |

Cover at least: surface/naming, data hook, backend handler (if applicable), validator (if applicable), and tests — one row each, per affected repo.

---

## Phase 2.5: RESEARCH open decisions (conditional)

Most plans need NO web research — this skill fits work into existing project patterns, and Phase 2 already surfaces the pattern to mirror. Reach for external deep research only when the task has a genuine open decision the codebase doesn't answer.

**Trigger** deep research when EITHER:
- `--research` was passed (force it), OR
- Phase 2 found **no in-repo precedent** for a load-bearing decision — one of: a new third-party dependency/SDK with no established equivalent here; an unfamiliar architecture/integration/protocol with no pattern to mirror; a performance/security/scaling/cost approach not already settled in the codebase or the conventions docs; or the issue itself asks an open "what's the best way to X."

**Skip** (the common case) when Phase 2 found a clear pattern to mirror, the task is routine CRUD/feature/bugfix/parity work, or `--no-research` was passed. State in one line that research was skipped and why.

**How:** run the deep-research flow scoped to the **decision**, not the whole feature (e.g. "best way to do optimistic offline sync for a list mutation in this stack", not "plan the whole feature"). Fold its recommendation into Phase 3 as the chosen approach, and cite its sources in the plan's Patterns/Risks. In **multi-plan mode**, run the research inline rather than nesting a separate research skill call.

**Guardrail — project conventions win.** Deep research surfaces *external* best practice; it does not override the project's deliberate choices. When a finding conflicts with `{{config.conventionsDocs}}`, an established codebase pattern, or cross-surface parity, the project convention wins — note the deviation and why. Never let a generic recommendation pull the plan off-anchor.

---

## Phase 3: DESIGN

### Map the Changes

- Files to CREATE (with full path)
- Files to UPDATE (with full path)
- Dependency order across repos: typically domain → application → API → shared types → each client surface → tests
- For multi-repo work: define the implementation order so each step is independently runnable (a backend stub deployable before a client consumes it)

### Cross-Surface Parity Check (only if `{{config.parity.enabled}}`)

If the change touches one mirrored surface, it almost always touches its mirror too. Using `{{config.parity.mirrors}}`, list the parallel files:

| Surface A | Surface B (mirror) | Same logic? |
|---|---|---|
| ... | ... | yes/no |

### Identify Risks

| Risk | Mitigation |
|---|---|
| {issue} | {handling} |

---

## Phase 4: GENERATE

**Output path**: `{{config.paths.plansDir}}/{kebab-case-name}.plan.md`

```bash
mkdir -p {{config.paths.plansDir}}
```

```markdown
# Plan: {Feature Name}

## Summary

{One paragraph: what we're building and the approach}

## User Story

As a {user type}
I want to {action}
So that {benefit}

## Metadata

| Field | Value |
|---|---|
| Type | NEW_CAPABILITY / ENHANCEMENT / REFACTOR / BUG_FIX |
| Complexity | LOW / MEDIUM / HIGH |
| Repos | {affected repos from config.repos} |
| Parity Required | yes / no |
| Tracked Issue | #{N} (or "N/A") |
| Surfaces Affected | {list} |

(rest of plan body — see the template sections below.)
```

The full plan template — **Patterns**, **Files to Change**, **Tasks** (ordered), **Validation Commands** (pull each repo's `testCmd` / `lintCmd` / `typeCheckCmd` / `buildCmd` from `{{config.repos}}`), **E2E checklist**, **Acceptance Criteria** — follows this header. Preserve that structure.

---

## Phase 5: OUTPUT

```markdown
## Plan Created

**File**: `{{config.paths.plansDir}}/{name}.plan.md`
**Repos**: {affected repos}
**Issue**: #{N} (or "N/A")

**Summary**: {2-3 sentences}

**Scope**:
- {N} files to CREATE
- {M} files to UPDATE
- {K} total tasks
- Affects: {repos}

**Key Patterns**:
- {Pattern 1 with file:line}
- {Pattern 2 with file:line}

**Next Step**: Review the plan, then `implement {{config.paths.plansDir}}/{name}.plan.md`
```

---

## Multi-plan mode

The caller passed 2+ issue numbers. Generate one plan per issue, in parallel via subagents in their worktrees.

### Step 1: Verify worktrees exist

For each issue `N`, check that the worktree exists in every repo the issue touches — at `{{config.worktree.root}}/<branch>` (branch = `{{config.worktree.branchPattern}}` with `{n}` = `N`) relative to each repo's root in `{{config.repos}}`.

If a worktree is missing, run `prime <N1> <N2> ...` first (or surface the error and ask the user to do so).

### Step 2: Spawn planning subagents

Spawn ONE subagent per issue, in parallel. Each subagent:

- Has its working directory set to the primary repo's worktree for that issue.
- Runs the full single-plan flow (Phases 1–5) inside its worktree.
- Writes its plan to `{{config.paths.plansDir}}/issue-<N>.plan.md` inside the worktree.
- Reports back: plan file path, scope summary, complexity rating.

**Concurrency cap: `{{config.execution.maxParallelSubagents}}` subagents at a time.** Queue the rest.

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, generate each plan serially in the main thread (same Phases 1–5, one issue at a time) instead of spawning subagents.

### Step 3: Aggregate

Print one row per issue showing plan path + scope + complexity. Surface any subagent failures with the error message and the worktree path so the user can iterate manually.

```
Issue   Plan                                                  Files  Tasks  Complexity
#100    <root>/issue-100/{{config.paths.plansDir}}/...                    12     8      MEDIUM
#101    <root>/issue-101/{{config.paths.plansDir}}/...                    4      3      LOW
#102    <root>/issue-102/{{config.paths.plansDir}}/...                    FAILED ...
```

Suggested next step: `implement <N1> <N2> <N3>` (continues the parallel flow).
