# Drive: spec-driven, resumable, multi-session issue conductor

> **Config inputs:** `config.issueTracker`, `config.paths.specsDir`, `config.paths.plansDir`, `config.worktree.branchPattern`, `config.worktree.root`, `config.pr.baseBranch`, `config.pr.squash`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

A thin conductor, like `execute`, but built to span **many fresh sessions**. It writes no new logic and re-implements nothing — `prime`, `grill`, `plan`, and `implement` own their behavior; reference them by name, never restate them. The one thing `drive` adds is a **living spec file** that is the durable state, so the whole run survives a context reset and resumes from the exact same command.

This skill targets issues in `{{config.issueTracker.repo}}`.

**Why it exists:** `execute` is single-pass — one prime → plan → implement in one session. An epic (a multi-bundle issue like a phased tech epic) is too big for that: one giant plan, one giant implement, and a context window that rots. `drive` breaks the epic into bundles, does a bounded chunk per session, records progress in the spec, and hands you the exact next command. It is the *attended* twin of an unattended queue-drain (fresh context per unit, state in a file) with the interactive gates kept.

## The two levers, and how they compose

- **Subagents keep the main session thin.** Plan and implement run in worktree subagents (isolated, fresh context, parallel across issues). The main session accumulates only gate exchanges + one-line summaries + spec diffs — never full implementation transcripts. So you can drive several bundles in one session before it fills.
- **The spec makes a context reset free.** When the session does fill (or you want to stop for the night), clear it and re-run `drive <#>`; it reads the spec, reconciles against reality, and continues. Clearing becomes an *optional checkpoint*, not a mandatory per-bundle step.

Subagents reduce how often you must clear; the spec makes any clear resumable. Both, not either.

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, the heavy PLAN and IMPLEMENT steps run serially in the main thread (each skill's own sequential fallback), one bundle — and one issue — at a time. The main session is no longer kept thin by delegation, so lean harder on the spec: clear and resume more often. The gate discipline and the spec lifecycle below are unchanged.

## The living spec (the source of truth)

One file per issue at `{{config.paths.specsDir}}/issue-<N>.spec.md`. It is authoritative for *what is done and what is next*, but it is **reconciled against the tracker on every resume** — never trusted blindly (a PR the spec calls "done" might have been closed unmerged; verify via the configured tracker). Template:

```markdown
---
issue: <N>
title: <issue title>
status: draft | in-progress | blocked | complete
next-action: "drive <N>"        # exact command to run after a context reset
---

# Drive spec — #<N>: <title>

## Bundles
| # | scope | status | plan | branch | PR |
|---|-------|--------|------|--------|----|
| 1 | <e.g. docs/tooling slice> | done        | {{config.paths.plansDir}}/issue-<N>-b1.plan.md | <branch> | #123 merged |
| 2 | <e.g. core feature slice> | in-progress | {{config.paths.plansDir}}/issue-<N>-b2.plan.md | <branch> | #124 open   |
| 3 | <e.g. hardening slice>    | todo        | -                                              | -        | -           |

## Decisions (from grilling — durable across every reset)
- <decision + why>

## Reconcile log
- <what a resume corrected against the tracker, and when>
```

Bundle `status`: `todo` → `planned` → `in-progress` → `done` (PR merged) | `blocked`.

## Mode detection

Parse the arguments:

| Input | Mode |
|---|---|
| `status <#…>` | **Report.** Read each spec, reconcile against the tracker, show the bundle table + next action. No work. |
| `stop <#>` | **Pause.** Set the spec `status: blocked` with a one-line reason. No work. |
| ≥ 1 issue number, no spec yet | **Init** that issue (below). |
| ≥ 1 issue number, spec exists | **Resume** that issue (below). |
| ≥ 2 issue numbers | Run init/resume per issue in **multi-issue mode** (worktrees + parallel subagents). |
| 0 numeric tokens | Ask for an issue number. Do nothing else. |

## Init (first run on an issue)

1. **Prime.** Run `prime <N>` (load-only; single-issue) or, for 2+ issues, `prime <N…>` (it creates the worktrees and primes each in a parallel subagent). Do not carry past its summary except into the spec.
2. **Decompose.** Read the issue. If it is an epic (phased body / multiple independent items), break it into an ordered **bundle** list — group correlated items to minimize PRs, and order by dependency. A bounded slice is a single bundle (degenerate case — `drive` still works, it just finishes in one cycle).
3. **Write the spec** with all bundles `todo`, decisions empty, `next-action: "drive <N>"`.
4. **GATE — SPEC.** Show the bundle table + sequencing. Wait for `approve` / `edit <note>` / `abort`. Default-deny: no or ambiguous response → restate and wait.
5. **Grill** (main session; interactive — it NEVER runs as a subagent). Single issue: invoke `grill` on the open questions `prime` surfaced. 2+ issues: invoke `batch-grill <N…>` — one frontier over the whole set, shared questions asked once, cross-issue conflicts surfaced before planning. Either way, record every resolved decision in the issue's spec Decisions section. The user's explicit exit is the gate.
6. Proceed to **Work** on the first `todo` bundle.

## Work (per bundle — heavy steps delegated to subagents)

1. **Plan (subagent).** Spawn a subagent in the issue's worktree to run `plan` scoped to the bundle; it writes `{{config.paths.plansDir}}/issue-<N>-b<k>.plan.md` and returns the plan Summary / Files / Tasks. Mark the bundle `planned` in the spec. Across multiple issues these run in parallel (bounded by `{{config.execution.maxParallelSubagents}}`); under the sequential fallback they run one at a time in the main thread.
2. **GATE — PLAN.** Main session shows each plan's Summary / Files / Tasks. Wait for `approve` (blanket) / `approve <bundle|issue>` / `revise <feedback>` / `abort`. NOTHING implements without an explicit approve. This is the gate `execute` treats as critical and the reason `drive` never does "prime → implement" with no plan review.
3. **Implement (subagent).** For each approved bundle, spawn a subagent in the worktree to run `implement <plan-path>`: code + tests + validation, then open a **draft PR** against `{{config.pr.baseBranch}}` and return one line of JSON `{"bundle":k,"status":"done"|"blocked"|"failed","pr":"<url>","summary":"…"}`. The draft PR + your review is the merge gate (a subagent cannot hold `implement`'s interactive push prompt — the plan approval above already authorized the work; the draft state keeps the human at the merge).
4. **Update + reconcile.** Write the bundle's `status`, `branch`, and `PR` into the spec. Verify the PR against the configured tracker — the spec reflects tracker truth, not the subagent's claim.
5. **Next.**
   - More `todo` bundles AND the main session is still thin → offer to continue to the next bundle now, in this session.
   - Session getting long, or the user wants to pause → set `next-action: "drive <N>"` and print the handoff: **"Bundle <k> PR: <url>. Reset context, then run `drive <N>` to continue."**

## Resume (fresh session — the same `drive <N>`)

1. Read the spec. **Reconcile against the tracker** for every non-`todo` bundle: PR merged → `done`; PR open → keep (awaiting merge); branch exists with no PR → `in-progress`; nothing on the branch → back to `todo`. Correct the spec and append to the Reconcile log.
2. Re-prime context (`prime <N>` or a prime subagent) since the session is fresh.
3. Continue from the first actionable bundle via the **Work** loop.

## Termination

When every bundle is `done` with a **merged** PR: confirm once, then close the issue via the configured tracker (`{{config.issueTracker.repo}}`; cross-linked issues: close each paired issue too), set the spec `status: complete`, and report the PRs landed. `drive` does not merge PRs itself — merging stays a human action (squash-merge when `{{config.pr.squash}}` is set).

## Multi-issue mode (2+ issue numbers)

Same loop, fanned out — mirroring `execute`'s multi-issue mode and `prime`/`plan`/`implement`'s own multi-issue modes (they own the worktree + parallel-subagent machinery; never restate it):

- **Prime** creates worktrees under `{{config.worktree.root}}` on `{{config.worktree.branchPattern}}` branches and primes each issue in a parallel subagent.
- **Grill** stays in the main session (interactive; never a subagent). 2+ issues use `batch-grill <N…>` — one frontier over the set, shared questions asked once, cross-issue conflicts surfaced — recording each issue's decisions in that issue's spec.
- **Plan** and **Implement** run as parallel worktree subagents, per issue, bounded by `{{config.execution.maxParallelSubagents}}`. When `{{config.execution.hasNamedAgentRegistry}}` is false or that cap is ≤ 1, they run serially in the main thread instead — the loop and gates are identical, just one issue at a time.
- The three gates become **batch gates** over all issues, with per-issue scoping allowed (`approve <#…>`, `revise <#> <feedback>`, `drop <#…>`).
- One spec per issue; each advances independently. A failing issue does not halt its siblings.

## Output / next step

- **Mid-run:** end every turn with the concrete handoff line — the PR(s) opened and the exact next command (`drive <N>` after a context reset, or "continue" to take the next bundle now).
- **Report mode (`drive status <#…>`):** the reconciled bundle table per issue, spent PRs, and which bundle is next.
- **On completion:** the merged PRs, the closed issue(s), and the archived spec path.
