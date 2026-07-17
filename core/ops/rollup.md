# Rollup: Cross-Repo CI Health Verdict

> **Config inputs:** `config.repos`, `config.ci.provider`, `config.ci.gates`, `config.pr.baseBranch`

**Input**: none.

A thin cross-repo CI-health roll-up. For every repo in `{{config.repos}}`, it reads the **latest
base-branch run** of each tracked quality gate in `{{config.ci.gates}}` and prints ONE consolidated
**GREEN / RED** verdict with an exit code. It **reads run conclusions only** — it executes no tests,
runs no build, and audits nothing. This is a mechanical status meta-read, distinct from `validate`
(which *executes* lint/type/test) and from the audits / `prod-readiness` (which re-derive findings).

This is a **generic runbook**. The CI provider is read from `{{config.ci.provider}}` and this skill is
meant to be **machine-specialized** by `setup-harness` (which fills in the exact provider and the list
of tracked gate/workflow names for the machine).

## Operating rules

- **Read-only.** It inspects run conclusions; it never opens an issue, edits a file, re-runs a gate,
  or triggers a deploy. Reporting a red verdict is the whole output — acting on it is not this skill's job.
- **Latest run per gate.** For each gate in `{{config.ci.gates}}`, read only its most recent run on
  `{{config.pr.baseBranch}}`. Older runs and PR-branch runs are ignored — the question is "is the base
  branch healthy right now?", not "was it ever red?".
- **One verdict.** Collapse every gate's latest run into a single GREEN/RED line plus an exit code.
  Do not emit a per-gate wall of green checks as the headline — the roll-up is the point.

## Degrade — no CI provider configured

If `{{config.ci.provider}}` is empty or unset, there is no run history to read. Report **UNAVAILABLE**
(exit 2) with the reason "no CI provider configured" and stop — do not guess a verdict, and do not fall
back to running the gates locally (that is `validate`'s job, not this skill's).

## Read the runs

Using `{{config.ci.provider}}` (its CLI or API — e.g. reading run conclusions, never launching a run),
for each repo in `{{config.repos}}`:

- For each gate in `{{config.ci.gates}}`, resolve its latest run on `{{config.pr.baseBranch}}` and read
  that run's conclusion only.
- Classify each latest run as **pass**, **fail**, **pending** (a run in progress), or **no-run** (the
  gate has no base-branch run yet).
- If a tracked gate no longer resolves on the base branch (renamed / deleted upstream, so the tracked
  list in config drifted), that is a **tool error**, not a pass — surface it distinctly.

The provider must be reachable and authenticated for public/private repos as the machine requires; if it
is unreachable or unauthenticated, that is a tool error (exit 2), not a red gate.

## Blocking vs advisory gates

`{{config.ci.gates}}` marks each gate **blocking** or **advisory** — that split is the config's, defined
once alongside the gate list; do not re-derive or fork it here.

- **Blocking gates** decide the verdict. A single blocking gate whose latest base-branch run failed makes
  the whole roll-up **RED**.
- **Advisory gates** are reported for visibility but never flip the verdict. An advisory failure is noted
  in the report and the roll-up can still be GREEN.

`pending` and `no-run` count as **green-with-note** for both tiers — an in-progress or never-run gate is
not a failure.

## Present the result

Show the per-repo / per-gate table the read produced, then the one-line verdict and its exit code:

- **GREEN (exit 0)** — every **blocking** gate's latest base-branch run is healthy (pass, pending, or
  no-run). Note any advisory failures beneath the verdict.
- **RED (exit 1)** — at least one blocking gate's latest base-branch run failed. Name the failing gate(s)
  and their repos explicitly; that list is the actionable core of the report.
- **TOOL ERROR / UNAVAILABLE (exit 2)** — `{{config.ci.provider}}` is empty/unset, unreachable, or
  unauthenticated, or a tracked blocking gate no longer resolves on `{{config.pr.baseBranch}}` (the config
  drifted). It is neither a green nor a red gate — surface it as its own state so it is never mistaken for
  a healthy base branch.
