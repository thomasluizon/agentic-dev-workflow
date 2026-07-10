# Thermo-Nuclear Code-Quality Review

> **Config inputs:** `config.repos`, `config.pr`, `config.parity.enabled`, `config.parity.mirrors`, `config.contract.enabled`, `config.branchNaming.pattern`, `config.branchNaming.types`, `config.worktree.root`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: blank (all repos in `{{config.repos}}`) or a repo/path narrowing it.

An extremely strict, **behavior-preserving** whole-repo structural refactor pass: split giant
files, flatten spaghetti conditionals, deepen thin abstractions, dedup cross-app logic into the
shared package, move logic to its canonical layer — under hard build/test/schema gates, delivered
as one PR per repo with an Applied table + a complete Deferred ledger. Use ONLY when the user
explicitly asks for a thermo-nuclear / nuclear / deep structural-quality pass. This rewrites code;
it is not the read-only `audit-code-quality`.

Adapted at authoring time from a strict maintainability rubric
(https://github.com/cursor/plugins — the "thermo-nuclear-code-quality-review" pattern) wrapped in
a phased, coverage-contracted, hard-gated harness. That URL is the single WHY-with-URL the comment
policy allows.

**The one non-negotiable: every change is behavior-preserving.** Structure only — never behavior,
never UI, never an API/DTO contract, never the DB model/schema. If a refactor *could* change what
the program does, it is out of scope. The gate in Phase 2 is not "tests pass," it is "behavior is
provably identical."

**Golden rule**: deepen the codebase — more behavior behind a smaller, clearer interface — without
moving a single observable byte. A change that merely *relocates* size (a 1k file becomes ten
100-line files that still do the same tangled thing) is reported honestly as relocation, not
celebrated as simplification.

---

## The standard — what "thermo-nuclear" flags

Strict, demanding, but never a nit machine. Lead with high-conviction structural wins; quote the
exact pattern when you flag it. Ranked by leverage — fix in this order:

1. **Structural regressions / missed dramatic simplifications** — the "code-judo move": a
   reframing of the state model or data shape that deletes whole branches. The highest prize; hunt
   it first.
2. **Spaghetti branching** — special-case `if/else` ladders and flag soup that grow every time a
   case is added. Flatten with early returns, a lookup table, or polymorphism.
3. **Boundary / abstraction clarity** — thin wrappers that earn nothing (the deletion test: if
   removing the module makes complexity vanish, it was a pass-through), and "magical" abstractions
   that hide control flow. Deepen the keepers; delete the indirection.
4. **Giant files** — anything past ~1k lines, or a file doing many jobs. Split by responsibility
   into sibling files. (In languages with partial-type support: use it — same compiled type, zero
   behavior risk. Otherwise: extract inline subcomponents/helpers to siblings, keeping the render
   tree and hook/init order unchanged.)
5. **Cast / optionality churn** — escape-hatch casts and null-forgiving operators, plus needless
   optionality-juggling that a better type or a single parse at the boundary removes.
6. **Modularity & cross-app duplication** — the same logic duplicated across apps belongs in the
   shared package; the same logic across handlers belongs in one helper. Dedup at the right level.
7. **Logic in the wrong layer** — business logic leaking into a controller/component/DTO instead of
   living in its canonical layer (domain entity, handler, shared util).

**Remedies preferred:** delete indirection · reframe the state model so branches collapse · extract
a well-named pure helper · split a file by responsibility · lift duplication to the shared package ·
move logic to its canonical layer · replace a cast tower with one boundary parse. **Never**
introduce a new DI service, reflection, a new command/handler, a new endpoint, or a behavior flag —
those are behavior changes, not refactors.

---

## Phase 0 — Baseline + binding coverage contract

Resolve scope (blank → **all repos in `{{config.repos}}`**; a repo/path narrows it).

1. **Capture the baseline BEFORE touching anything** — on a clean, up-to-date
   `{{config.pr.baseBranch}}`, per repo in scope: run that repo's `buildCmd`, `testCmd` (record the
   pass count), `lintCmd`, and `typeCheckCmd` from `{{config.repos}}`, plus any schema-drift check
   the project has (e.g. a migrations "no pending model changes" check — record: no pending
   changes). Note known local-only noise (deps absent locally that pass in CI) — confirm it doesn't
   reproduce on clean base before blaming a change.
2. **Build the ranked inventory (verification-protocol §1).** Fan out **read-only scouts**,
   respecting `{{config.execution.maxParallelSubagents}}`, to inventory the worst offenders per repo
   (target the top ~20): largest files, deepest nesting, thinnest abstractions, most-duplicated
   logic, most layer-leakage — ranked by blast-radius × churn. This list is **binding**: by the end
   every entry is either **fixed** or in the **Deferred ledger** with a concrete, verified reason.
   There is no "quietly skipped" bucket — that is the failure this skill exists to prevent.

Read `_shared/verification-protocol.md` — its coverage contract (§1) and Deferred ledger (§4)
govern this run.

---

## Phase 1 — Parallel behavior-preserving refactors

Fan out subagents, respecting `{{config.execution.maxParallelSubagents}}`, each owning
non-overlapping inventory items, each in its **own git worktree** (rooted at
`{{config.worktree.root}}`) so parallel edits never collide. Each subagent:

- Applies only the behavior-preserving techniques above (partial-type split + static helper
  classes where the language supports it; sibling extraction with identical render tree / hook order
  / public props otherwise). No new services, no reflection, no new commands/endpoints.
- **Honors cross-surface parity** when `{{config.parity.enabled}}` is true: a split on one side of a
  `{{config.parity.mirrors}}` pair lands the mirror split on the other side. **Never claim
  cross-surface symmetry without opening both files** — a file that looks like a monolith on one
  side is often already split on the other; verify, don't assume.
- **Reports size honestly.** If a giant file becomes many files that still carry the same tangled
  logic, say "relocated, not simplified" in the Applied table — do not dress relocation up as a
  code-judo win.

Subagents do the edits only; **the orchestrator owns all git/build/test** (a shared tree + parallel
build/test runs corrupt each other). Collect each subagent's diff summary.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, work the inventory **serially in one thread on one
branch** — no worktree fan-out; the orchestrator still owns build/test between items.

---

## Phase 2 — Hard verification gates (behavior preservation IS the gate)

Nothing merges until every gate is green. Run from the orchestrator, per touched repo, using the
commands from `{{config.repos}}`:

- **Backend repo**: `buildCmd` (0 errors) → `testCmd` (**0 failures, count ≥ baseline**) → the
  schema-drift check (**model byte-identical — no pending changes**; a pending change means the
  refactor altered the schema → revert it).
- **Frontend repo**: `typeCheckCmd` + `lintCmd` + `testCmd`, each green and count ≥ baseline.
- **Comment gate:** if the project's no-narration-comment rule is enforced only in CI (a linter that
  is silent locally), grep changed code for bare narration comments (non-doc, no `http(s)://` URL)
  before pushing, or CI fails on a locally-green build.
- **New-code-coverage gate note:** a large relocation refactor will trip a "coverage on new code"
  gate (relocated under-tested lines re-count as "new"). This is an attribution artifact, not a
  regression — resolve by **admin-overriding that gate**, never by writing throwaway tests against
  the "test behavior not implementation" rule. Surface it to the user as a decision; don't silently
  scope-creep into mass test-writing.

A finding that survives all gates ships. Anything that can't be made green is **reverted** and moved
to the Deferred ledger — a refactor is not worth a behavior risk.

---

## Phase 3 — Deliver (one PR per repo)

A fresh branch off latest `{{config.pr.baseBranch}}` per touched repo (named per
`{{config.branchNaming.pattern}}`, `{type}` drawn from `{{config.branchNaming.types}}` — never reuse
an already-merged branch). One PR per repo, cross-linked, with:

```markdown
## Thermo-Nuclear Structural Review — {repo}

**Behavior-preserving** structural refactor. No behavior / UI / contract / schema change.

### Applied
| File(s) | Before → after | Technique | Honest note |
|---|---|---|---|
| <handler file> | 1227 → 275 (+6 partials) | partial-type split | decomposed by responsibility |
| <list component> | 1888 → 1604 | sibling extraction | PARTIAL — residual is closure-bound render |

### Deferred (verification-protocol §4)
| Inventory item | Why not done |
|---|---|
| <db-context file> | single cohesive config; splitting adds indirection for no leverage |
| ... every un-fixed inventory entry, with a concrete reason | |

### Verification
- backend: build ✅ · tests {N}/{N} (baseline {B}) ✅ · schema model identical ✅
- frontend: type-check ✅ · lint ✅ · tests ✅
- new-code-coverage gate: expected relocation artifact → override (see note)
```

**Do not merge** — hand the PRs to the user. Branch protection + the merge (per `{{config.pr}}`) are theirs to click.

---

## Guardrails — do NOT

- **Change behavior, UI, an API/DTO contract, or the DB model.** If you can't prove a change is
  invisible to callers and to the database, it is out of scope — revert + defer. (When
  `{{config.contract.enabled}}` is true, the DTO/contract freeze is absolute.)
- **Fix two easy files and stop.** The Phase-0 inventory is binding; every entry is fixed or in the
  Deferred ledger.
- **Silently omit a big offender.** A hard file left alone is a Deferred-ledger line with a reason,
  never an unstated gap.
- **Claim parity without opening both files.** Verify cross-surface symmetry by reading each.
- **Report relocation as simplification.** Honest Applied notes only.
- **Let a subagent run git/build/test** on the shared tree — the orchestrator owns those.
- **Add a new abstraction for its own sake.** Deepen existing modules; the simplicity and
  no-premature-abstraction rules still hold (this cuts code, never adds speculative layers).
```
