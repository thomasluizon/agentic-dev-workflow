# Audit Performance

> **Config inputs:** `config.repos`, `config.auditAnchors.scale`, `config.auditAnchors.performanceHotZones`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: a path, a repo name, or blank (all repos in `{{config.repos}}`).

Find the performance risks that bite at scale — before they do — across the repos in
`{{config.repos}}`. The backend side is usually where the real risk lives (database round-trips
per request); the frontend side is render and cache hygiene. Output: one report, each finding
pinned to a `file:line` with the fix.

**Golden rule**: every finding is a concrete, located risk with a remediation, **sized to the
project's actual scale** (`{{config.auditAnchors.scale}}`). Flag the patterns that get
*quadratically* worse with data (N+1, unindexed scans, render loops) — not micro-optimizations
that don't move the needle. No premature tuning.

---

## Phase 0 — Scale & self-containment

**Self-contained**: no network call, no profiler, no marketplace dependency at run time. It
**reads** code and runs `git` / `rg`; it does not execute a benchmark or a load test. Works
unchanged in CI.

**Scale calibration**: rank by **how badly a pattern degrades as data or traffic grows**, and
explicitly *skip* tuning that only matters at enterprise volume when
`{{config.auditAnchors.scale}}` is smaller — say so rather than listing it.

---

## Phase 1 — Resolve scope & load context

Parse the input: blank → **all repos in `{{config.repos}}`**; a repo name / role → that repo; a
path → just that path. Weight the audit toward the zones in
`{{config.auditAnchors.performanceHotZones}}` — the query handlers, list-rendering surfaces, and
bundle entry points the project has flagged as hot.

Load the conventions docs and **`_shared/verification-protocol.md`** (the shared reliability
contract — its Verify phase and Deferred ledger run below). Exclude generated / vendored dirs —
but **do read** generated DB migrations to confirm which **indexes exist**, since that is
load-bearing for the index checks.

---

## Phase 2 — Fan out by side

Delegate to subagents, respecting `{{config.execution.maxParallelSubagents}}` (default 3
concurrent) — backend slices + frontend slices, non-overlapping. Each subagent prompt embeds:

> **Objective**: audit `<slice>` for the performance patterns in this skill's Phase-3 / 4
> checklist, weighted toward `{{config.auditAnchors.performanceHotZones}}`. For each risk emit a
> finding with an exact `file:line`, the **evidence** (the code that causes it), the **impact**
> (how it scales — "1 query per item → N round-trips for an N-item user"), and the **fix**.
> Calibrate to `{{config.auditAnchors.scale}}`; skip enterprise-only tuning. Confirm index claims
> against the migrations. Findings only.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, walk the slices **serially in one thread**.

---

## Phase 3 — Backend performance checklist

> The flagship: a read-heavy app's killer is **round-trips per request**.

- [ ] **N+1 queries** — the #1 risk. A query that loads a list, then lazy-loads a relation per
  item (a loop issuing a query, or navigation access without an eager-load / join). **Impact
  scales with the user's row count.** Fix: eager-load the relation, or project to a DTO in one
  query.
- [ ] **Missing indexes** — a filter / sort / join on a column with no index → sequential scan
  that worsens as the table grows. Check the migrations for an index on every foreign key used in
  a filter and any column in a hot filter/sort. Add a filtered/partial index where the schema
  needs one. Fix: add the index in a migration.
- [ ] **Over-fetching** — selecting whole rows/graphs where a projection would do; loading a
  graph to read one field; no pagination on a list that grows unbounded.
- [ ] **Synchronous slow work in the request path** — CPU-heavy loops, an external HTTP/AI call,
  email send, or push dispatch done *inline* in a handler instead of offloaded. Confirm the
  inherently-slow AI/chat call isn't blocking unrelated work and is size/time-bounded. Fix: move
  fire-and-forget work to the background queue.
- [ ] **Blocking async** — synchronously blocking on an async task in a request path
  (thread-pool starvation). Async all the way down.
- [ ] **Query materialized too early** — pulling rows into memory then filtering in memory instead
  of composing the predicate into the query.
- [ ] **Missing read-only / no-tracking hint** on read-only queries — change-tracking overhead on
  hot read paths. (Matters more as throughput grows.)

## Phase 4 — Frontend performance checklist

- [ ] **Bundle bloat** — a heavy library pulled into the client bundle for a small need; a
  non-tree-shakeable default import; a large dep that could be dynamically imported / server-only.
  Check the bundler config and the import graph of the heaviest routes; on native, the equivalent
  bundle smell.
- [ ] **Render thrash** — a new object/array/function literal passed as a prop every render
  defeating memoization; an effect with an unstable dependency looping; a missing/unstable key
  forcing list remounts; expensive work in render instead of memoized. **Don't over-flag**: only
  call out memoization where the render is demonstrably hot — premature memoization is its own
  smell.
- [ ] **List virtualization** — a long, unbounded list rendered in full instead of a virtualized
  list. Bounded-small lists are fine; flag only genuinely large ones.
- [ ] **Over-eager caching** — refetching on every mount/focus where the data is stable (cache
  staleness left at aggressive defaults for slow-changing data); a query firing on every keystroke
  without debounce.
- [ ] **Stale caching** — the opposite: a mutation that doesn't invalidate the query it changed,
  so the UI shows stale data; a too-long staleness window on data that must feel live. Both
  directions are findings.
- [ ] **Waterfalls** — sequential awaits/queries that could run in parallel; a client fetch that
  should be server-rendered to cut a round-trip.
- [ ] **Image / asset weight** — unoptimized large images shipped to a small mobile shell.

---

## Phase 5 — Verify (adversarial + completeness)

Before writing the report, run `_shared/verification-protocol.md` — a risk ships only after it
survives a challenge, and the sweep must prove it covered the hot zones.

1. **Adversarial pass (§2).** For every **High / Medium** finding, spawn an independent skeptic
   subagent whose only job is to *refute* it — read the cited `file:line` in full context and argue
   it is a false positive (the impact is bounded at the project's scale, the index actually exists —
   cite the migration, the query is already projected/parallelized, the list is bounded-small, a
   duplicate). Default to refuted when uncertain. Drop or downgrade anything the skeptic disproves.
   Respect `{{config.execution.maxParallelSubagents}}`.
2. **Completeness critic + loop-until-dry (§3).** Run a fresh critic asking *"what did this audit
   NOT examine — a hot zone never swept, a handler or query skipped, an index claim unchecked
   against the migrations?"* Spawn a focused finder round on each gap it names; repeat until a round
   surfaces nothing new (cap: 2 dry rounds — log it).
3. **Deferred ledger (§4).** Roll everything in scope but un-verdicted (enterprise-only tuning,
   load-test territory, a slice left unswept) into the report's **Deferred** section, one reason
   each — never implied as clean.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the skeptic passes and the completeness/loop
rounds **serially in the main thread**.

---

## Phase 6 — Report

**Output path**: `{{config.paths.auditsDir}}/performance-{scope}.md` (create the dir if absent).

```markdown
# Performance Audit: {SCOPE}

**Scope**: {all repos / repo / path}
**Calibration**: {{config.auditAnchors.scale}} scale — patterns that degrade with data/traffic; enterprise-only tuning skipped.
**Verdict**: {1 line — e.g. "One N+1 in the summary query; web bundle clean; 1 missing log index"}

## Findings

### High — degrades with scale (fix before it bites)
{N+1, missing index on a hot path, sync slow work in a request, unbounded list — or "None"}

### Medium — measurable but bounded
{over-fetching, aggressive cache, render thrash on a warm path — or "None"}

### Low / Info — micro, or only-at-enterprise-scale
{noted, deliberately not prioritized — or "None"}

## Hotspots

| Path | Side | Risk | Impact at scale |
|---|---|---|---|
| {handler/route or component} | Backend/FE | {pattern} | {how it grows} |

## Deferred — in scope but not verdicted

{Per verification protocol §4: hot zones or slices the sweep did not reach with a verdict,
enterprise-only tuning, load-test territory — each with a one-line reason. "Nothing deferred — full
coverage" if the contract was met.}

## What's efficient

{Patterns done right — eager-loads, proper invalidation, projections. Not filler.}
```

Each finding uses:

```
[SEVERITY] <one-line risk>
· side: Backend | Frontend
· location: <repo>/<path>:<line>
· evidence: <the code causing it>
· impact: <how it scales — concrete: "N-item user → N queries">
· fix: <the concrete change — eager-load / add index / invalidate cache / dynamic import / virtualize>
```

---

## Guardrails — do NOT

- **Micro-optimize.** Flag patterns that get *quadratically/linearly* worse with data or traffic.
  A one-off small loop is not a finding at `{{config.auditAnchors.scale}}` scale.
- **Over-prescribe memoization / virtualization.** Only where the render is demonstrably hot.
- **List enterprise tuning as findings.** Connection-pool sizing, read-replicas, CDN strategy,
  sharding — note as "out of scope at current scale," don't itemize.
- **Claim an index is missing without checking the migrations.** Read them; cite the migration
  that does (or doesn't) add it.
- **Run a benchmark or load test.** This reads code.
- **Optimize during the audit.** Findings first; change code only if the user asks after.

---

## Output

```markdown
## Audit Complete — Performance

**Scope**: {what was audited}
**Verdict**: {1-line}

| Severity | Count |
|---|---|
| High (scales badly) | {N} |
| Medium (bounded) | {N} |
| Low / Info | {N} |

**Report**: `{{config.paths.auditsDir}}/performance-{scope}.md`
**Top risk**: {the single pattern most worth fixing first, with its scaling impact}
```
