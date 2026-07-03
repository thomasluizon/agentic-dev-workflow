# Intelligent-Test Rubric

> **Config inputs:** `config.auditAnchors.criticalPaths`

What makes a test worth its keep. The `audit-tests` skill scores every test against this
rubric. Assembled from the testing-pyramid + behavior-over-implementation canon; it is
stack-agnostic — it judges what a test would *catch*, not which framework wrote it.

**The one axiom:** a test is valuable in proportion to what it would **fail on**. A test that
cannot fail when the behavior breaks is worse than no test — it is a false sense of safety.

---

## The three axes — score every test

A real test pins behavior on all three. Score each test on each axis:

1. **Behavior** — does it assert the *observable outcome* of the unit (return value, emitted
   state, persisted effect), not that a function was merely called? A test that only checks "the
   happy path returns something" covers one axis.
2. **Edge** — does it exercise the boundaries: empty / zero / null / first / last / max /
   boundary values / timezone edges? Most real bugs live here, not on the happy path.
3. **Failure** — does it assert the *error* path: invalid input is **rejected** (not just valid
   input accepted), the exception is thrown, the rejected promise surfaces, the guard denies?

A test strong on all three is healthy. Behavior-only (happy-path-only) is the most common
weakness; edge-and-failure gaps are the highest-value tests to add.

---

## The smell list — flag these

- **Happy-path-only** — only the success case; no rejection, no edge, no failure.
- **Rubber-stamp** — asserts a mock was called, or `expect(true).toBe(true)`, or re-asserts the
  literal it just set up; cannot fail when the behavior breaks.
- **Over-mocked** — so much is stubbed that the unit under test never actually executes; the test
  proves the mocks, not the code.
- **Implementation-coupled** — asserts private internals / call order instead of observable
  behavior; breaks on safe refactors. An explicit anti-pattern — a test that blocks refactors is
  a liability even when it "passes."
- **Missing edge** — no empty/zero/null/first-last/boundary/timezone-edge case.
- **Missing failure** — the error path, the thrown exception, the rejected input is untested.
- **Snapshot-as-crutch** — a giant snapshot standing in for real assertions; it "passes" but
  nobody can say what it protects.

---

## Critical-path weighting

A gap on a critical path outranks the same gap on a leaf. Treat the paths in
`{{config.auditAnchors.criticalPaths}}` as the highest-weight surfaces — an untested or
happy-path-only critical path is the audit's top-priority finding. Typical critical paths a
project lists there: authentication, billing / entitlement, AI/agent tools, data-isolation,
date/timezone logic, and input validation.

For each critical path, the audit asks: **is there a test, and would it actually fail if the
behavior broke?** A "yes there's a test" that is rubber-stamp or happy-path-only counts as a gap,
not coverage.

---

## What a real test looks like (per critical-path family)

| Path family | What a real test must pin |
|---|---|
| Auth | login success + wrong-password rejection + expired/invalid token + unauthorized access to a protected route is denied |
| Billing / entitlement | a valid purchase grants entitlement; a forged/unsigned webhook is rejected; gated features deny un-entitled users; entitlement state transitions |
| AI / agent tools | a tool acts only on the caller's data; ownership is enforced; bulk/destructive ops behave; malformed args are rejected |
| Data-isolation | a user cannot read/mutate another user's rows (pass the wrong principal id, assert denial/empty) |
| Date / timezone | boundary logic (due-today / overdue) across timezone edges |
| Validation | invalid input is *rejected*, not just valid input accepted |
