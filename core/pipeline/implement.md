# Implement Plan (Cross-Repo)

> **Config inputs:** `config.repos`, `config.branchNaming`, `config.pr.commitTrailer`, `config.pr.prBodyFooter`, `config.pr.baseBranch`, `config.pr.pairedPRs`, `config.pr.squash`, `config.parity`, `config.i18n`, `config.contract`, `config.issueTracker.repo`, `config.issueTracker.driver`, `config.worktree.root`, `config.worktree.branchPattern`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Plan**: the plan path or issue number(s) the caller passed.

## Mission

Execute the plan end-to-end across the affected repos in `{{config.repos}}` with rigorous self-validation.

**Core Philosophy**: Validation loops catch mistakes early. Run checks after every change. Fix issues before moving on.

**Golden Rule**: If validation fails, fix it before moving on. Never accumulate broken state.

## Mode detection (do this first)

Count numeric tokens (`123`, `#123`).

| Numeric arg count | Mode |
|---|---|
| 0 | **Path-based** — the argument is a plan file path. Continue with Phase 1 below. |
| 1 | **Single-issue** — the argument is one issue number. Plan path = `{{config.paths.plansDir}}/issue-<N>.plan.md`. Continue with Phase 1. |
| ≥ 2 | **Multi-issue** — jump to "Multi-issue mode". |

---

## Repos

Every repo root comes from `{{config.repos}}` (`<repo.path>` per entry). Route work to a repo by matching the plan's affected repos against each entry's `role`.

---

## Phase 1: LOAD

Read the plan file (resolve from arguments per the mode detection table). Extract:

- Summary, user story, metadata
- **Repos** (which entries of `{{config.repos}}`)
- **Parity Required** (yes/no)
- **Tracked Issue** (#N or N/A) — this skill will close it after success
- Patterns to mirror
- Files to change
- Tasks (ordered)
- Validation commands
- E2E checklist

**If the plan is not found:**

```
Error: Plan not found at <argument>
Create one first: plan <issue-number>
```

---

## Phase 2: PREPARE GIT STATE

For each affected repo, check state and create a branch.

### Branch Name

Derive from the plan filename using `{{config.branchNaming.pattern}}`, picking the `{type}` from `{{config.branchNaming.types}}` (e.g. `fix` for BUG_FIX, `refactor`/`chore` for tech, otherwise `feature`).

### Per affected repo (each entry of `{{config.repos}}` the plan touches)

```bash
git -C <repo.path> branch --show-current
git -C <repo.path> status
```

| State | Action |
|---|---|
| On a protected branch (`{{config.branchNaming.protectedBranches}}`), clean | `git -C <repo.path> checkout -b <branch>` |
| On a protected branch, dirty | STOP: ask the user to stash or commit |
| On the target feature branch | Use it |
| On a different feature branch | STOP: ask the user |

Use the SAME `<branch>` name in every affected repo so the paired PRs are easy to associate.

---

## Phase 3: EXECUTE

For each task in the plan, in order:

### 3.1 Verify Assumptions

Before writing code:
- Read the target file in the correct repo
- Read adjacent files (imports + importers)
- Verify the plan's references exist as described
- If assumptions are wrong, adapt and document the deviation

### 3.2 Implement

- Read the MIRROR reference and follow that pattern
- Make the change
- Check integration: do imports resolve? Do callers/callees still work? Does data flow correctly across boundaries?

### 3.3 Validate Immediately

Run the fast check for the repo you just edited — its `typeCheckCmd` (or, if empty, its `buildCmd`) from `{{config.repos}}`:

```bash
cd <repo.path> && <repo.typeCheckCmd or repo.buildCmd>
```

If it fails: read the error, fix it, re-run. Do not proceed until passing.

### 3.4 Track Progress

```
Task 1: <repo>  CREATE  <path>   PASS
Task 2: <repo>  UPDATE  <path>   PASS
Task 3: <repo>  CREATE  <path>   PASS
```

If you deviate from the plan, log it for the report.

---

## Phase 4: PARITY CHECK (if Parity Required = yes and `{{config.parity.enabled}}`)

Verify each changed file has its mirror, using `{{config.parity.mirrors}}`. Report PAIRED / PARTIAL / MISSING per pair and fix anything not PAIRED. Surface `{{config.parity.note}}` when a gap is found.

If the project has localization (`{{config.i18n.locales}}` non-empty) and any user-facing strings were added/changed, verify every key exists in every locale file under `{{config.i18n.paths}}`.

If the change touches more than one repo AND `{{config.contract.enabled}}`, verify the shared shapes match across `{{config.contract.clientTypesGlob}}` and `{{config.contract.serverTypesGlob}}`.

---

## Phase 5: VALIDATE (full)

For each affected repo in `{{config.repos}}`, run its non-empty commands (skip any that are empty):

```bash
cd <repo.path> && <repo.lintCmd>
cd <repo.path> && <repo.typeCheckCmd>
cd <repo.path> && <repo.testCmd>
cd <repo.path> && <repo.buildCmd>
```

### Write Tests

You MUST write tests for new code (unit tests unless the project's conventions say otherwise):

- **Client surfaces**: unit tests for every new function/hook, component tests for components, a parity test if the logic is shared
- **Backend**: unit tests for command/query handlers, validators, and services
- Test across boundaries — endpoints return correct shapes, hooks integrate with their consumers

### REQUIRED: End-to-End Verification

> Do NOT proceed to Phase 6 (Report) until E2E passes.

Execute every E2E step in the plan as a checklist. For client-facing changes, launch the app and exercise the feature for real (per the project's conventions docs). For parity-required work, repeat on every mirrored surface.

If the plan has no E2E section, perform a smoke test: start the relevant app(s), exercise the new path, verify behavior.

**Hard gate**: Static checks + unit tests alone are not enough.

---

## Phase 6: REPORT

**Output path**: `{{config.paths.reportsDir}}/{plan-name}-report.md`

```bash
mkdir -p {{config.paths.reportsDir}}
```

Report template — branches, tasks completed, validation results, parity check, files changed, deviations, tests written.

### Archive Plan

```bash
mkdir -p {{config.paths.plansDir}}/completed
mv <plan-path> {{config.paths.plansDir}}/completed/
```

---

## Phase 7: COMMIT + PUSH + CREATE PR(s)

**Ask the user to confirm before pushing.** Show the diff summary and proposed commit message first.

### 7.1 Commit per repo

Use Conventional Commit format, scoped by repo/feature. For multi-repo work, make one separate commit per repo. Append `{{config.pr.commitTrailer}}` to each commit message if it is set.

### 7.2 Push

```bash
git -C <repo.path> push -u origin <branch>
```

### 7.3 Create PR(s)

For each repo with changes, open a PR against `{{config.pr.baseBranch}}`. If `{{config.pr.pairedPRs}}` and the change spans multiple repos, cross-link the descriptions. Append `{{config.pr.prBodyFooter}}` to each PR body if it is set.

**Issue linkage for multi-repo work**: only the PR in the repo that owns the issue tracker (`{{config.issueTracker.repo}}`) uses `Closes #N`; the other repos' PRs reference it (e.g. `Refs {{config.issueTracker.repo}}#N`).

Capture each PR's URL.

---

## Phase 8: UPDATE TRACKED ISSUE

If the plan's **Tracked Issue** is "N/A", skip.

Otherwise post a completion comment on the issue in `{{config.issueTracker.repo}}` through the resolved tracker driver `{{config.issueTracker.driver}}` (the tool setup picked for the tracker host — see `stories` for the per-host driver reference).

Don't manually close — the `Closes #N` in the owning repo's PR closes it on merge.

---

## Phase 9: OUTPUT

```markdown
## Implementation Complete

**Plan**: `{plan-path}`
**Issue**: #{N}
**Status**: PASS

### Branches & PRs

| Repo | Branch | PR |
|---|---|---|
| <repo> | `<branch>` | {url} |

### Validation: PASS in all affected repos.

### Next Steps
1. Request review on each PR
2. If `{{config.pr.squash}}`, squash-merge. For multi-repo work, merge the producer repo (the API/contract side) first so the contract is live before its consumer.
```

---

## Multi-issue mode

The caller passed 2+ issue numbers. Implement each in its worktree in parallel.

### Step 1: Verify plans exist

For each issue `N`, check for a plan at `{{config.worktree.root}}/<branch>/{{config.paths.plansDir}}/issue-<N>.plan.md` (branch = `{{config.worktree.branchPattern}}` with `{n}` = `N`) in the primary repo's worktree.

If a plan is missing, surface the issues that lack plans and ask whether to run `plan <N1> <N2> ...` first (or to skip them).

### Step 2: Spawn implementation subagents

Spawn ONE subagent per issue with a plan, in parallel. Each subagent:

- Has its working directory set to the primary repo's worktree for that issue.
- Runs the full single-plan flow (Phases 1–9) inside its worktree.
- Opens its PR(s), cross-linked across repos if the change spans more than one.
- Reports back: PR URLs, validation status, deviations.

**Concurrency cap: `{{config.execution.maxParallelSubagents}}` subagents at a time.** Queue the rest (heavy build steps are the main concern — don't raise this without good reason).

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, implement each issue serially in the main thread (full Phases 1–9, one issue at a time) instead of spawning subagents.

### Step 3: Aggregate

Print one row per issue:

```
Issue   PR(s)                                 Validation   Deviations
#100    <repo> PR #N1 / <repo> PR #N2         PASS         None
#101    <repo> PR #N3                         PASS         renamed Foo→Bar (plan said Baz)
#102    FAILED — build error in handler       FAILED       N/A
```

For FAILED rows: surface the underlying error and the worktree path so the user can investigate manually.

**Failure handling: keep going.** A failing subagent does NOT halt its siblings. The aggregate report lists all failures at the end.

---

## Handling failures

| Failure | Action |
|---|---|
| Type check fails | Read error, fix, re-run |
| Build fails | Read error, fix, re-run |
| Tests fail | Bug in implementation or test — fix the actual issue, re-run |
| Lint fails | Try the linter's auto-fix, then manual |
| Migration error | Verify the migration was generated correctly; never edit an already-applied migration |
| Parity check fails | Add the missing mirror file/hook/locale key before proceeding |
| Push blocked | Branch protection on a protected branch — never push directly; create a feature branch |

Never bypass commit hooks or signing to force a push through. Investigate and fix the underlying issue.
