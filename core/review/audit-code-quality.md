# Audit Code Quality

> **Config inputs:** `config.repos`, `config.review.rubricPath`, `config.review.correctnessScanners`, `config.parity.enabled`, `config.contract.enabled`, `config.auditAnchors.scale`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: a path, a workspace/repo name, or blank (all repos in `{{config.repos}}`).

Walk the **whole repo** (or a scoped path) against the rubric at `{{config.review.rubricPath}}` —
the *same* rubric `pr-review` walks over a diff — and produce one severity-ranked report of real
quality debt. `pr-review` reviews what changed; this audits what *exists*.

**Golden rule**: every finding cites a `file:line` and the rubric rule it traces to, and carries a
concrete fix. No vibes, no "consider maybe" — if it can't be pinned to a line, it isn't a finding.

---

## Phase 0 — Shared rubric & self-containment

This skill **shares one rubric file** with `pr-review`: the copy at `{{config.review.rubricPath}}`.
There is no second copy and no fork of the rules — both skills read that exact file, so the
diff-review and the repo-audit can never drift.

**Self-contained**: no network call at run time, no marketplace dependency. It reads local repo
files and runs `git` / `rg` against the project's own checkout, so it works unchanged in CI.

---

## Phase 1 — Resolve scope

Parse the input into a target and the repos it covers: blank → **all repos in `{{config.repos}}`**,
source dirs only; a repo/role/workspace name → that repo (or workspace); a path → just that file or
folder.

**Exclude from the walk** (never audit generated / vendored / test-fixture code): dependency dirs,
build output, coverage, generated migrations, vendored design/asset canon, lockfiles, and the
pack's own tooling dir. Use the project's source extensions. Test files are in-scope for
naming/size/dead-code but exempt from the debug-logging and comment-narration rules.

---

## Phase 2 — Load context

In parallel:

- **The rubric at `{{config.review.rubricPath}}`** — the dimensions, severities, and finding
  template this audit walks. **This is the contract; read it first.**
- The conventions docs for each repo/workspace in scope.
- The design canon — only if frontend/UI files are in scope (rubric dimension 8).
- The project's comment-lint rule — the exact rule dimension 4 mirrors.
- **`_shared/verification-protocol.md`** — the shared reliability contract; its Verify phase and
  Deferred ledger run below.

---

## Phase 2.5 — Configured correctness scanners (deterministic, before the fan-out)

Before the judgement fan-out, run every deterministic correctness scanner configured in
`{{config.review.correctnessScanners}}` — a stack-specific static analyzer that catches
mechanical correctness bugs (state/effects, hydration, perf, a11y, type-safety) that an LLM
finder reading prose misses. This list is **optional and stack-agnostic**: a React project might
configure a React-correctness scanner, a Go project a vet-style linter, a Python project a
type/async checker — the pack assumes none of them. **If `{{config.review.correctnessScanners}}`
is empty, SKIP this phase entirely and note "no correctness scanners configured" in the
Coverage table.**

For **each** scanner whose `scope` (a list of repo roles) intersects the repos/workspaces in
play — skip a scanner whose scope doesn't match the resolved scope, it is a legitimate skip, not
a gap:

1. **Run its `command`** against the in-scope roots. Treat the command as the scanner's own
   invocation contract — do not assume a fixed tool, flag set, or output format.
2. **Apply its `excludeGlobs`** so vendored / generated / design-mockup paths never produce
   findings (e.g. a design-handoff dir whose mockups throw thousands of false diagnostics).
3. **Map severity from the scanner's own levels:** each scanner **error → its `errorSeverity`
   (default `High`)**, each scanner **warning → its `warningSeverity`** (default `Low`/`Info`).
4. **Tag each finding** `[{scanner.name} · {rule}]` and carry the exact `file:line` and the
   rule's fix into the standard finding template. Group the (typically many) warnings by rule
   with a count rather than listing each instance.

Fold every scanner finding into the same severity buckets as the rubric findings in Phase 6.
These are **report-only** like the rest of the audit — surface them, do not fix here.

> *Example (illustrative only, never required):* a React-correctness scanner configured as
> `{ name: react-doctor, command: "npx react-doctor …", scope: [web, mobile],
> errorSeverity: High, warningSeverity: Low, excludeGlobs: ["design/handoff/**"] }` maps its
> real-bug errors to High and its perf/a11y nits to Low/Info, tagged `[react-doctor · {rule}]`.

---

## Phase 3 — Fan out the audit by area

A whole-repo walk is large; fan out subagents, respecting `{{config.execution.maxParallelSubagents}}`
(default 3 concurrent), each owning a non-overlapping slice and returning findings in the rubric's
finding template. Slice by area (per app / shared / per backend layer) so two agents never read the
same files. Each subagent prompt embeds:

> **Objective**: audit `<slice path>` against the rubric at `{{config.review.rubricPath}}`,
> dimensions `<list>`. **Read the rubric first.** For every issue, emit the rubric's finding
> template with an exact `file:line`, a severity from the ladder, and a concrete fix. **Run
> zero-reference greps to prove dead code** (don't guess). Exclude generated/vendored dirs. Return
> findings only — no narration, no padding.

Skip **parity (#9)** for a single-app scope or when `{{config.parity.enabled}}` is false (nothing
to mirror against) and the **design-system dimension (#8)** when the slice has no UI. Drop the
diff-only dimensions: **contract drift / backward-compat (#11)** (owned by `pr-review`; also inert
unless `{{config.contract.enabled}}`) and the **security** orchestration (#12, owned by
`audit-security`) — note them as "covered by audit-security" rather than re-deriving here.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, walk the slices **serially in one thread** —
same rubric, no concurrency.

---

## Phase 4 — Apply the rubric (what changes for a repo-wide audit)

The rubric was written for a diff; two of its rules need recalibration when the surface is the
entire repo:

- **Signal gate (rubric):** on a PR, Low/Info are noise and get dropped. **A deep audit is the
  sanctioned exception** — the rubric itself allows a local deep audit to list Low/Info. So **keep**
  Low/Info here, but bucket them separately so the Critical/High debt stays legible. Still never
  manufacture a finding to pad the list.
- **"Focus on changed code":** there is no diff — every source line is fair game. But **rank by
  blast radius and churn**: a SOLID violation in a hot, frequently-edited handler outranks the same
  smell in a stable leaf file. Lead with what hurts most.

Walk every in-scope dimension. The high-value ones for a standing codebase:

- **Dead / stale code (#2)** — the audit's flagship. Hunt orphaned exports, unreachable branches,
  commented-out blocks, stub functions, and speculative parameters across the *whole* tree (a diff
  can't see these; an audit can). **Prove each with a zero-reference grep** — cite the command and
  its empty result.
- **SOLID / clean-arch (#3)** — functions over the ~50-line soft cap / ~100 hard cap, nesting past
  ~3, premature abstraction, and DRY-at-the-wrong-level. List the worst offenders by line count.
- **Comment policy (#4)** — flag a comment exactly where the comment-lint rule would. The fix is
  rename-the-symbol / extract-a-function, never "reword."
- **Naming** — `data` / `info` / `temp` / `helper` / `util` as final names, abbreviations, names a
  stranger can't guess from the call site.
- **Design-system drift (#8)** — raw palette references, hardcoded accent values, catch-all
  transitions, viewport-locked heights, cards-in-cards, the AI-slop tells. Gated to frontend/UI
  files.

---

## Phase 5 — Verify (adversarial + completeness)

Before writing the report, run `_shared/verification-protocol.md` — a finding ships only after it
survives a challenge, and the sweep must prove it covered the tree.

1. **Adversarial pass (§2).** For every **Critical / High** finding, spawn an independent skeptic
   subagent whose only job is to *refute* it — read the cited `file:line` in full context and argue
   it is a false positive (the reference actually exists so it is not dead — re-run the grep, the
   function is within the cap, the abstraction is intentional and defensible, a duplicate). Default
   to refuted when uncertain. Drop or downgrade anything the skeptic disproves. Respect
   `{{config.execution.maxParallelSubagents}}`.
2. **Completeness critic + loop-until-dry (§3).** Run a fresh critic asking *"what did this audit
   NOT examine — a code slice never swept, a directory skipped, a dead-code claim unproven by a
   grep?"* Spawn a focused finder round on each gap it names; repeat until a round surfaces nothing
   new (cap: 2 dry rounds — log it).
3. **Deferred ledger (§4).** Roll everything in scope but un-verdicted (dimensions owned by
   `audit-security` and `pr-review`, a slice left unswept) into the report's **Deferred** section,
   one reason each — never implied as clean.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the skeptic passes and the completeness/loop
rounds **serially in the main thread**.

---

## Phase 6 — Report

**Output path**: `{{config.paths.auditsDir}}/code-quality-{scope}.md` (create the dir if absent).

```markdown
# Code-Quality Audit: {SCOPE}

**Scope**: {all repos / workspace / path}
**Rubric**: {{config.review.rubricPath}} (shared with pr-review)
**Health**: {1-line verdict — e.g. "Solid; 2 dead exports + 1 oversized handler"}

## Findings

### Critical
{rubric-template findings, or "None"}

### High
{… or "None"}

### Medium
{… or "None"}

### Low / Info
{audit-only bucket — dead nits, minor naming, micro-cleanup. "None" if clean.}

## Hotspots

{The 3-5 files carrying the most debt, ranked. One line each: file — what's wrong.}

## Coverage

| Area | Audited | Notable |
|---|---|---|
{one row per repo/workspace in scope — yes/no · count by severity}

**Correctness scanners**: {for each in `{{config.review.correctnessScanners}}`: name · ran/skipped
(scope match) · error+warning counts — or "none configured" if the list is empty}

## Deferred — in scope but not verdicted

{Per verification protocol §4: slices the sweep did not reach with a verdict, dimensions deferred to
audit-security or pr-review, capped coverage — each with a one-line reason. "Nothing deferred — full
coverage" if the contract was met.}

## What's good

{Genuine strengths — patterns worth keeping. Not filler.}
```

When `{{config.parity.enabled}}` is true and the scope is a single app, cross-check parity intent: a
dead export on one side of a mirror whose counterpart is still live on the other side is a parity
finding, not just dead code — call it out.

---

## Guardrails — do NOT

- **Fork the rubric.** Read `{{config.review.rubricPath}}`; never inline a copy of the dimensions
  here. One file, zero drift.
- **Re-run pr-review's diff job.** This audits the repo as it stands, not a change.
- **Re-derive security or contract findings.** Point at `audit-security` and `audit-tests`; stay in
  the quality lane.
- **Guess at dead code.** Every dead-code finding carries the zero-reference grep that proves it.
- **Refactor during the audit.** Findings first; write code only if the user asks after.
- **Pad the list.** A clean area gets "None," not invented Low nits.
- **Audit generated / vendored code.**

---

## Output

```markdown
## Audit Complete — Code Quality

**Scope**: {what was audited}
**Health**: {1-line verdict}

| Severity | Count |
|---|---|
| Critical | {N} |
| High | {N} |
| Medium | {N} |
| Low / Info | {N} |

**Report**: `{{config.paths.auditsDir}}/code-quality-{scope}.md`
**Top fix**: {the single highest-leverage thing to do first}
```
