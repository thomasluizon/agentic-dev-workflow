> **Config inputs:** `config.issueTracker.repo`, `config.issueTracker.host`, `config.pr.baseBranch`, `config.branchNaming.pattern`, `config.worktree.branchPattern`, `config.paths.plansDir`, `config.execution.headlessCommand`

# Night Run: unattended overnight queue-drain

**Input**: one or more issue numbers, `--label <label>`, `--backlog <file>`, `status`, or `stop`.

Turn a list of tasks into finished, reviewable work by morning. A detached driver loop walks a queue and spawns **one fresh non-interactive agent session per task** — the host tool's headless mode (e.g. `claude -p` for Claude Code), invoked via `{{config.execution.headlessCommand}}` (fall back to the host default when it is empty). Every task therefore starts with a clean context window instead of one long session that rots. Each task ends at a **draft PR** on its own branch. Nothing merges. The protected base branch (`{{config.pr.baseBranch}}`) is never touched.

This is the automation of the split-session campaign pattern — one stage per fresh session, state externalized to files and git, a human gate between phases. It is the unattended twin of `drive`: `drive` conducts one epic across sessions **with you in the loop**; `night-run` drains many well-formed slices **while you sleep**. Overnight *throughput* is automated; overnight *merge* is not. You wake up to PRs to review.

## Why this shape (do not "simplify" it away)

- **A fresh session per task**, driven by an external loop, because a live agent session driving children taints their environment and rots its own context. The driver holds no task context of its own.
- **The child inherits the project hooks**, so the git guardrails already block any push to `{{config.pr.baseBranch}}`, force-push, and unsigned/`--no-verify` commits from inside each task. That is the primary guardrail, doing real work for free.
- **Prepare, not merge.** Branch per task, draft PR, back to base. Recoverable by construction.

## Mode detection

Parse the input:

- `status` -> **Report mode** (skip to the bottom). Read the latest run's status artifacts and list the draft PRs.
- `stop` -> **Stop mode**. Drop a `STOP` sentinel in the run directory; the driver halts gracefully before its next task. For an immediate stop, kill the driver process.
- anything else (issue numbers, `--label X`, `--backlog file`, or a free description) -> **Setup + launch** (phases below).

---

## Phase 0 — Resolve the queue

Turn the input into a concrete task list. Do NOT ask if you can infer it.

- **Issue numbers** (`72 73 80`) -> those issues in `{{config.issueTracker.repo}}`.
- **`--label <label>`** -> list open issues from `{{config.issueTracker.host}}` via its issue CLI (e.g. `gh issue list --state open --label <label>` on GitHub) and take the matches.
- **`--backlog <file>`** -> each non-empty, non-`#` line is one free-form task (greenfield/refactor work, no issue).
- **Free description with no ids** -> propose a queue from open issues in `{{config.issueTracker.repo}}` that match, and confirm the set once (a single question, the matched issues pre-selected).

For each task capture: a stable `id` (issue number, or `b1`, `b2` for backlog lines), a short `label`, the source `body`, and the target repo. Order by dependency (a task that unblocks others goes first); note the order. A single task is normal — a queue of one is the common case. Scale is not the question; *shape* is.

### Fit gate — is each task a night-run task?

A night-run task must be an unattended **slice**: bounded, with clear acceptance criteria, no open design decision, and self-contained enough to finish in one PR. Screen every task and EXCLUDE any that is:

- **A campaign / converging-metric / multi-phase issue** ("Phase 1... Phase 2...", "loop X to convergence", "drive the whole codebase to zero"). Too big for one fresh session and one PR — a converging-metric campaign needs a human reading the metric between passes.
- **Gated on an open question** ("confirm 100% vs 80%?", any unresolved design choice). Unattended, the child would just guess.
- **Sequenced after other unmerged work** ("do this after everything else is merged"). night-run cannot reason about cross-issue ordering.
- **Whole-repo blast radius.** Sprawling mechanical changes are exactly what a single unattended session does worst.

For each excluded task, report it as `not a night-run task -> decompose into slices first, or run it interactively (execute, or the campaign loop)` and leave it out of the queue. If EVERY task is excluded, say so and stop — do not launch an empty run. A well-formed slice in, a reviewable PR out; a campaign in just burns budget.

## Phase 1 — Generate a self-contained prompt per task

Each child starts with a clean context, so its prompt must carry everything. Write one prompt file per task from the issue/backlog content, filling this template:

```
You are running UNATTENDED overnight as an autonomous engineer. No human will
answer questions. Proceed to completion on your own judgement; do not stop to ask.

TASK: <label>
<the issue body / backlog line, verbatim, plus any acceptance criteria>

Follow the project workflow and conventions (already loaded):
1. Ensure you are on an up-to-date base branch, then create a task branch
   following {{config.branchNaming.pattern}}.
2. Implement the change. Honor every cross-cutting consistency rule the project
   documents (cross-platform parity, paired i18n keys, paired backend changes) —
   a partial change that skips its mirror is a defect, not a smaller task.
3. Add/extend behavior tests for what you changed.
4. Run the relevant validation (lint, typecheck, tests) and fix what you broke.
5. Commit with a clear message. Push the branch. Open a DRAFT PR. For cross-repo
   work, open the paired PR and cross-link them.

HARD RULES:
- NEVER merge. NEVER push to or commit on the protected base branch
  ({{config.pr.baseBranch}}). NEVER force-push. (Hooks enforce this.)
- If you cannot finish safely, commit WIP to the branch, open a DRAFT PR
  describing exactly what is blocked and why, and exit. A blocked-but-documented
  task is a success.
- Keep changes surgical and scoped to this task.

END your final message with EXACTLY one line of JSON (no fences):
{"task":"<id>","status":"done"|"blocked"|"failed","pr":"<url or null>","summary":"<one sentence>"}
```

Keep each prompt tight and specific. The `status` JSON line is how the driver records the outcome, so it is required.

## Phase 2 — Write the run artifacts

Into the driver's runtime directory (gitignored; create it if missing):

- **`config.json`** — the run knobs: `perTaskBudgetUsd`, `totalBudgetUsd` (size it to the queue), model + fallback, permission posture, and the repos the child may write to (add a sibling repo only if a task needs a cross-repo change). Confirm any absolute repo paths match this machine.
- **`queue.json`** — array of `{ "id", "label", "repo" }` in run order.
- **`prompts/task-<id>.md`** — one per task (Phase 1).

Task-specific planning notes, if any, live under `{{config.paths.plansDir}}` as usual — the prompt points the child at them.

## Phase 3 — Preflight (dry run)

Run the driver's preflight without spawning anything. It verifies the headless agent is runnable, the forge CLI is authenticated (if pushing), every repo is a clean git tree on its base branch, then prints the tasks it would run. Fix anything it flags (usually: commit/stash a dirty tree) before continuing.

## Phase 4 — GATE: present the plan and STOP

Show the operator, and wait for an explicit "go" before launching anything that spends money:

- the ordered task list (id + label + repo), and any excluded "needs grooming" tasks
- **per-task budget cap** and **total budget cap** (the hard ceiling that halts the run)
- **permission posture**: the child runs in a non-interactive posture that never stalls on a prompt (e.g. bypass-permissions). The inherited hooks + branch-per-task + budget caps are the real guardrails; any tool denylist is an accident guard, not a boundary. Flag this plainly so the operator can lower it.
- **push/PR**: draft PRs will be opened tonight (CI and review bots will run on them)
- model + fallback

Do not launch before the operator says go. (Autonomy within the run; a gate before it starts.)

## Phase 5 — Launch (after "go")

The driver must run **detached** so it survives this session ending. Give the operator the launch command and let them run it, or launch it yourself if the machine will stay on. Either way the driver logs to a run directory (`runs/<timestamp>/` with `run.log` + `STATUS.md`), so progress is on disk regardless.

Note: the machine must stay awake (sleep pauses the run). Then hand over: the run-directory path, the total-budget ceiling, and "check progress with `night-run status`."

---

## Report mode (`night-run status`)

1. Find the newest run directory. Read its `SUMMARY.md` if the run finished, else `STATUS.md` + the tail of `run.log`.
2. List the draft PRs each repo opened (the forge CLI's own draft-PR listing for the current author), cross-checked against the run's recorded PRs.
3. Summarize: tasks done / blocked / failed, total spent vs. cap, and a one-line next-step per PR (which to review first). Flag any task that tripped the circuit breaker.

## Stop mode (`night-run stop`)

Drop a `STOP` sentinel in the run directory — the driver finishes the current task, then halts before the next (no half-done task). For an immediate hard stop, kill the driver process; the in-flight task's branch keeps whatever it committed.
