# Review & audit discipline

**At a glance:** 11 standing rules for diff review, repo-wide audits, cross-commit sweeps,
pre-launch readiness passes, and any fan-out assessment. Judgement-bound; none is gate-checkable —
they carry the reasoning behind the mechanisms in `../verification-protocol.md`, not a substitute
for them.

## What a review is allowed to say

### 1. Never re-flag what a gate already enforces
State findings against what the repo **documents**, not against re-derived taste. If a lint rule, a
pre-tool hook, or an analyzer the project defines already fails on it, a reviewer repeating it is
pure noise — the gate has it covered and the author will see it.

This is the natural-language companion to gates-over-prose, and it is first because it is the one
most often broken.

### 2. Carry the Fowler smell baseline as the floor
Where the repo documents nothing, these still apply: **Mysterious Name, Duplicated Code, Feature
Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change,
Speculative Generality, Message Chains, Middle Man, Refused Bequest.**

Label each as a judgement call. **A documented repo standard always overrides this list.** It names
failure modes a typical short code-standards list does not (Feature Envy, Data Clumps, Shotgun
Surgery, Divergent Change), which is why it earns a place — but the project's own documented
standard stays supreme.

### 3. Separate the two axes; never merge or re-rank them
Review along **Standards** (does it follow the repo's documented rules?) and **Spec** (does it do
what the originating issue asked?). Report them side by side, name the worst finding *within* each
axis, and never pick a single cross-axis winner.

A change can pass one and fail the other. Merging them lets a clean-standards diff mask an
implementation that built the wrong thing. A review that fans multiple agents over one shared
rubric must keep this separation deliberate.

## Running a fan-out

### 4. Resolve the fixed point in the parent, before fanning out
Confirm the ref resolves and **the diff is non-empty** in the orchestrator. A bad ref or an empty
diff must fail **once**, loudly, in the parent — not N times inside children who each confidently
report "no findings."

An empty diff otherwise buys N clean reports, which is worse than an error because it looks like
success. (This is the coverage contract of `../verification-protocol.md` §1 applied at the ref.)

### 5. A degraded run is a failed run, not a cheaper one
If an orchestrated review cannot run its assessments in isolated parallel sub-agents, **lead the
report with an explicit degraded banner naming the reason**. A silent single-context fallback is
not an acceptable substitute; it changes what the review is worth and the reader must know.

### 6. LLM judgement is recorded before detector output enters the context
In any review pairing human/LLM judgement with a deterministic detector, **finish and record the
judgement first**. Deterministic findings anchor judgement even when they are correct — once you
have seen the lint output, you review the lint output.

Ordering rule, stack-neutral. Complements the adversarial-verification protocol rather than
duplicating it.

### 7. Group findings; stop at ~50
Group by **rule ID and component family**, not one entry per instance. If a single pass returns
more than ~50 violations, **stop and ask** rather than emitting the list. A 200-item report is not
actionable, and nothing else caps finding volume.

## What a finding may claim

### 8. Never fabricate a `file:line`
Cite the selector verbatim. Attach `file:line` **only when the tool actually supplied a source
mapping**; otherwise state plainly that the finding is located by selector only.

An audit that mandates `file:line` evidence but never says what to do when the location is
genuinely unavailable creates exactly the pressure that invents a line number.

### 9. A clean detector result is not evidence of quality
Treat detector, lint, and automated-QA output as **defect evidence only**. A green script says
defects of that class were not found; it says nothing about whether the surface is well designed.

This one exists to stop a gates-over-prose culture from degrading into "the gates are green, so the
design is fine."

### 10. A performance claim needs metric evidence for that surface
A recommendation must trace to an **observed metric for the specific route/surface**. A static-scan
finding with no traffic evidence is supplementary only and is never ranked as a fix.

A performance audit with no stated evidence bar will otherwise report a grep-derived "slow path" as
fact.

## Fixing what an audit found

### 11. Split findings by fixability, and verify by re-running
Apply **mechanically-detectable** fixes verbatim. For **judgement-bound** ones (content clarity,
screen-reader announcement quality, keyboard-flow coherence, complex visual contrast), leave a TODO
naming the rule and flag for human review. **Never invent the content** — a fabricated alt text or
label closes the finding and keeps the defect.

Then verify by **re-running the identical audit and diffing against the recorded baseline**: every
targeted violation gone **and no new one introduced**. A fix pass that does not diff against a
before-list has not verified anything — this is the no-new-regressions half that goal-driven
execution omits.
