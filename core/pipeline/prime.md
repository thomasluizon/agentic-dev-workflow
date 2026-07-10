# Prime: Load Project Context

> **Config inputs:** `config.repos`, `config.conventionsDocs`, `config.issueTracker.host`, `config.issueTracker.repo`, `config.issueTracker.driver`, `config.worktree.root`, `config.worktree.branchPattern`, `config.branchNaming.pattern`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: the issue number(s) or context flags the caller passed.

## Objective

Build a working mental model of every repo in `{{config.repos}}` so subsequent skills (`plan`, `implement`) have warm context.

## Mode detection (do this first)

Parse the input. Count numeric tokens (`123`, `#123`) — split on whitespace OR commas (`100,101,102` is three arguments).

| Numeric arg count | Mode |
|---|---|
| 0 or 1 | **Single-issue / context-only** — continue with the steps below. |
| ≥ 2 | **Multi-issue** — jump to the "Multi-issue mode" section. Do NOT run the single-issue steps in the main session. |

---

## Single-issue mode

### Step 0: Parse args

- If the first arg is numeric (or `#N`), treat it as an issue in `{{config.issueTracker.repo}}` (tracker host `{{config.issueTracker.host}}`).
- A `--quick` flag skips the deep codebase tour and only reads conventions + recent commits.

### Step 1: Load the tracked issue (if provided)

Fetch issue `{N}` from `{{config.issueTracker.repo}}` through the resolved tracker driver `{{config.issueTracker.driver}}` (the tool setup picked for host `{{config.issueTracker.host}}` — see `stories` for the per-host driver reference). Pull the issue's number, title, body, labels, milestone, assignees, and state.

Extract:
- Title and body
- Labels — note any that route work to a specific repo `role` in `{{config.repos}}` (e.g. `repo:frontend` / `repo:backend` / `repo:both`) and any parity flag
- Acceptance criteria from the body
- Any "Depends on" / "Blocks" references

### Step 2: Read conventions

In parallel, for each repo in `{{config.repos}}`, read the docs listed in `{{config.conventionsDocs}}` from that repo's root (and any scoped/nested copies). These are the project's source of truth for standards, design, and workflow.

### Step 3: Tour the codebases (skip if `--quick`)

For each affected repo (routed by the issue's labels against each repo's `role` in `{{config.repos}}`), read a representative, canonical example of the pattern the work will follow:

- A shared/contract layer, if the project has one (types, endpoint constants, query keys).
- For a frontend-role repo: a representative feature surface plus its matching data hook.
- For a backend-role repo: a representative request handler / command / query, its domain entity, and its test.

Let the conventions docs from Step 2 point you at where those canonical examples live.

### Step 4: Recent state

For each repo in `{{config.repos}}`, capture recent history and the current branch:

```bash
git -C <repo.path> log --oneline -10
git -C <repo.path> branch --show-current
```

---

## Multi-issue mode

The caller passed 2+ issue numbers. Create one worktree set per issue, prime each in a background subagent, and report all paths when done.

### Step 1: Validate

- Read each issue to confirm it exists.
- If any issue is closed/locked, list it and ask the user whether to continue with the remainder.

### Step 2: Create worktrees

For each issue `N`, create a worktree in EVERY repo the issue touches. For each repo in `{{config.repos}}` (filtered to the repos the issue's labels route to), the branch is `{{config.worktree.branchPattern}}` (with `{n}` = the issue number) and the worktree lives at `{{config.worktree.root}}/<branch>` relative to that repo's root:

```bash
git -C <repo.path> worktree add <repo.path>/{{config.worktree.root}}/<branch> -b <branch>
```

where `<branch>` is `{{config.worktree.branchPattern}}` with `{n}` = `N`. Skip repos the issue does not touch.

### Step 3: Spawn priming subagents

Spawn ONE subagent per issue, **in parallel**. Each subagent:

- Has its working directory set to the primary repo's worktree path for that issue.
- Runs this skill in single-issue mode for `N` inside its worktree.
- Reports back: issue title, routed repos, parity flag, 3-bullet summary of the acceptance criteria.

**Concurrency cap: `{{config.execution.maxParallelSubagents}}` subagents at a time.** Queue the rest and run them as a follow-up batch when the first completes.

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, prime each issue serially in the main thread (same steps, one after another) instead of spawning subagents.

### Step 4: Aggregate

When all issues are primed, print a single table:

```
Issue   Title                            Repos       Parity   Worktree
#100    Add streak freeze                both        yes      <root>/issue-100
#101    Fix timezone bug                 frontend    yes      <root>/issue-101
#102    Migrate to new validator         backend     no       <root>/issue-102
```

Then list any failures (subagent error, worktree creation failure) with the underlying message.

---

## Output

### Single-issue mode

A scannable summary:

- **Issue** (if loaded): #N — title — routed repos — parity flag
- **Acceptance criteria**: bulleted list from the issue body
- **Project purpose**: one line, `{{config.projectName}}`
- **Repos & stacks**: one line per repo in `{{config.repos}}` (name — role — stack, learned from its conventions docs)
- **Recent commits**: 3-5 from each repo
- **Current branches**: one per repo
- **Open question / risk**: anything that looks underspecified

Keep it concise. Bullets, not paragraphs.

### Multi-issue mode

The aggregated table + suggested next step:

```
plan <A> <B> <C>       # same N issues, parallel plans
```

---

## Suggested next step

**Single-issue:** `plan {issue-number}`
**Multi-issue:** `plan <N1> <N2> <N3>` (continues the parallel flow)
