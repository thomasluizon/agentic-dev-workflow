# Prod-Readiness

> **Config inputs:** `config.repos`, `config.review.correctnessScanners`, `config.auditAnchors.scale`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: blank (all repos in `{{config.repos}}`) or a repo/path narrowing it.

Run a pre-launch readiness sweep across the repos in `{{config.repos}}` and return ONE
consolidated, tier-tagged report with an honest launch verdict. This skill is an
**orchestrator**: it fans out the four already-built repo-wide audits, adds the ops-layer audit
none of them cover, then merges every result into a single decision-ready document.

**Golden rule — orchestrate, don't re-derive.** Each child audit owns its own analysis, its own
adversarial Verify, and its own loop; this skill **invokes** them, **reads** their reports, and
**inherits** their verification — it never re-runs their finding logic. Its own analysis is the ops
layer alone. Three things are non-negotiable: no audit is silently skipped (every one runs-and-
reports or lands in the Deferred ledger with a reason), no ops finding ships without surviving a
challenge, and the report states what it did **not** do.

---

## Phase 0 — Provenance + binding coverage contract

The ops-layer checklist and this orchestration shape were adapted at authoring time from the
"scaling-past-vibe" production-readiness workflow pattern
(https://github.com/anthropics/skills). That URL is the single WHY-with-URL the comment policy
allows.

**Self-contained / CI-safe**: no network call, no live scanner, no marketplace dependency at run
time. It invokes the four sibling audit skills (themselves self-contained) and **reads** their
report files plus repo config; it runs `git` / `rg` against the project's own checkout. Works
unchanged in CI.

Read **`_shared/verification-protocol.md`** — the shared reliability contract. Its coverage
contract (§1), adversarial verify (§2), Deferred ledger (§4), and honesty clause (§5) govern this
run; the calibration table is this skill's authority for what it **runs** versus **inherits** (it
runs its own coverage contract over the inventory + the §2 challenge over its own ops findings; it
inherits each child audit's verify and each child's loop; it merges every child ledger).

**Build the binding inventory (§1)** — up to **ten items** (item 10 is present only when
`{{config.review.correctnessScanners}}` is non-empty):

| # | Inventory item | Kind | Owner of the analysis |
|---|---|---|---|
| 1 | `audit-security` | child audit | the child (inherited verify) |
| 2 | `audit-tests` | child audit | the child (inherited verify) |
| 3 | `audit-performance` | child audit | the child (inherited verify) |
| 4 | `audit-code-quality` | child audit | the child (inherited verify) |
| 5 | Observability | ops check | this orchestrator (own §2 challenge) |
| 6 | Multi-instance readiness | ops check | this orchestrator (own §2 challenge) |
| 7 | Background durability | ops check | this orchestrator (own §2 challenge) |
| 8 | Backups | ops check | this orchestrator (own §2 challenge) |
| 9 | Staging | ops check | this orchestrator (own §2 challenge) |
| 10 | Configured correctness scanners | scanner | this orchestrator (runs each in-scope scanner from `{{config.review.correctnessScanners}}`) |

**Item 10** is **conditional on config**: when `{{config.review.correctnessScanners}}` is empty it
is **N/A** and drops out of the inventory (do not list it, do not let it block); when non-empty it
covers every configured scanner whose `scope` intersects the repos in play. A configured scanner
whose scope does **not** match the resolved scope is a **legitimate skip** (like React-only tooling
under a backend-only scope), not a coverage gap.

This list is **binding**: by the end every item is either **(a) covered with a verdict** (in the
tier-tagged findings + the coverage table) or **(b) in the Deferred ledger with a one-line
reason**. There is no third "silently skipped" bucket — for a launch verdict it is the most
dangerous one.

---

## Phase 1 — Resolve scope & load context

Parse the input exactly as the child audits do, so one resolved scope flows to all of them: blank →
**all repos in `{{config.repos}}`**; a repo/role name → that repo; a path → just that file or
folder.

Compute **one** `{scope}` token and forward the **same** scope argument to every child so all five
report files share one suffix (`security-{scope}.md`, `tests-{scope}.md`, …). The authoritative path
for each child report is the one the child names in its returned **Output** block — read that,
don't guess at the token derivation. The children load their own context (rubric, conventions docs,
the protocol); the orchestrator only loads the protocol itself.

---

## Phase 2 — Fan out the four audits

Spawn **one subagent per child audit**, plus the ops-check subagent from Phase 3 — **five in one
wave**, capped at `{{config.execution.maxParallelSubagents}}` (default 3 concurrent); queue the rest
behind the first three. Each audit subagent:

- Invokes its canonical audit skill — `audit-security`, `audit-tests`, `audit-performance`,
  `audit-code-quality` — with the resolved `{scope}`.
- Lets the child run its **full** pipeline, including the child's own §2 adversarial pass and §3
  loop-until-dry. The orchestrator does **not** re-run that analysis.
- Returns the child's final **Output** summary block verbatim (per-severity counts + the report
  path + the top item).

> **Objective** (embedded in each audit subagent's prompt): run `audit-<kind>` against scope
> `{scope}`, let it complete its own Verify and loop, and return its Output block unmodified —
> including the `{{config.paths.auditsDir}}/<kind>-{scope}.md` path. Do not re-analyze or re-format its findings.

**Nesting is expected.** Each child internally fans out its own scouts + skeptics. The orchestrator
caps **its own** wave; the children self-cap internally.

**Coverage-contract handling (§1).** An audit that completes → its report path + Output summary feed
Phase 5. An audit that **errors or cannot run** (e.g. the sibling repo is not checked out in this CI
job, or the skill call is unavailable) → a **Deferred-ledger entry** naming the audit and the reason
**and** a verdict downgrade in Phase 5 (a surfaced blocker, never a silent pass — §5).

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the five audits/ops-check **one at a time in
the main thread**, each writing its `{{config.paths.auditsDir}}/<kind>-{scope}.md` report inline, then continue.
If the host cannot invoke a child skill as a subagent at all, run that audit's own phases inline
against the same `{scope}` and write the same report path — the report still exists, the contract
still holds.

---

## Phase 3 — Ops-layer audit (the part no child covers)

The four child audits cover code, tests, security, and performance; **none** covers whether the
running system survives production. This is the orchestrator's own analysis. Launch the ops-check as
a subagent in the Phase-2 wave (or inline, per the fallback). Run **five concrete checks**,
discovering each anchor at runtime (the pointers below are where to look, **not** hardcoded
verdicts), and emit each gap as a finding in the shared finding template tagged on the consolidated
tier spine.

| # | Ops check | Where to look (discover at runtime) | "Ready" looks like | Gap = finding (tier) |
|---|---|---|---|---|
| 5 | **Observability** | Error-monitoring init/config across every runtime; the health-check endpoint + its registration; alert routing to a sink someone watches | Error capture initialized + DSN wired on all surfaces; an unhandled-exception handler; a health endpoint; alerts routed to a watched sink | A surface with no error capture, no health endpoint, or no alert sink (**Blocker** if a whole runtime is dark; **High** for a single gap) |
| 6 | **Multi-instance readiness** | In-process schedulers vs a durable job store; any in-memory cache / rate-limit / counter assumed authoritative; session-affinity assumptions | Recurring work coordinated through a durable store (one run cluster-wide); no single-instance in-memory authority | A scheduler that double-fires on every replica; an in-memory rate-limit/cache that breaks when a second instance starts (**High**; **Blocker** if it corrupts user data on scale-out) |
| 7 | **Background durability** | Background-job store config; fire-and-forget paths (post-response work, push/email dispatch) | Jobs persisted to a durable store, survive a restart, are idempotent / retried | In-process fire-and-forget work lost on restart or crash; a non-idempotent recurring job that double-applies on retry (**High**) |
| 8 | **Backups** | DB provider config; any documented restore path in the repo | Automated backups / PITR enabled **and** a tested restore path | **Usually un-verifiable from a repo read in CI** → a **Deferred** entry ("verify in the DB console — backups + restore"), never asserted clean (§5) |
| 9 | **Staging** | Deploy/CI workflows in **every** repo; any out-of-CI deploy config | A pre-prod gate (smoke + promote) sits between merge and prod | No staging env or no pre-prod gate. **Discover the real state per repo** — report what exists, never hardcode a snapshot (**Medium**, calibrated) |

**Scale calibration.** Right-size to `{{config.auditAnchors.scale}}` (mirror the audits'
enterprise exclusions): do **not** itemize SOC2, SIEM, multi-region failover, DR-region drills, or a
99.99% SLO. Acknowledge enterprise-only ops in **one** Deferred line, not a finding each.

### Ops finding template (shared shape)

The same shape the children emit, with an ops `check` category in place of a threat:

```
[TIER] <one-line ops gap>
· check: <observability | multi-instance | background durability | backups | staging>
· location: <repo>/<path>:<line>   (or "config/console — not in repo" for backups)
· risk: <what breaks in production and when — e.g. "scheduler double-fires on every replica">
· evidence: <the line/config that proves it, or "not found at runtime">
· fix: <the concrete change — distributed lock, durable queue, enable PITR, add a promote gate>
```

---

## Phase 3.5 — Configured correctness scanners (inventory item 10)

**Skip this phase entirely when `{{config.review.correctnessScanners}}` is empty** — item 10 is
N/A and never blocks. Otherwise, this is the orchestrator's own deterministic layer: for **each**
scanner in `{{config.review.correctnessScanners}}` whose `scope` intersects the repos in play, run
its `command` at full launch scope, apply its `excludeGlobs`, and collect its diagnostics. This is
a launch gate distinct from the same scanner surfaced inside `audit-code-quality` — here a scanner
**error** is treated as a real production-correctness bug and elevated onto the verdict.

Normalize each scanner diagnostic onto the consolidated spine, tagged `[{scanner.name} · {rule}]`
with its `location` and `fix`:

- a scanner **error → its `errorSeverity`** (default `High`; a scanner may configure `Blocker`),
- a scanner **warning → its `warningSeverity`** (default `Low`/`Info`).

Group the (typically many) warnings by rule with a count rather than listing each. A scanner whose
`scope` does not match the resolved scope returns "did not run — out of scope" (a legitimate skip);
a scanner that was configured for an in-scope role but **failed to run** is a **Deferred coverage
gap** (→ CONDITIONAL in Phase 5), never silently treated as clean.

> *Example (illustrative only, never required):* a React-correctness scanner configured for
> `scope: [web, mobile]` runs its full-repo scan under a `ui`/all-repos scope, maps its real-bug
> errors to High and its perf/a11y nits to Low/Info, and is a legitimate skip under a backend-only
> scope.

---

## Phase 4 — Verify (adversarial + consolidation)

This orchestrator **runs** §2 over its own ops findings and **inherits** each child's verify and
loop.

1. **§2 adversarial — the orchestrator's OWN ops findings only.** For each **Blocker / High** ops
   finding, spawn an independent **skeptic subagent** (respecting
   `{{config.execution.maxParallelSubagents}}`) whose only job is to *refute* it: read the cited
   `file:line` in full context and argue it is a false positive — the durable store already
   coordinates that job, the unhandled-exception handler does exist, the env really has a promote
   gate, the cache is per-request not process-global. The skeptic **defaults to refuted when
   uncertain**; the burden is on the finding. Drop or downgrade anything refuted, attaching the
   skeptic's note.
2. **Inherit, don't re-run, the children's verify.** Each child already ran its §2 adversarial pass
   and §3 loop internally. The orchestrator does **not** re-skeptic child findings and does **not**
   re-loop their scope — it presents them as already-verified.
3. **No orchestrator-level loop.** The ops checklist is **bounded** (the five items), so run **one
   completeness pass** over the five checks (did each resolve to a verdict or a Deferred entry?) and
   stop. The unbounded loop-until-dry belongs to the children; it is inherited, not re-run.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the ops skeptic passes **serially in the main
thread** — the challenge is what matters, not the concurrency.

---

## Phase 5 — Consolidate & report (ONE tier-tagged report)

**Output path**: `{{config.paths.auditsDir}}/prod-readiness-{scope}.md` (create the dir if absent).

### Unified ladder (normalization)

The four children do **not** share one severity enum — normalize them onto one spine and tag each
finding with its **source audit + native label** (so nothing is silently relabeled). The protocol's
cross-skill spine is "Critical / High ≡ Tier 1 / Tier 2 for security":

| Consolidated tier | Maps from |
|---|---|
| **Blocker** | security Tier 1 · tests Critical · performance High/Critical · code-quality Critical · ops Blocker · a **correctness-scanner error whose `errorSeverity` is Blocker** |
| **High** | security Tier 2 · tests High · performance Medium · code-quality High · ops High · a **correctness-scanner error** (default `errorSeverity`) |
| **Medium** | tests Medium · performance Medium · code-quality Medium · ops Medium |
| **Low / Info** | performance Low/Info · code-quality Low/Info · **correctness-scanner warnings** (perf/a11y/maintainability nits) |
| **Out-of-scope / acknowledged** | security Tier 3 · enterprise-only ops |

Tag each correctness-scanner finding `[{scanner.name} · {rule}]` and map it by the scanner's own
configured `errorSeverity` / `warningSeverity` (defaults `High` / `Low`).

### Report skeleton

```markdown
# Prod-Readiness: {SCOPE}

**Scope**: {all repos / repo / path}
**Calibration**: launch-blocking risk for a {{config.auditAnchors.scale}} app; enterprise controls acknowledged, not itemized.
**Verdict**: {GO | CONDITIONAL | NO-GO} — {one calibrated line: why, and the single thing standing in the way}

## Findings (consolidated, tier-tagged)

### Blocker
{each finding with [source audit · native label] prefix, in its own template, or "None"}

### High
{… or "None"}

### Medium
{… or "None"}

### Low / Info
{… or "None"}

## Out of scope (acknowledged)
{one line each: security Tier 3 + enterprise-only ops — deliberately deferred}

## Coverage (the binding inventory)

| # | Inventory item | Ran? | Result |
|---|---|---|---|
| 1 | audit-security | yes/no/deferred | {tier counts / "did not run — blocker"} |
| 2 | audit-tests | … | … |
| 3 | audit-performance | … | … |
| 4 | audit-code-quality | … | … |
| 5 | Observability | … | … |
| 6 | Multi-instance readiness | … | … |
| 7 | Background durability | … | … |
| 8 | Backups | … | … |
| 9 | Staging | … | … |
| 10 | Configured correctness scanners | yes/skipped(scope)/deferred/N-A | {per scanner: error+warning counts, or "skipped — out of scope" / "did not run — deferred" / "N/A — none configured"} |

## Deferred ledger (verification-protocol §4)

{The merged ledger: every child report's own "Deferred" section, carried in verbatim and attributed
(e.g. "from security: Tier-3 WAF/SIEM"), PLUS the orchestrator's ops Deferred — backups ("verify in
the DB console"), any audit that failed to run (named as a blocker), enterprise-only ops, plus any
configured correctness scanner that was in-scope but failed to run. Every inventory item — including
item 10 when `{{config.review.correctnessScanners}}` is non-empty — appears here or in the
findings/coverage above. Nothing absent.}

## What's solid

{Genuine production strengths across the children + ops — controls done right. Not filler.}
```

### Launch verdict (§5 honesty)

One calibrated line, computed — never hardcoded:

- **GO** only if **zero Blockers** **AND** every inventory item produced a verdict (every audit ran,
  every ops check resolved or is a legitimately Deferred un-verifiable like backups). **When
  `{{config.review.correctnessScanners}}` is non-empty and a scanner is in-scope, GO additionally
  requires zero scanner errors** — an unresolved scanner error is a real correctness bug. When the
  list is empty, item 10 is N/A and never gates.
- **CONDITIONAL** if no Blockers but some items are Deferred in a way that gates launch (e.g. backups
  unverified, staging gate absent, **outstanding correctness-scanner errors, or a configured scanner
  that did not run for its in-scope role**) — name the conditions.
- **NO-GO** if any Blocker stands.
- **A child audit that failed to run forces at most CONDITIONAL and names itself as the blocker** — a
  partial sweep can never read green. The coverage table makes any non-running audit visible.

Merge the child reports by **reading their files** at the paths their Output blocks name (Phase 2),
not by re-deriving their findings.

---

## Phase 6 — Output

```markdown
## Prod-Readiness Complete

**Scope**: {what was swept}
**Verdict**: {GO | CONDITIONAL | NO-GO} — {the single top blocker, or "clean — all 9 verdicted, zero blockers"}

| Consolidated tier | Count |
|---|---|
| Blocker | {N} |
| High | {N} |
| Medium | {N} |
| Low / Info | {N} |

**Inventory**: security {ran/deferred} · tests {…} · performance {…} · code-quality {…} · observability {…} · multi-instance {…} · background durability {…} · backups {…} · staging {…} · correctness-scanners {per-scanner error/warning counts, or "N/A — none configured"}
**Report**: `{{config.paths.auditsDir}}/prod-readiness-{scope}.md`
**Top blocker**: {the single highest-priority thing standing between here and launch, or "none"}
```

---

## Guardrails — do NOT

- **Re-derive child findings.** Invoke the audit, read its report, inherit its verify (§2/§3) and its
  ledger. Re-running a child's analysis doubles cost and risks a divergent verdict.
- **Silently drop an audit that failed to run.** A missing audit is a Deferred-ledger entry **and** a
  verdict downgrade (≤ CONDITIONAL), named as a blocker — never an unstated gap.
- **Invent ops findings to look thorough.** A clean ops check earns a plain "ready," not a
  manufactured nit (§5). An ops finding with no concrete anchor + risk is not a finding.
- **Hardcode a verdict, the staging state, or the backup state.** Discover staging and background
  topology at runtime per repo; the workflow set and env drift.
- **Assert backups or staging you cannot verify from a repo read in CI.** Those default to the
  Deferred ledger with a "verify in console / discover the real env" reason, never "clean."
- **Paste enterprise checklists.** SOC2 / SIEM / multi-region / DR drills get one acknowledging
  Deferred line, not a finding each — right-size to `{{config.auditAnchors.scale}}`.
- **Fork a child's tier ladder or finding template.** Point at the children's files; the only new
  vocabulary here is the unified-ladder *mapping*.
- **Emit a report without an explicit Verify pass + a Deferred ledger.** Per the protocol's
  self-application clause, a skill that names the protocol must actually emit both.
```
