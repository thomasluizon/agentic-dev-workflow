# Debugging & investigation

**At a glance:** 8 standing rules for chasing a bug, triaging an issue, running an incident
investigation, and resolving merge conflicts. Judgement-bound; none is gate-checkable — this is
the reasoning a gate cannot carry, sitting alongside the machine-checked guardrails.

The through-line: **you earn the right to hypothesise by first building something that can prove
you wrong.**

## Before you theorise

### 1. No red-capable command, no hypothesising
Build one command **you have already run** that is:

- **red-capable** — it drives the real code path and asserts the exact symptom,
- **deterministic** — same result every run,
- **fast** — you will run it dozens of times,
- **agent-runnable** — no manual clicking.

Until that command exists and is red, you have no bug; you have a story about a bug. The
behavioral baseline (§5, goal-driven execution) asks for "a check you can run" but never sets the
bar or forbids theorising before it exists. This does both. An incident investigation that starts
from a captured production error has its symptom handed to it; a local bug has no equivalent gate,
so build one first.

### 2. Minimise the repro before hypothesising
Once the loop is red, **cut before you think**: inputs, callers, config, steps — one at a time,
re-running after each cut, until every remaining element is load-bearing.

This shrinks the hypothesis space before you spend hypotheses on it, and it hands you the
regression test for free.

## While you theorise

### 3. Three to five ranked hypotheses, each with a falsifiable prediction
Generate **3-5 ranked hypotheses before testing any of them.** Each must state what would make it
false: *"if X is the cause, changing Y makes the bug disappear."*

**A hypothesis with no stated prediction is a vibe — sharpen it or discard it.** Then change **one
variable per probe**.

This directly counters single-hypothesis anchoring, the dominant failure mode of a confident
debugger. It complements the adversarial-verification discipline (see `../verification-protocol.md`)
without duplicating it: that governs multi-agent review, this governs debugging.

### 4. Tag every temporary debug log with a unique prefix
Use something greppable and unmistakable — `[DEBUG-a4f2]`. Removing all instrumentation is then a
single grep, and **confirm the grep is empty before declaring the fix done**.

A no-stray-log lint gate catches what survives to a commit. This makes cleanup **structural during
the session** instead of relying on the gate to catch a leak.

## After you are right

### 5. State the winning hypothesis in the commit or PR
Record **which hypothesis turned out correct**, so the next debugger inherits the reasoning and
not just the diff.

Cheap, durable, and nothing in a git convention asks for the why behind a fix.

## Triage

### 6. Search by domain concept, not by the issue's wording
Before acting on an issue, search the codebase for an existing implementation **by what it does**,
not by the words the reporter used — and **report where you looked**. An already-implemented
request is closed pointing at where it lives, not built a second time.

Not covered by the priming or planning steps, which say to read the named issue but never to check
whether it is already done. This is the exact failure mode of a long backlog carried across many
sessions.

### 7. Verify the claim before planning against it
Reproduce the bug from the reporter's steps, or run the tests for a PR that claims a fix. Report
the outcome as one of three:

- **confirmed** — with the code path,
- **failed to reproduce**,
- **insufficient detail**.

**Insufficient detail is itself the finding**, not a reason to guess and proceed. This sharpens the
never-assume baseline into a concrete pre-planning step: an incident-investigation flow is
prod-incident-only and never names reproduction as a gate before a plan is written.

## Merge conflicts

### 8. Resolve from primary sources; never invent behaviour in a hunk
Read **each side's originating commit, PR, and issue** to recover intent before choosing. Then:

- where the two intents **compose**, preserve both;
- where they are **incompatible**, pick the one matching the merge's stated goal and note the
  trade-off.

**Never invent new behaviour in a conflict hunk, and never abort the merge to escape the choice.**

A conflict hunk is precisely where invented behaviour slips in unreviewed — it arrives already
looking like someone else's code. This matches the read-before-you-claim and root-cause postures,
and nothing in a git workflow covers conflict resolution.
