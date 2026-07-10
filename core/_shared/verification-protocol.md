# Review / Audit Verification Protocol

The shared reliability layer for every review and audit skill in this pack. Where
the review rubric (`{{config.review.rubricPath}}`) defines *what* these skills look
for, this file defines *how* they stay trustworthy: nothing in scope is silently
skipped, no serious finding ships without surviving a challenge, and the report
states what it did **not** do.

One file, every review/audit skill reads it — so the reliability bar can never drift
between them. Each consuming skill names, in its own pipeline, a **Verify** phase and
a **Deferred ledger** section that apply the mechanisms below, and declares which it
runs — a bounded diff needs less than a repo-wide sweep (see **Calibration**).

The consuming skills that read this file are declared in each skill's own frontmatter
and body, not hardcoded here — this protocol stays generic so new review/audit skills
can adopt it without editing this file.

---

## 1. Coverage contract — inventory first, then nothing falls through

Before judging anything, enumerate the full scope as a concrete list: every
file / endpoint / surface / test-area / hot-zone the skill is responsible for. That
list is **binding**. At the end, every item is either **(a) covered with a verdict**
or **(b) in the Deferred ledger with a one-line reason**. There is no third "silently
never looked at" bucket — that bucket is the failure this whole protocol exists to
kill.

- Build the inventory from the skill's own scope phase (the diff's changed files, the
  repo's source globs, the attack surfaces, the critical paths).
- **Rank it worst-first** so the highest-blast-radius items are examined even if the
  run is cut short: by tier (security), critical-path (tests), scaling impact
  (performance), blast-radius × churn (code-quality), or touched-surface severity
  (pr-review). A hot, frequently-edited file outranks a stable leaf carrying the same
  smell.
- If the scope is too large for one pass, that is a Deferred-ledger entry naming
  exactly what was left and why — never an unstated gap.

## 2. Adversarial verification — every serious finding survives a challenge

A finding that reaches the report has **survived an independent attempt to refute
it.** False positives are the fastest way to get an audit ignored; this is the
mechanism that kills them.

- For each **Critical / High** finding, spawn an independent skeptic whose only job is
  to **disprove** it: read the cited `file:line` in full context and argue why the
  code is actually correct — the path is unreachable, the input already validated, the
  finding a duplicate, the severity inflated.
- The skeptic **defaults to refuted when uncertain.** The burden is on the finding to
  prove it is real, not on the skeptic to prove it isn't.
- A finding the skeptic refutes with evidence is **dropped** (or downgraded, with the
  skeptic's note attached). A finding that survives ships with confidence.
- Run skeptics concurrently, respecting `{{config.execution.maxParallelSubagents}}`.
  **Diverse lenses beat repetition:** where a finding can fail more than one way, give
  skeptics distinct angles — is it reachable? is the input trusted? is it already
  handled elsewhere? is the severity right?
- **Degradation:** when the host tool lacks parallel subagents or a named-agent
  registry (`{{config.execution.hasNamedAgentRegistry}}` false, or
  `maxParallelSubagents` ≤ 1), run the same skeptic passes **sequentially** in the
  main thread — the challenge is what matters, not the concurrency.
- Medium / Low / Info findings don't each need a skeptic, but the honesty bar (§5)
  still applies — don't pad.

## 3. Loop-until-dry + completeness critic — repo-wide audits only

A single pass misses the tail. For an unbounded scope, the skill does not stop after
one sweep — it asks what it missed and goes again until a round comes back empty.

- After the first finding pass, run a **completeness critic**: a fresh reviewer asked
  *"what did this audit NOT examine — a surface never swept, a file skipped, a pattern
  only half-searched, a claim left unverified?"* Its output is the next round's
  work-list.
- Spawn a focused finder round against each gap the critic names. Repeat until a round
  surfaces **nothing new**, or a stated bound is hit (e.g. 2 consecutive dry rounds) —
  **log the bound** so a cap never reads as completeness.
- Gated to **repo-wide** scopes. A bounded diff review is its own completeness
  boundary: one completeness pass over the changed surface is enough — do not loop.

## 4. Deferred ledger — say what you did NOT do

The report carries an explicit **Deferred** section. Every item that was in scope but
given no verdict — out-of-scope by tier, N/A by gate, skipped for size, unverifiable
in CI — is listed there with a one-line reason. **Silence reads as coverage**, so
"not examined" is stated, never disguised as "clean."

- If the run bounded itself (top-N, sampled, no sibling repo available, capped
  findings), the ledger names exactly what that dropped.
- A config-gated dimension that is off (parity / i18n / contract absent from config)
  is one line here, not a finding each.

## 5. Honesty clause

Coverage you did not achieve is never implied. Severity you cannot justify is
downgraded. A finding with no concrete `file:line` + reproduction is not reported. A
clean area earns a plain "None," not an invented nit. These bind every mechanism above
— and a skill that manufactures findings to look thorough has failed this protocol,
not passed it.

## 6. Execution — orchestration & model routing

The mechanisms above (fan-out by surface, adversarial verify, loop-until-dry) are a
pipeline: *find → refute → critic-loop*. **How** it runs adapts to the host, in three
descending tiers — the pipeline's shape is identical, only the substrate changes:

- **Workflow accelerator (fastest, host-dependent).** When the host offers a deterministic
  agent-scripting / workflow runtime, run the fan-out, the per-finding skeptic, and the
  completeness loop as a **script** — the orchestration becomes free deterministic control
  flow and the driver model spends tokens only on the final synthesis. This is the biggest
  cost win where it is available.
- **Subagent orchestration (portable default).** No workflow runtime, but parallel subagents
  and a named-agent registry exist — spawn the finders and skeptics as subagents, respecting
  `{{config.execution.maxParallelSubagents}}`.
- **Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
  `{{config.execution.maxParallelSubagents}}` ≤ 1, run the same finder / skeptic / critic
  passes **serially in one thread**. The challenge and the loop are what matter, not the
  concurrency — the findings are identical, only slower.

**Model routing (all three tiers).** The finder and skeptic passes are high-volume, low-stakes
leaf work; the synthesis is low-volume, high-stakes. When the host supports per-subagent model
selection, route the finders and skeptics to `{{config.execution.cheapSubagentModel}}` (a
cheaper / faster model) and reserve the strongest model for the synthesis and the final verdict
— cheap discovery, expensive judgment only where it pays. When the config value is empty or the
host has one model, every step uses that model; the pipeline is unchanged.

---

## Calibration — which mechanisms each skill runs

| Skill | Coverage contract | Adversarial verify | Loop-until-dry | Deferred ledger |
|---|---|---|---|---|
| `pr-review` (bounded diff) | changed files, ranked by surface severity | each Critical/High before posting | one completeness pass, no loop | N/A dimensions + out-of-diff defers |
| `audit-security` (repo-wide) | attack surfaces, by tier | each in-scope-tier finding | yes, until dry | out-of-scope tiers + unswept surfaces |
| `audit-tests` (repo-wide) | critical paths, criticality-first | each Critical/High gap | yes, until dry | non-critical paths + policy-excluded suites |
| `audit-performance` (repo-wide) | hot zones, by scaling impact | each High finding | yes, until dry | enterprise-only tuning |
| `audit-code-quality` (repo-wide) | code slices, blast-radius × churn | each Critical/High finding | yes, until dry | dimensions deferred to other audits |
| `prod-readiness` (orchestrator) | the child audits + ops checks | inherits each child audit's verify | inherits each child's loop | merges every child ledger |

Severity thresholds are calibrated to `{{config.auditAnchors.scale}}` — a solo side
project and an enterprise system get proportionate findings, not the same list.

---

## Self-application

This protocol is held to its own bar. A skill that claims to run it must actually emit
the **Verify** phase and the **Deferred ledger** in its output — otherwise it is not
running it, it is only saying so. An audit that skips its own coverage contract is the
exact failure this file exists to prevent.
