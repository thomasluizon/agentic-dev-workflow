# Audit Tests

> **Config inputs:** `config.repos`, `config.auditAnchors.criticalPaths`, `config.auditAnchors.scale`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: a path, a repo name, or blank (all repos in `{{config.repos}}`).

Audit the **quality** of the test suites across the repos in `{{config.repos}}` — whether the
tests that exist actually pin behavior on the paths that matter, not how green the coverage bar
is. A repo can be 90% covered and still untested where it counts. Output: where the critical
paths are thin, which tests rubber-stamp the happy path, and the concrete tests to add.

**Golden rule**: judge tests by what they'd *catch*, never by how many there are. A test that
can't fail when the behavior breaks is worse than no test — it's a false sense of safety. Every
finding names the file, what it fails to catch, and the specific test to add.

---

## Phase 0 — Self-containment

**Self-contained**: no network call at run time, no marketplace dependency. It reads local test +
source files and runs `git` / `rg`; it does **not** run the suite (that's the `validate` skill) —
it *reads* the tests. Works unchanged in CI. Respect the project's testing policy from the
conventions docs (e.g. unit-only): if you find a test type the project deliberately excluded, flag
it as out-of-policy, don't reward it.

---

## Phase 1 — Resolve scope & load context

Parse the input: blank → **all repos in `{{config.repos}}`**; a repo name / role → that repo; a
path → just that path. Discover each repo's test layout and factories/builders from the
conventions docs and the source tree.

Load `audit-tests.rubric.md` (read first — it defines what "intelligent" means), the project's
testing-policy conventions docs, the test factories/builders (so suggested tests use the real
builders), and **`_shared/verification-protocol.md`** (the shared reliability contract — its
Verify phase and Deferred ledger run below).

---

## Phase 2 — Map the critical paths first

Before judging individual tests, identify the paths where a silent break hurts most — anchored on
`{{config.auditAnchors.criticalPaths}}` — and ask of each: **is there a test, and would it
actually fail if the behavior broke?** The rubric's critical-path table names what a real test
must pin for each family (auth, billing/entitlement, AI/agent tools, data-isolation,
date/timezone, validation).

A critical path with **no test**, or only a happy-path test, is the audit's top-priority finding —
tag it **Critical**.

---

## Phase 3 — Fan out and apply the rubric per test

Delegate to subagents, respecting `{{config.execution.maxParallelSubagents}}` (default 3
concurrent), each owning a non-overlapping test area, each scoring tests against
`audit-tests.rubric.md`. Slice by suite location (per app / shared / per backend layer). Each
subagent prompt embeds:

> **Objective**: audit the tests in `<area>` against `audit-tests.rubric.md`. **Read the rubric
> first.** For each test file: (1) does it cover a critical path from the skill's Phase-2 map? (2)
> score it Behavior / Edge / Failure per the rubric; (3) flag happy-path-only and rubber-stamp
> tests (assert-nothing, asserts a mock was called, tautological, over-mocked so the real code
> never runs). For each gap, write the **concrete missing test** — name it, state the
> arrange/act/assert, and use the real factories. Return findings only.

Apply the rubric's smell list (happy-path-only, rubber-stamp, over-mocked, implementation-coupled,
missing edge, missing failure, snapshot-as-crutch).

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, walk the test areas **serially in one thread** —
same rubric, no concurrency.

---

## Phase 4 — Verify (adversarial + completeness)

Before writing the report, run `_shared/verification-protocol.md` — a gap ships only after it
survives a challenge, and the sweep must prove it covered the paths that matter.

1. **Adversarial pass (§2).** Refute before shipping — but **bound the fan-out** so the audit
   stays affordable on a systemically-weak suite (where Critical/High findings can run to dozens).
   **Every Critical finding gets its own skeptic; High findings are batched (one skeptic per ~5,
   grouped by area) or capped at the top 15 by leverage, the remainder rolled into Deferred.** Each
   skeptic reads the cited test + source in full context and argues the gap is a false positive
   (pinned by a test elsewhere, the test *would* fail on a real break, a duplicate, the severity
   inflated). Default to refuted when uncertain. Drop or downgrade anything the skeptic disproves.
   Respect `{{config.execution.maxParallelSubagents}}`.
2. **Completeness critic + loop-until-dry (§3).** Run a fresh critic asking *"what did this audit
   NOT examine — a critical path never mapped, a test area skipped, a suite only half-read?"* Spawn
   a focused finder round on each gap it names; repeat until a round surfaces nothing new (cap: 2
   dry rounds — log it).
3. **Deferred ledger (§4).** Roll everything in scope but un-verdicted (non-critical paths not
   scored, policy-excluded suites, a suite left unread) into the report's **Deferred** section, one
   reason each — never implied as covered.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the skeptic passes and the completeness/loop
rounds **serially in the main thread**.

---

## Phase 5 — Report

**Output path**: `{{config.paths.auditsDir}}/tests-{scope}.md` (create the dir if absent).

```markdown
# Test-Quality Audit: {SCOPE}

**Scope**: {all repos / repo / path}
**Rubric**: intelligent-test rubric (behavior + edge + failure)
**Verdict**: {1 line — e.g. "Critical paths covered except the payment webhook rejection; 3 happy-path-only suites"}

## Suite health — the scale of the rot

> Quantify it so pervasive weakness reads as a number, not something buried in a list of
> individual findings. This is the section that answers "are our tests systemically bad?"

- **Files scored**: {N} of {total}
- **Behavior-only (happy-path)**: {X} ({X/N %})
- **Carry a smell** (rubber-stamp / over-mocked / assertion-free / impl-coupled / snapshot-crutch): {Y} ({Y/N %})
- **Pin behavior on all three axes**: {Z} ({Z/N %})
- **One-line read**: {e.g. "~60% happy-path-only — the green bar is mostly theater" vs "largely healthy; gaps are localized"}

## Critical-path coverage

| Path | Tested? | Quality | Gap |
|---|---|---|---|
{one row per path in {{config.auditAnchors.criticalPaths}} — tested yes/no · strong/happy-only/none · what's missing}

## Findings

### Critical — untested critical path
{path + the exact test to add, or "None"}

### High — happy-path-only / rubber-stamp on a critical path
{file + why it can't catch a break + the test to add, or "None"}

### Medium — missing edge/failure case off the critical path
{… or "None"}

## Fix first — top 10 by leverage

{The 10 highest-leverage tests to write or rewrite FIRST, ranked — so a systemically-weak suite is
actionable instead of paralyzing. Each: one line · severity · the path it protects. Fewer than 10
only if the suite is healthy.}

## Concrete tests to add

{A numbered, ready-to-write list. Each: name · file it goes in · arrange/act/assert · the factory
to use. This is the actionable core — make it copy-pasteable-into-a-task.}

## Tests to delete or rewrite — false safety

{Existing tests to REMOVE or rewrite because they give false safety (rubber-stamp / assertion-free
/ tautological / snapshot-as-crutch). Deleting a test that can't fail is a real, valuable action.
Each: file:line · which smell · delete vs rewrite · if rewrite, the observable assertion that would
make it real.}

## Deferred — in scope but not verdicted

{Per verification protocol §4: paths or test areas the sweep did not score with a verdict, suites
left unread, policy-excluded suites — each with a one-line reason. "Nothing deferred — full
coverage" if the contract was met.}

## What's well-tested

{Suites that genuinely pin behavior — name them so they're not "improved" into noise.}
```

---

## Guardrails — do NOT

- **Score by count or coverage %.** A green bar over rubber-stamp tests is the exact failure this
  audit exists to catch. Judge by what a test would *fail on*.
- **Reward implementation-coupled tests.** A test asserting call-order / private state is a
  liability; flag it even if it "passes."
- **Suggest test types the project excludes by policy.** Respect the conventions docs; suggest the
  sanctioned test kind.
- **Run the suite.** This reads tests; the `validate` skill runs them.
- **Pad with vague advice.** Every finding ships the concrete test to add — name, location,
  assertions — or it isn't a finding.
- **Write the tests during the audit.** Findings + concrete specs first; implement only if the
  user asks after.

---

## Output

```markdown
## Audit Complete — Test Quality

**Scope**: {what was audited}
**Verdict**: {1-line}
**Suite health**: {X}% happy-path-only · {Y}% smell-carrying · {Z}% pin all three axes (of {N} files scored)

| Severity | Count |
|---|---|
| Critical (untested critical path) | {N} |
| High (rubber-stamp / happy-only on critical path) | {N} |
| Medium (missing edge/failure) | {N} |

**Report**: `{{config.paths.auditsDir}}/tests-{scope}.md`
**Fix first**: {the single most important test to write or delete first}
```
