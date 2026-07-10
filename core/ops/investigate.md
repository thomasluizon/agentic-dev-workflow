# Investigate: Production Incident Root-Cause

> **Config inputs:** `config.repos`, `config.investigate.errorTracker`, `config.investigate.deployPlatform`, `config.investigate.prodDataQuery`, `config.investigate.codeNav`, `config.parity.enabled`, `config.contract.backwardCompat`

**Input**: an error-tracker issue id / URL, or a short description of the incident.

Diagnose a live incident against the real systems — the error tracker, the deploy platform,
the production datastore, and the code — and hand back a root cause plus the **minimal** fix.
Every claim is pinned to evidence a tool returned; nothing is guessed.

This is a **generic runbook**. The concrete tools are read from `{{config.investigate.*}}` and
this skill is meant to be **machine-specialized** by `setup-harness` (which fills in the exact
error tracker, deploy platform, prod-data query path, and code-nav capability for the machine).
Where a binding is absent, use the generic fallback named in each phase and record the gap.

## Operating rules

- **Read-only until the gate.** Phases 0–5 only *inspect* (the error tracker, deploy logs, a
  read-only prod-data query, code navigation). No edits, no data mutation.
- **Human gate before Phase 6.** Present the root cause + proposed fix and **STOP**. Do not
  touch a file until the user approves. Autonomy within the investigation; a gate before the change.
- **Root cause, not symptom.** Name the upstream cause — a missing validator, a nullable that
  should not be, contract drift, a migration gap. No workaround that masks it.
- **Verify, don't guess.** Each finding traces to an error event, a deploy log line, a data row,
  or a code line. If a step's tool is unreachable, say so and continue — don't invent its output.

## Phase 0 — Frame the incident

Parse the input:
- An error-tracker issue id / short-id / URL → go straight to it.
- A description ("signup 500s", "widget crash on some devices") → search the error tracker for
  the matching issue.

Identify which repo/service in `{{config.repos}}` the incident belongs to.

## Phase 1 — Error tracker: what broke

Using `{{config.investigate.errorTracker}}` (e.g. its MCP or CLI): pull the issue → exception
type, culprit, level, first/last seen, event count, affected releases + environments. Pull a
representative event → full stack trace, breadcrumbs, request context, tags, affected-user data.
If the tracker offers an AI root-cause hypothesis, treat it as a lead to verify against evidence,
never as fact. **Fallback (no tracker configured):** ask the user for the stack trace / error text.

**Capture:** the exact exception + message, the top **in-app** stack frame (`file:line`), the
release it started in, and how often / who it hits.

## Phase 2 — Deploy platform: what changed and what the runtime saw

Using `{{config.investigate.deployPlatform}}` (e.g. its MCP or CLI): find the deploy whose window
brackets the issue's first-seen — did the error start right after a deploy? which commit? Read the
runtime logs across the incident window for the affected service — the lines around the error
timestamps (context the error event may lack). If the platform needs a workspace/project
selected, confirm the choice with the user first; never auto-pick a destructive-capable context.
**Fallback (no platform configured):** correlate first-seen against `git log` on the deployed
branch.

**Capture:** the suspect deploy + commit if the error is deploy-correlated (or "not
deploy-correlated"), and any runtime log detail the error event is missing.

## Phase 3 — Production data: what the data says (only if the fault implicates data)

Using `{{config.investigate.prodDataQuery}}` — **read-only**. Inspect the rows the stack trace
implicates: the offending record, an unexpected null, a violated constraint, a duplicate, the
affected user's state. Never `UPDATE` / `DELETE` / `INSERT`. Confirm or kill the data hypothesis
with a read-only query. **Fallback (no prod-data access):** reason from the code + logs and mark
the data hypothesis unconfirmed.

**Capture:** the row-level evidence, or "data not implicated."

## Phase 4 — Localize to code

From the top in-app frame, use `{{config.investigate.codeNav}}` when it is a semantic navigator
(e.g. an LSP MCP): find the symbol → the method; find callers / references → how it is reached
with the bad input; diagnostics on the file; the type hierarchy / implementations when the frame
is an interface / virtual dispatch. **Fallback (no code-nav):** Grep/Read the implicated module
and its shared types across the repos in `{{config.repos}}`.

**Capture:** the exact `repo/path:line` of the fault and the code path that triggers it.

## Phase 5 — Root cause

One tight paragraph: the exact line + the condition that triggers it + why the deploy / data /
input produced it *now*. Point at the upstream cause, not the thrown symptom.

## Phase 6 — Propose the minimal fix — THEN STOP (human gate)

Present, and wait for approval before any edit:

- **Root cause** — one paragraph.
- **Minimal fix** — `file:line` → the smallest correct change that removes the cause (not a
  defensive branch around it). Flag: cross-platform parity if `{{config.parity.enabled}}` and it
  is a mirrored UI/shared change; backward-compat if `{{config.contract.backwardCompat}}` applies
  and it touches the shared contract.
- **Regression test** — the test that would have caught this, to add with the fix.
- **Blast radius / verification** — what to run after (`validate`, a targeted test), and what
  else the change touches.

On approval: implement with parity (if applicable) + the regression test, then hand to `validate`
(or `pr-review`). Do not edit before approval.

## Output — the incident dossier (rendered before the gate)

```
## Incident: {exception} ({tracker-short-id})

- **Seen**: first {…} · last {…} · {N} events · {environment} · {who}
- **Deploy correlation**: {commit / deploy} — or "not deploy-correlated"
- **Data**: {row evidence} — or "not implicated"
- **Fault**: {repo}/{path}:{line} — {the trigger path}
- **Root cause**: {one paragraph}
- **Proposed fix (awaiting approval)**: {file:line → change} + {regression test} + {verification}
```
