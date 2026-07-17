# Execute: issue → prime → grill → plan → implement (gated)

> **Config inputs:** `config.issueTracker`, `config.worktree.branchPattern`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

A thin conductor over the prime → grill → plan → implement control loop. It invokes the skills that already exist and inserts a hard, blocking gate at every stage boundary. It writes no new logic and re-implements nothing — `prime`, `grill`, `plan`, and `implement` own their own behavior. Reference them by name; never restate how they work.

**The control loop:**

```
prime <issue>  →  [GATE 1]  →  grill  →  [GATE 2]  →  plan <issue>  →  [GATE 3]  →  implement <plan-path>
 (load only)                  (questions)              (writes plan)    (approve)     (owns its own push gate)
```

## Inputs & mode

**Input**: one or more issue numbers (`123` or `#123`).

Count numeric tokens (split on whitespace OR commas, mirroring `prime`'s mode detection):

| Numeric tokens | Action |
|---|---|
| 0 | Ask the user for an issue number. Do nothing else until you have one. |
| 1 | Proceed with the single-issue control loop below. |
| ≥ 2 | Jump to **## Multi-issue mode**. Do NOT run the single-issue stages below — the multi flow fans the same gated loop out across worktrees. |

This skill targets issues in `{{config.issueTracker.repo}}`.

> **Epic check.** `execute` is single-pass — one prime → plan → implement in one session. If the issue is an **epic** (a phased/multi-bundle body whose finish line spans several independent PRs), it is too big for one pass: use **`drive <issue#>`** instead — the resumable, spec-driven conductor that breaks the epic into bundles across fresh sessions.

## Stage 1 — PRIME (context load only)

Run `prime <issue>` in single-issue mode. Wait for its context summary and stop there. `prime` is load-only: it loads every repo, the issue, conventions, and recent state, and ends at its own "Suggested next step: `plan …`". It never plans, never edits files, never implements. Do NOT carry past `prime`'s output into any work — the only path forward is GATE 1. Priming loads context, full stop.

Then present **GATE 1**.

## Stage 2 — GRILL (clarifying questions)

Once GATE 1 returns `proceed`, invoke the `grill` skill against the primed issue context. Use it to resolve the open questions and risks `prime` surfaced and any ambiguity in the acceptance criteria. `grill` owns ALL grilling mechanics (how it asks, batching, recommended answers, when to research the codebase instead of asking) — do not restate or override them here, and do not write code while grilling.

**Reuse check.** If `{{config.paths.plansDir}}/issue-<N>.decisions.md` already exists (a prior run was interrupted after grilling), show it and ask whether to reuse those decisions (skip the grill) or re-grill. Never silently re-grill over an existing decisions file.

**Persist on exit (durable paper trail).** When the user exits the grill loop, write the resolved decisions to `{{config.paths.plansDir}}/issue-<N>.decisions.md` as a `## Decisions (from grilling)` block — each decision plus its why — BEFORE presenting the gate. This makes a context reset at GATE 2 free: the decisions survive and Stage 3's `plan` reads them from that file. That explicit exit is **GATE 2**.

## Stage 3 — PLAN

Once GATE 2 returns `proceed`, run `plan <issue>` in single-plan mode, folding in the decisions from `{{config.paths.plansDir}}/issue-<N>.decisions.md` (written at grill exit). The single-issue plan lands at `{{config.paths.plansDir}}/issue-<N>.plan.md`. Capture that exact path — Stage 4 needs it.

`plan` ends at its own passive "Next Step: Review the plan, then `implement …`". This skill replaces that suggestion with the active, blocking **GATE 3**.

## Stage 4 — IMPLEMENT (only after the hard plan gate)

Reachable ONLY through an explicit `approve` at GATE 3. Run `implement {{config.paths.plansDir}}/issue-<N>.plan.md` (path-based mode) with the path captured in Stage 3.

`implement` owns its OWN downstream confirmation: it asks the user to confirm before pushing and opening the PR (its Phase 7). This skill does NOT re-add or fight that gate — it owns the gates up to and including the pre-implement approval, then delegates the push/PR checkpoint to `implement`.

## Gates (the core of this skill)

Every stage boundary is a HARD, blocking confirmation. Default-deny: on no response or an ambiguous response, do nothing — restate the gate and wait. Never auto-advance.

### GATE 1 — after PRIME, before GRILL

Show the `prime` summary: issue title / labels / parity flag, acceptance criteria, open questions / risks, and current branches.

| Response | Effect |
|---|---|
| `proceed` | Start grilling (Stage 2). |
| `edit <note>` / `clarify <note>` | Fold the note into grilling, then start Stage 2. |
| `abort` | Stop. Report that nothing past priming ran. |

### GATE 2 — after GRILL, before PLAN

Show the resolved decisions and answers from grilling.

| Response | Effect |
|---|---|
| `proceed` | Run `plan` (Stage 3). |
| `more` | Keep grilling (back to Stage 2). |
| `abort` | Stop. |

### GATE 3 — after PLAN, before IMPLEMENT (the critical gate)

Show the plan path plus the plan's **Summary**, **Files to Change**, and **Tasks**.

| Response | Effect |
|---|---|
| `approve` | Run `implement <plan-path>` (Stage 4). |
| `revise <feedback>` | Re-run `plan` with the feedback. Loop back to GATE 3. Do NOT implement. |
| `abort` | Stop. |

**NOTHING is implemented without an explicit `approve` here.** No response, a question, or anything other than `approve` keeps the loop at the plan — it never falls through to `implement`.

### Final checkpoint (not owned here)

The push/PR confirmation inside `implement` (its Phase 7) remains the final gate and is intentionally NOT duplicated by this skill.

## Multi-issue mode

The caller passed 2+ issue numbers. This skill runs the SAME gated loop, fanned out: PRIME, PLAN, and IMPLEMENT delegate to `prime`, `plan`, and `implement` **in their own multi-issue modes** (parallel worktree subagents, `{{config.worktree.branchPattern}}` branches, concurrency cap — all owned there, never restated here). GRILL stays in the main session via `batch-grill` — one frontier over the whole set, an interactive conversation with the user, never a subagent. The three gates become BATCH gates over all issues, with per-issue responses allowed.

```
prime <N…>  →  [GATE A]  →  batch-grill <N…>  →  [GATE B]  →  plan <N…>  →  [GATE C]  →  implement <N…>
(parallel worktrees)        (main session)                    (parallel worktrees)         (parallel worktrees)
```

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, the delegated PRIME / PLAN / IMPLEMENT stages run their issues serially in the main thread (each skill's own sequential fallback), one issue at a time. The gate discipline below is unchanged.

### Stage 1 (multi) — PRIME all

Run `prime <N1> <N2> …`. It validates each issue, creates the worktrees, and primes each (in parallel subagents, or serially under the fallback), returning the aggregated table. Lean on each issue's reported **open questions / risks** — they are the grill agenda for Stage 2; request them if a summary omits them. Then present **GATE A**.

### Stage 2 (multi) — BATCH-GRILL the set

Once GATE A returns `proceed`, invoke `batch-grill <N…>` in the main session. It collects the union of all issues' open questions into one frontier, asks each shared question ONCE (applying the answer to every affected issue), surfaces cross-issue conflicts before planning, and persists each issue's resolved decisions to its `<worktree>/{{config.paths.plansDir}}/issue-<N>.decisions.md`. Stage 3 folds each issue's file into that issue's own plan. `batch-grill` owns the frontier/clustering/attribution mechanics — do not restate them; it is interactive, main-session only, never a subagent. After the frontier is empty, present **GATE B**.

Under the sequential fallback (no named-agent registry), `batch-grill` is unaffected — it is a main-session conversation either way.

### Stage 3 (multi) — PLAN all

Once GATE B returns `proceed`, run `plan <N1> <N2> …`. It writes one plan per issue at `<worktree>/{{config.paths.plansDir}}/issue-<N>.plan.md`. Pass each subagent its issue's resolved grill decisions so the plan reflects them. Capture every plan path, then present **GATE C**.

### Stage 4 (multi) — IMPLEMENT all

Reachable ONLY through an explicit `approve` at GATE C. Run `implement <N1> <N2> …` for the approved issues. Each implements in its worktree and opens its own PR(s); a failing issue does NOT halt its siblings. `implement` still owns its per-worktree push/PR confirmation — this skill does not duplicate it.

### Batch gates

Same default-deny discipline as the single-issue gates: no or ambiguous response → restate and wait, never auto-advance. Each gate takes a blanket verb OR per-issue scoping (`<N…>` = one or more issue numbers).

**GATE A — after PRIME all, before GRILL.** Show the aggregated prime table (issue / title / repos / parity / worktree) plus each issue's open questions.

| Response | Effect |
|---|---|
| `proceed` | Batch-grill the whole set (Stage 2). |
| `drop <N…>` | Drop those issues; proceed with the rest. |
| `abort` | Stop. Report the worktrees that were created. |

**GATE B — after GRILL all, before PLAN.** Show the resolved decisions per issue.

| Response | Effect |
|---|---|
| `proceed` | Run `plan <N…>` (Stage 3). |
| `more <N>` | Re-grill that issue, then return to GATE B. |
| `abort` | Stop. |

**GATE C — after PLAN all, before IMPLEMENT (the critical gate).** Show each plan's path plus its **Summary**, **Files to Change**, and **Tasks**.

| Response | Effect |
|---|---|
| `approve` | Implement ALL issues (Stage 4). |
| `approve <N…>` | Implement only those issues; hold the rest at the plan. |
| `revise <N> <feedback>` | Re-plan that issue with the feedback; loop back to GATE C. Do NOT implement it. |
| `abort` | Stop. |

**NOTHING implements without an explicit `approve` (blanket or per-issue) at GATE C.** Anything else keeps every issue parked at the plan.

## Output / suggested next step

- **On normal completion:** defer to `implement`'s own final output — single-issue: its Phase 9 branches + PR URLs; multi-issue: its aggregated per-issue table (PR URLs / validation / deviations, with failed issues flagged by worktree path). Do not re-summarize the implementation.
- **On abort at any gate:** state which stage it stopped at and how to resume — re-run `execute <issue…>`, or jump straight to the next skill in the loop (`prime`, `grill`, `plan`, or `implement <issue…>` / `implement {{config.paths.plansDir}}/issue-<N>.plan.md`) to continue from that point.
