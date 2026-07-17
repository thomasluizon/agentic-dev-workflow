# PR Review

> **Config inputs:** `config.repos`, `config.pr.baseBranch`, `config.review.rubricPath`, `config.review.backendHardRules`, `config.review.frameworkTokens`, `config.parity.enabled`, `config.parity.mirrors`, `config.i18n.locales`, `config.i18n.paths`, `config.contract.enabled`, `config.contract.clientTypesGlob`, `config.contract.serverTypesGlob`, `config.contract.backwardCompat`, `config.secondOpinion.enabled`, `config.secondOpinion.model`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: a PR number / URL, a file, a folder, or blank (staged changes).

Review a diff end-to-end against the rubric at `{{config.review.rubricPath}}`, fold in the
config-gated review dimensions, guard against changes that break already-shipped clients, and
produce one severity-ranked report — posted to the PR when the scope is a PR.

**Golden rule**: every finding is constructive and actionable — a clear fix, a `file:line`, and
the rule it traces to. Severity is about blast radius, not which dimension raised it.

---

## Phase 1 — Resolve scope

Parse the input into a review target and detect which of `{{config.repos}}` it touches.

| Input | Repo | Action |
|---|---|---|
| A bare number `123` | the primary repo in `{{config.repos}}` | fetch that PR via the host's PR tooling |
| A repo-qualified number (`<repo>#123`) | the named repo | fetch that PR in that repo |
| Full PR URL | parsed from the URL | use the URL's repo |
| File path | local repo | review that single file |
| Folder path | local repo | review every source file under it |
| Blank | local | review staged changes; if none staged, review unstaged |

**For a PR:** fetch the PR metadata (number, title, body, author, base/head refs, changed
files, labels) and the full diff via the host platform's PR CLI/API.

**For a file / folder:** glob the target path for the project's source extensions.

**For blank:** diff the staged changes (fall back to the working tree if nothing is staged).

Then classify the diff by which repo/role in `{{config.repos}}` it touches — **frontend**,
**backend**, or **both** (a single-repo project collapses to one). The classification and the
config gates drive which dimensions run in Phase 3 and which checks fire in Phase 4.

---

## Phase 2 — Load context

In parallel:

- The conventions docs for any repo the diff touches (root + any scoped subtree doc).
- The design canon — only if the diff touches frontend/UI files and the project has one.
- The plan the PR body references, if any.
- **The rubric at `{{config.review.rubricPath}}`** — the dimensions, severities, and finding
  template this review walks.
- **`_shared/verification-protocol.md`** (relative to the core root) — the shared reliability
  contract; its Verify phase and Deferred ledger run below.

Understand intent: for a PR read the title, body, and linked issue; for a file understand its
role; for staged changes, what is in flight.

---

## Phase 3 — Walk the rubric

Go dimension-by-dimension through `{{config.review.rubricPath}}` against the diff. For each,
emit findings in the rubric's finding template, tagged with a severity from the ladder. Honor
the gates:

- Skip a dimension whose surface the diff never touches (mark **N/A** — do not invent findings).
- The design-system dimension runs only when frontend/UI files changed.
- **Config-conditional dimensions** — run each only if config declares it, else record it N/A
  in the Deferred ledger (never a dangling check reference):
  - **Parity** runs only if `{{config.parity.enabled}}` is true (uses `{{config.parity.mirrors}}`).
  - **i18n** runs only if `{{config.i18n.locales}}` is non-empty (uses `{{config.i18n.paths}}`).
  - **Contract + backward-compat** runs only if `{{config.contract.enabled}}` is true AND
    `{{config.repos}}` has length > 1.
  - **Backend hard rules** run only when a backend repo changed AND
    `{{config.review.backendHardRules}}` is non-empty.

The dimensions, in order: Correctness · Dead/stale code · SOLID/clean-arch · Comment policy ·
No-workaround · Type safety · No stray debug logging · Design-system/AI-slop · Parity · i18n ·
Contract drift + backward-compat · Security · Backend hard rules.

Focus on changed code, not pre-existing issues — unless a pre-existing issue is Critical.

**Coverage contract (verification protocol §1):** the diff's changed files are the binding
inventory — rank them worst-first (highest-blast-radius / most-churned files and the
trust-boundary + contract surfaces before stable leaves) so the riskiest code is reviewed even
under pressure, and every changed file ends with a verdict or in the Deferred ledger. Nothing
changed is silently skipped.

Apply the rubric's **Signal gate**: post Critical/High and concretely-actionable Medium only —
drop Low/Info nits and style preferences (manufacturing nits to avoid approving is a defect).
The outcome is deterministic: **NEEDS WORK** iff any Critical/High finding survives, otherwise
**APPROVE**.

---

## Phase 4 — Run the gated dimension checks

The security, parity, i18n, and contract dimensions each benefit from a focused pass. Run them
as subagents when the host allows, gated by what the diff touches and by config. Respect
`{{config.execution.maxParallelSubagents}}` (default 3 concurrent). Pass each pass the list of
changed files. Fold every result back into the Phase 3 findings under the matching rubric
dimension.

**Await them synchronously — this is a blocking fan-out, not fire-and-forget.** Spawn the gated
subagents, then wait for every one to return *within this same turn* and fold its result in
before moving to Phase 5. Never end your turn with a subagent still running on the expectation
that a completion notification will wake you back up: a CI or headless wrapper runs a single
execution and delivers **no** background-completion wake-up, so yielding there strands the
review half-done and posts nothing. If for any reason you cannot await a subagent within the
turn, run that dimension's check **inline yourself** rather than deferring — the review is not
finished until every gated dimension has returned.

| Check | Gate (fire when…) | Folds into dimension |
|---|---|---|
| Parity | `{{config.parity.enabled}}` true **and** a file under a `{{config.parity.mirrors}}` root changed | Parity (#9) |
| i18n | `{{config.i18n.locales}}` non-empty **and** user-facing strings or a locale file under `{{config.i18n.paths}}` changed | i18n (#10) |
| Contract + backward-compat | `{{config.contract.enabled}}` true **and** `{{config.repos}}` length > 1 **and** a file under `{{config.contract.clientTypesGlob}}` / `{{config.contract.serverTypesGlob}}` (or the endpoint constants) changed | Contract drift (#11) |
| Security (backend) | a backend repo's code changed | Security (#12, API side) |

If a generic **security-reviewer** agent is registered, delegate the backend security pass to
it; it covers backend security while the rubric's frontend-security checks (XSS, auth-state
leakage) cover what that agent explicitly does not. For parity / i18n / contract, run the check
inline against `{{config.parity.mirrors}}` / `{{config.i18n.paths}}` /
`{{config.contract.*Glob}}` respectively.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run these dimension checks **serially in one
thread** — the checks are what matter, not the concurrency. A gate whose config is off is
simply not run and is recorded N/A in the Deferred ledger.

---

## Phase 5 — Backward-compat guard

Runs **only** when `{{config.contract.enabled}}` is true and `{{config.repos}}` has length > 1;
otherwise record it N/A in the Deferred ledger and skip. Answer one question: **does this diff
rename or remove a field that an already-shipped (lagging) client still sends or reads?** A
lagging client (e.g. one shipped through an app store that updates behind the server) runs a
frozen snapshot of the shared contract, so a server/shared rename is invisible to it — it keeps
the old name and silently breaks. This leans on the Phase-4 contract field comparison and adds
the direction + add/remove judgment, applying the policy in `{{config.contract.backwardCompat}}`.

1. From the diff, isolate hunks in the client-side schemas under
   `{{config.contract.clientTypesGlob}}` and the server-side DTOs under
   `{{config.contract.serverTypesGlob}}`.
2. A **removed line** declaring a field (removed with no matching add), OR a **renamed field**
   (one field removed + one added in the same shape, types compatible), is a candidate.
3. Classify each candidate and tag per rubric dimension 11:
   - Removed/renamed in a **response** shape → old readers get `undefined` →
     **`⚠️ breaks already-shipped clients` (Critical)**, unless already optional AND unused
     (cite the grep).
   - Removed/renamed in a **request** shape, or a field made **newly-required** → old senders
     are rejected by validation → **`⚠️ breaks already-shipped clients` (Critical)**.
   - **Added optional** field → forward-compatible → **Info**.
   - **Enum value removed** → old clients may still send it → flag.
4. In the fix, recommend the compatible alternative per `{{config.contract.backwardCompat}}`:
   keep-and-deprecate the old field, accept both names server-side for a release, or gate behind
   the min-version gate (`{{config.contract.backwardCompat.minVersionGate}}`). When old-client
   reach is uncertain, downgrade to **High** with a "verify old-client usage" note rather than
   over-claiming Critical.

Scope is **field add/remove/rename in the reviewed diff**. Semantic/behavioral breaks under an
unchanged field name are caught by Correctness (#1) and the human reviewer — do not over-claim
completeness here.

---

## Phase 6 — Verify findings (adversarial)

Run `_shared/verification-protocol.md` before validating — every finding that will decide the
outcome has to survive a challenge first.

1. **Adversarial pass (§2).** For every **Critical / High** finding (including any
   `⚠️ breaks already-shipped clients`), spawn an independent skeptic whose only job is to
   *refute* it — read the cited `file:line` in full diff context and argue it is a false positive
   (the path is unreachable, the value already validated, the field actually still present or
   optional-and-unused with the grep to prove it, a duplicate, the severity inflated). Default to
   refuted when uncertain. Drop or downgrade anything the skeptic disproves — a false Critical
   that blocks a clean PR is as costly as a missed one. The survivors decide the recommendation.
   Respect `{{config.execution.maxParallelSubagents}}`; **sequential fallback** — when
   `{{config.execution.hasNamedAgentRegistry}}` is false or `maxParallelSubagents` ≤ 1, run the
   skeptic passes serially in the main thread.
2. **Cross-model second opinion (§2, Critical survivors — interactive only).** Runs only when
   `{{config.secondOpinion.enabled}}` is true. For each **Critical** finding that survives step 1
   (including any breaks-already-shipped-clients finding), fire the **`second-opinion`** skill so a
   *different* model (`{{config.secondOpinion.model}}`, run through the local `opencode` CLI)
   independently judges it — pipe the finding dossier (title · severity · `repo/path:line` · the
   claimed defect · the cited code hunk) to the second-opinion helper and apply the JSON verdict:
   - **AGREE** → cross-model corroborated; keep the severity, note the confirmation.
   - **DISAGREE** → tag the finding **`CONTESTED`** and record the other model's `reasoning` beside
     the primary review's; surface **both** verdicts in the report. It stays Critical — the
     disagreement is the human's to resolve. **Never** let it force a merge or silently drop the
     finding (the skeptic in step 1 already owns the drop decision).
   - **UNSURE** → note it; the finding stands as step 1 left it.
   - **UNAVAILABLE** (opencode absent — **always the case in CI**, or capped / offline / the model
     unfunded) → skip the second opinion, leave the finding unchanged, and state it in one line.
     Never read "couldn't ask" as agreement. This graceful-degradation path keeps a CI review (no
     opencode) byte-for-byte identical to one run without the second opinion.
   Scope to **Critical only** (not High) — cross-model time/cost is reserved for the findings that
   actually block. CONTESTED never changes the deterministic recommendation: a surviving Critical
   still means NEEDS WORK. When `{{config.secondOpinion.enabled}}` is false, skip this step entirely.
3. **Completeness pass (§3).** One pass only — a diff is its own boundary, so no loop: ask *"what
   changed file or hunk did I not give a verdict, what dimension did I mark N/A without checking
   its surface?"* and close the gap before reporting.
4. **Deferred ledger (§4).** Every dimension marked N/A (including config-off dimensions —
   parity / i18n / contract / backend-hard-rules) and every changed file not verdicted goes into
   the report's **Deferred** line with a one-line reason — so "clean" never hides "not looked at."

---

## Phase 7 — Validate

Run the affected-repo checks by delegating to the `validate` skill (it runs the `testCmd` /
`lintCmd` / `typeCheckCmd` / `buildCmd` from `{{config.repos}}`, auto-detecting frontend /
backend / both) rather than hardcoding a second copy of the command set — one source of truth
for how the project validates. Skip the repo the diff never touched. Record each result as PASS
/ FAIL with the error summary for the report's validation table. For a file/folder scope with no
working-tree changes, validation is N/A.

---

## Phase 8 — Report

Write the report; post it to the PR when the scope is a PR.

**Output path**: `{{config.paths.reportsDir}}/{scope-name}-review.md` (create the dir if absent).

```markdown
# Code Review: {SCOPE}

**Scope**: {PR #N in repo / file / folder / staged}
**Recommendation**: APPROVE / NEEDS WORK

## Summary

{2-3 sentences: what was reviewed and the overall assessment.}

## Findings

### Critical
{findings in the rubric template, or "None" — ⚠️ breaks-already-shipped-clients findings sort here first.
A finding a cross-model second opinion disputed carries a **`CONTESTED`** tag with both verdicts
inline — e.g. "primary: Critical · second-opinion: DISAGREE — {its reasoning}" — so the human sees
the disagreement. It stays Critical; the tag never downgrades it.}

### High
{… or "None"}

### Medium
{… or "None"}

### Low / Info
{… or "None"}

## Dimension checks

| Check | Verdict |
|---|---|
| Parity | PAIRED / PARTIAL / MISSING / N/A |
| i18n | IN SYNC / DRIFT / N/A |
| Contract | MATCH / DRIFT / N/A |
| Security (backend) | PASS / FAIL / N/A |

## Validation

| Check | Result |
|---|---|
| Lint | PASS / FAIL / N/A |
| Type check | PASS / FAIL / N/A |
| Tests | PASS / FAIL / N/A |
| Build | PASS / FAIL / N/A |

## Deferred — N/A dimensions & files not verdicted

{Per verification protocol §4: each dimension marked N/A (config-off parity / i18n / contract /
backend-hard-rules, or a surface the diff never touched) and any changed file not given a
verdict — one line each. "Nothing deferred" if every dimension and file got a verdict.}

## What's good

{positive observations}

## Recommendation

{what needs to happen next}
```

### Post to the host platform (PR scope only)

The review is **decisive** — it ends as APPROVE or REQUEST_CHANGES, never a bare comment. Map
the deterministic recommendation (NEEDS WORK iff any Critical/High finding) to the platform's
approve / request-changes verb, attaching the report as the review body. Add inline comments for
Critical/High findings tied to a specific line via the platform's review-comment API.

**Caller context decides who posts:**

- **CI wrapper** invokes this skill: it owns the single decisive post — produce the report +
  recommendation and let it submit (skip this posting step). In CI also skip Phase 7 (Validate),
  and mark any dimension that needs an un-checked-out sibling repo as "not verifiable in CI".
- **Local, a PR you do NOT own**: post the decisive review yourself per the recommendation.
- **Local, your OWN PR** (platforms block self-approval): write the report and post it as a plain
  comment instead — do not fail trying to approve.
- **Local file / folder / staged** scope: only write the report file, never post.

---

## Output

```markdown
## Review Complete

**Scope**: {what was reviewed}
**Recommendation**: APPROVE / NEEDS WORK

| Severity | Count |
|---|---|
| Critical (incl. ⚠️ already-shipped-client breaks) | {N} |
| High | {N} |
| Medium | {N} |
| Low / Info | {N} |

**Report**: `{{config.paths.reportsDir}}/{scope-name}-review.md`
{Posted to PR #N — only if scope was a PR}
```
