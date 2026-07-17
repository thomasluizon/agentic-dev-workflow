# Commit Sweep: cross-commit, cross-repo regression sweep

> **Config inputs:** `config.repos`, `config.pr.baseBranch`, `config.paths.reportsDir`, `config.parity.enabled`, `config.contract.enabled`

**Input**: `<N=10 | --since <when>>` and an optional repo scope (blank = every repo in `{{config.repos}}`).

Read a window of recent `{{config.pr.baseBranch}}` commits across every repo in `{{config.repos}}`
and diff-review them **together**, hunting the cross-commit and cross-repo regressions a per-diff
review structurally never sees. Each change merges in isolation, so a migration that duplicates an
object an earlier migration already created, or an API-side rename whose paired consumer change
never landed, only becomes visible when the whole window is read in one reasoning context. This is
the cross-session backstop for the gotchas the per-edit gates and the per-diff review structurally
miss.

**Golden rule**: no vibes. Every finding names the `file:line`, the commit sha, and the exact prior
evidence — the earlier migration that already made the object, the removed pin's hunk, the missing
mirror path. An unproven claim is dropped. This is a single pass with no adversarial skeptic, so the
evidence bar is the discipline that keeps it honest.

---

## Phase 0 — Report-only & self-containment

**Report-only.** This skill reads local history on each checkout and writes one report. It NEVER
remediates, refactors, edits code, or posts to the tracker — the surfacing step (a human, or an
automation twin) acts on the report, mirroring the audit convention.

**Self-contained.** It uses only local history reads and file reads on each repo's own checkout. No
network, no suite run, no build. It runs identically on a developer's machine and on a CI runner.

**The rubric is a calibrated seed, not a ceiling.** The six checks below are the regression classes
that survive isolation-merge — each is a shape a per-diff review cannot see. Surface any cross-commit
regression outside the six named classes too; the six are the calibration, never an allow-list that
blinds the sweep to a novel gotcha.

---

## Phase 1 — Resolve repos + parse args

Resolve each repo root from `{{config.repos}}`. Parse the argument into a window mode and a scope:

- **Count mode (default, manual).** A numeric first token is the commit count `N` (default `10`):
  `git -C "<repo root>" log -n <N> {{config.pr.baseBranch}} --format='%h %ad %s' --date=short`.
- **Time mode (scheduled).** `--since <when>` (any git approxidate, e.g. `--since "24 hours ago"`):
  `git -C "<repo root>" log --since=<when> {{config.pr.baseBranch}} --format='%h %ad %s' --date=short`.
  Time mode can yield an EMPTY window (no commits) — a first-class outcome, not an error.
- **Scope** (optional trailing token): blank → every repo in `{{config.repos}}`; otherwise a repo
  name or role from `{{config.repos}}` narrows the sweep to that repo. A non-numeric, non-`--since`
  first token is treated as the scope with `N` defaulting to `10`.

Print the resolved `{mode, N-or-since, scope, repos}` before gathering.

---

## Phase 2 — Gather the window (both modes)

For each in-scope repo, list the window (the count- or time-mode `log` above), then read each
commit:

```bash
git -C "<repo root>" show <sha> --stat   # the touched paths
git -C "<repo root>" show <sha>          # the full patch
```

Plus the aggregate diff over the window, restricted to the paths the rubric cares about (schema
migrations, lockfiles/pins, shared contract types, endpoint declarations, translation tables, the
parallel surface trees):

```bash
git -C "<repo root>" diff <oldest-sha>^..<newest-sha> -- <rubric paths>
```

Record each repo's window span (first date .. last date) so Phase 4 can flag time-skew between
repos. **If every in-scope window is empty** (time mode, no commits), skip to Phase 4 with the
`empty` outcome.

---

## Phase 3 — Apply the six-check rubric holistically

Read the combined window as ONE context and apply every check below. Each real issue becomes a
finding in this template, ranked most-severe first via a Critical / High / Medium / Low ladder:

> `severity · title · category (the rubric check it maps to) · location (repo-relative path:line +
> commit sha) · evidence (the exact diff hunk / prior-migration line) · rationale (the regression
> class) · fix (concrete) · reference (the documented rule it traces to)`

### 1. Schema-migration object duplication → deploy-time failure on redeploy (Critical)

- **Where**: commits touching any schema-migration path.
- **Pattern**: a windowed migration creates an index / constraint / column — via a structured
  builder call OR raw DDL — whose object name **already exists** in ANY prior migration in the full
  history, and the new DDL is bare (not guarded by an `IF NOT EXISTS`-style check). Scan every DDL
  form the migration tool emits; a grep that only matches the structured builder misses a raw-SQL
  duplicate.
- **Evidence**: the windowed migration `file:line` + the prior migration `file:line` that already
  created the object.
- **Rationale**: migrations apply at deploy/startup; a duplicate-object DDL throws and the deploy
  fails, leaving production STALE. A unit suite with no real database never catches it. Highest
  severity — it breaks the deploy silently past CI.

### 2. Dropped dependency pin / lockfile reconcile → broken release build (Critical/High)

- **Where**: commits touching manifests, lockfiles, install-override / hoisting config, or a
  pinned-toolchain file.
- **Pattern**: removal of a load-bearing explicit pin or override; a lockfile reconcile that drops
  a required install node; removal of a build-time linking/junction workaround; or a generic bump of
  a package pinned by an external toolchain that owns its own version policy.
- **Evidence**: the diff hunk removing the pin/override or bumping the pinned package.
- **Rationale**: the package manager can silently drop a transitive dependency once an override or
  pin is gone; the release build then dies at bundle/compile time. It "works" until a fresh install
  prunes a stale dependency tree — invisible to a per-diff review of the removing change.

### 3. Locally-silent, CI-only gate violation (High)

- **Where**: any repo whose ruleset has a gate that is silent in a local build/run but fails in CI
  (an analyzer newer than the in-box compiler, a lint rule only wired into the CI job, a format
  check).
- **Pattern**: a change that violates such a gate — the exact class that lands clean locally and
  blows up a later CI run.
- **Evidence**: the offending `file:line` + commit sha, and the gate it trips.
- **Rationale**: the author saw green locally, so the break surfaces on an unrelated later run —
  precisely a cross-commit trap a single-diff local review cannot reproduce.

### 4. Cross-repo contract drift + append-only violation across the window (High)

*(Skip when `{{config.contract.enabled}}` is false — a single-repo project has no contract to drift.)*

- **Where**: paired commits across the repos in `{{config.repos}}` within the window.
- **Pattern**: a producer-side commit renames / removes / retypes a shared field or changes an
  endpoint, but **no paired consumer commit** updates the shared contract types, the endpoint
  constants, or the callsites (or vice versa); OR a shared-contract change that is NOT append-only
  (renames / removes / retypes a field an older deployed client still reads) without the documented
  expand-contract version gate.
- **Evidence**: the producer-side change `file:line` + sha and the ABSENCE of the mirror change in
  the sibling window.
- **Rationale**: the two changes merge separately, so a single-diff review on either never sees the
  mismatch. A lagging client (mobile via the store, a cached SPA) makes a non-append-only change
  break live users.

### 5. Cross-surface parity + translation-key asymmetry across the window (Medium/High)

*(Skip when `{{config.parity.enabled}}` is false — there is no parallel surface to mirror against.)*

- **Where**: commits touching one of two parallel surfaces (e.g. two client platforms) or the
  translation tables.
- **Pattern**: a change to one surface whose mirror on the parallel surface **never landed anywhere
  in the window** — logic / feature / behavior / error-handling drift beyond the allowed
  platform-adapter differences; OR a translation key added to one locale table without the other.
- **Evidence**: the changed `file:line` + sha and the missing mirror path.
- **Rationale**: a per-edit parity nudge catches this inside one session, but two separately-merged
  changes (one surface now, its mirror "later") slip past it — the sweep is the cross-session
  backstop.

### 6. Stale-artifact / regenerate-required QA hazard (Low / Info — verification caveat)

- **Where**: any commit whose change is only correct after a rebuild/regenerate a later human QA
  might skip.
- **Pattern**: a change validated only against a fresh build (a cleared cache + hard refresh, a
  fresh native build, a regenerated derived artifact), or any committed derived artifact that
  drifted from its source.
- **Evidence**: the commit + the artifact/source that must be regenerated.
- **Rationale**: stale caches and long-lived sessions make a human QA test a pre-fix bundle and
  mis-report a fixed bug as broken. This is a "verify against a fresh build" caveat, not a code
  defect — surfaced so the reviewer does not QA stale output.

---

## Phase 4 — Synthesize the ranked report + status sidecar

Write **`{{config.paths.reportsDir}}/commit-sweep.md`** (create the dir if absent) with this
structure, findings ranked most-severe first:

```markdown
# Commit Sweep — {count-mode: last N commits | time-mode: commits since {when}}

**Window**: {per repo — repo {sha..sha} ({N} commits, {date}..{date})}
**Verdict**: {1 line — e.g. "Clean", "No new commits in window" (empty), or "1 Critical: migration dup will fail the next deploy"}

## Findings
### Critical
{template findings, or "None"}
### High
{… or "None"}
### Medium
{… or "None"}
### Low / Info (verification caveats)
{… or "None"}

## Cross-repo pairing
{Which windowed changes needed a sibling-repo change and whether it landed — the check-4/5 ledger. Note where a sibling change may predate or postdate this window.}

## Coverage
| Repo | Commits reviewed | Window span |
|---|---|---|
{one row per in-scope repo}
{Flag here if two repos' windows are badly time-skewed — a pairing check may span the boundary.}

## What's clean
{Genuinely-safe classes in this window — not filler.}
```

Then write the machine-readable sidecar **`{{config.paths.reportsDir}}/commit-sweep.status`** =
exactly one word (a surfacing step branches on this token, never on grepping the markdown):

- `empty`    — time mode, no commits in the window
- `clean`    — commits reviewed, no findings
- `findings` — at least one finding

---

## Guardrails — do NOT

- **Remediate.** Do not edit, refactor, or fix anything. This skill reports; the human (or a later
  task) fixes. This is the hard report-only line the audits also hold.
- **Post to the tracker.** The surfacing step owns any label / issue upsert. The skill writes only
  the report + `.status`, keeping its tool surface minimal and its logic portable.
- **Re-run the single-diff review.** This is the cross-commit sweep, a different lens.
- **Pad a clean window with invented Low nits.** A clean window is a `clean` status and a short
  "What's clean" note, not manufactured findings.
- **Claim a finding without its evidence.** No dup-migration finding without the prior migration's
  `file:line`; no dropped-pin finding without the removal hunk; no parity finding without the missing
  mirror path. Unproven → dropped.

---

## Output

```markdown
## Sweep Complete

**Window**: {count: last N commits | time: since {when}} · scope {all repos | <repo>}
**Status**: {empty | clean | findings}
**Verdict**: {1 line}

| Severity | Count |
|---|---|
| Critical | {N} |
| High | {N} |
| Medium | {N} |
| Low / Info | {N} |

**Report**: `{{config.paths.reportsDir}}/commit-sweep.md`
**Top finding**: {the single most severe finding, or "none — window clean"}
```
