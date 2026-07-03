# LLM Council

> **Config inputs:** `config.research.constraints`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: `<topic or decision to vet> [--panel N]`

Run a decision through a **council of independent perspectives** and return **one synthesized recommendation** — not a survey. Each councillor frames the topic from a genuinely different lens, the panel critiques each other (peer review), and a chairman pass weighs the takes and commits to a call, keeping the strongest dissent visible.

**Golden rule**: the value is in **diversity then synthesis** — N councillors that would actually disagree, collapsed into one opinionated recommendation. A panel that all says the same thing, or a synthesis that just lists everyone's view without deciding, both fail.

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, run each councillor's framing and the peer-review pass **serially in this one thread** — adopt each lens in turn, write its framing, then review the collected framings against each other — instead of spawning parallel subagents.

---

## Method

The method is the **panel-of-advisors pattern**: independent perspectives → peer review → chairman synthesis. Each councillor is an **independent subagent given a distinct role + lens** (separate context, no cross-talk until peer review). The independence that matters — uncorrelated framings that surface blind spots — comes from the **distinct lenses**, not from distinct model weights. Self-contained: no network call; the reasoning *is* the function. (If the topic needs *external current facts* — pricing, a vendor's limits — that's `deep-research`, not this.)

---

## Phase 0 — Frame the decision

Pin, in one or two lines each:

1. **The question** — restate it as a decision: "should we X or Y?", "is this plan sound?". If vague, sharpen it to something a recommendation can answer.
2. **What "good" means here** — the axes the call is scored on (pick what applies: blast radius / reversibility / effort / cost / fit-to-stack / user impact / maintenance / risk).
3. **Constraints** — default to `{{config.research.constraints}}` when relevant. State assumptions rather than interrogating; ask only a load-bearing unknown that would flip the recommendation.
4. **Panel size** — default **4 councillors** (+ chairman). `--panel N` overrides; floor 3, and cap the concurrent councillors at `{{config.execution.maxParallelSubagents}}` (queue extras).

---

## Phase 1 — Assemble the panel (distinct lenses)

Choose councillors whose lenses would genuinely pull in different directions on *this* topic. A strong default set — adapt to fit the decision:

| Lens | Pushes for | Catches |
|---|---|---|
| **The Pragmatist** | shipping the simplest thing that works now | over-engineering, gold-plating |
| **The Architect** | long-term structure, leverage, clean seams | short-term hacks that ossify |
| **The Skeptic / Red-team** | what breaks, what's been missed | happy-path thinking, unstated risk |
| **The User/Product advocate** | the person on the other end of the change | tech-first decisions that hurt UX |
| *(optional)* **The Cost/Ops realist** | cost and operational burden at the project's real scale | choices cheap to build, costly to run |
| *(optional)* **The Maintainer (6-months-later)** | who debugs this at 2am | cleverness that won't survive contact |

For `--panel N`, pick the N most load-bearing lenses; never two that would say the same thing (correlated councillors waste the panel).

---

## Phase 2 — Independent framings (fan out)

Spawn the councillors as **independent subagents** up to the `{{config.execution.maxParallelSubagents}}` cap (queue extras), each blind to the others. Under the Sequential fallback, adopt each lens in turn instead. Each prompt embeds:

> **You are <lens>** vetting: <the decision, with Phase-0 framing & constraints>. Argue **from your lens only** — don't hedge into neutrality. Give: your **recommendation** (a clear position, not "it depends"), the **2-4 reasons** that drive it, the **strongest risk or cost** you see, and the **one thing that would change your mind**. Be concrete and decision-oriented; no padding. ~200 words.

Independence is the point — do **not** let them see each other yet.

---

## Phase 3 — Peer review

Now expose the framings to each other and run one critique round (a second pass of the same subagents, or a single consolidated critique step for a small panel). Each councillor:

- names the **strongest point another councillor made** that it initially missed, and
- names the **weakest claim on the table** and why.

This is where blind spots collapse. Capture the **points of agreement** (the panel converged) and the **live disagreements** (genuine, unresolved tradeoffs).

---

## Phase 4 — Chairman synthesis (commit to one call)

You are the chairman. **Decide** — don't relay. Weigh the framings and the peer review, and commit:

- **Recommendation** — the single best path, up top, in one or two sentences. Opinionated.
- **Why** — the reasoning, tied to the Phase-0 axes and constraints; name which councillors' points carried the most weight and why.
- **Tradeoffs accepted** — what this call gives up (the losing lenses weren't *wrong*, they were outweighed — say so).
- **Strongest dissent** — the best argument against the recommendation, kept visible so the user can overrule with eyes open.
- **Confidence & what would change it** — how sure, and the fact/condition that would flip the call.
- **Next step** — the first concrete action.

When the panel is genuinely split with no dominant case, **say so and give the decision rule** (e.g. "if reversibility matters most → A; if you won't revisit this for a year → B") rather than forcing false certainty.

---

## Output

```markdown
## Council Verdict: {topic}

**Recommendation**: {one or two sentences — the single call}

### The panel
| Councillor | Position | Key point |
|---|---|---|
| Pragmatist | {for/against X} | {one line} |
| Architect | … | … |
| Skeptic | … | … |
| {…} | … | … |

### Where the panel converged
{the points all/most lenses agreed on}

### Live tradeoffs
{the genuine disagreements, stated as tradeoffs — not averaged away}

### Why this call
{the chairman's reasoning, tied to the decision axes}

### Strongest dissent
{the best case against — kept visible}

### Confidence & next step
**Confidence**: {high/medium/low — and what would change it}
**Do first**: {the concrete next action}
```

---

## Guardrails — do NOT

- **Hand back a survey.** The chairman pass must **decide**. N views with no verdict is the primary failure mode.
- **Run a correlated panel.** Councillors that all reason the same way add nothing — pick lenses that genuinely conflict.
- **Average the disagreements away.** Surface real tradeoffs and pick; don't mush them into a bland middle.
- **Bury the dissent.** The strongest counter-argument stays in the output.
- **Manufacture false balance.** If one option is clearly right, say so.
- **Use this for external-fact questions.** Pricing / a vendor's current limits / "what's the best tool" needs fetched evidence → `deep-research`. The council reasons; it doesn't research.
- **Exceed the `{{config.execution.maxParallelSubagents}}` concurrency cap** unless the user opted into more.
- **Implement anything.** This vets a decision; it writes no code.
