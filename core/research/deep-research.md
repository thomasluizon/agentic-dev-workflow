# Deep Research

> **Config inputs:** `config.research.costCalibration`, `config.research.constraints`, `config.repos`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: `<research question> [--quick | --deep]`

Turn an open question — *"find the best possible way to X for this project"* — into a **decision-ready, evidence-backed recommendation**. The method is **orchestrator-worker**: you (the orchestrator) frame and decompose the question, fan out narrow research subagents in parallel, verify the claims the answer hinges on, loop until the picture saturates, and synthesize **one opinionated recommendation** with sources, concrete numbers, and confidence notes. You stay in the main session; the subagents do the heavy reading so their raw dumps never bloat this context.

**Golden rule**: every load-bearing claim in the final answer traces to a **source fetched this run** (URL + "as of <date>"), or it's explicitly flagged as inference. Pricing, limits, and features change — training memory is a starting hypothesis, never the evidence.

**Sequential fallback:** when `{{config.execution.hasNamedAgentRegistry}}` is false or `{{config.execution.maxParallelSubagents}}` ≤ 1, run the research passes **serially in this one thread** — same decompose → gather → verify → synthesize method, one axis at a time — instead of spawning parallel subagents.

---

## Phase 0 — Frame the question (before any fan-out)

Don't research yet. First pin:

1. **Restate the goal** in one line, and define what **"best" means here** — the decision axes the recommendation is scored on. Pick what applies: cost · setup/maintenance effort · risk/blast-radius · reversibility · fit-to-existing-stack · performance/latency · security/compliance · DX. Name them; they become the columns of the final options table.
2. **State constraints & assumptions explicitly.** Default to `{{config.research.constraints}}` and adjust if the question implies otherwise.
3. **Ask only load-bearing unknowns.** If a missing fact would change the recommendation (budget ceiling, must-keep vendor, deadline, "is X already in place"), ask — recommended option first, batched, one round if possible. If it wouldn't change the answer, pick the sensible default, **state it**, and move on.
4. **Decide depth** (mode table) and **whether codebase facts are needed** — if the question touches the project's own code/config/contracts, plan a codebase-exploration agent to run *in parallel* with the web agents (an env-var/dependency/contract inventory over `{{config.repos}}`), not after.

### Mode detection — parse the arguments

| Signal | Mode | Fan-out | Verify |
|---|---|---|---|
| `--quick`, "just check", single narrow axis | **Quick** | 1-2 agents | single confirm |
| default | **Standard** | up to the `{{config.execution.maxParallelSubagents}}` cap (+ any queued) | targeted re-confirm of top claims |
| `--deep`, "exhaustive", "go crazy", "be thorough"; or high-stakes / hard-to-reverse | **Deep** | waves of agents + **loop-until-saturation** | adversarial refute-panel on every load-bearing claim |

Respect the `{{config.execution.maxParallelSubagents}}` concurrency cap; raise it only when the user explicitly opts into more ("go crazy / no cap / all at once").

---

## Phase 1 — Decompose into research axes

Break the question into **non-overlapping slices**, each ownable by one subagent with zero overlap (two agents must never research the same thing). Slice by whichever fits:

- **by option / vendor** — one agent per candidate.
- **by dimension** — cost & limits · DX & setup · security/compliance · ecosystem maturity.
- **by modality** — official docs/pricing/changelogs · community & forums · head-to-head comparisons · the codebase.
- **by sub-question** — the distinct questions hiding inside the ask.

For each axis write a crisp **objective** + an **output contract** (the exact structured findings to return). List the axes and the agent assignment before spawning.

---

## Phase 2 — Fan out parallel research subagents

Use general-purpose agents for web research and a read-only exploration agent for codebase slices. Launch them in one batch (respecting the cap; queue extras). Under the **Sequential fallback**, run each axis one at a time in this thread instead. **Every research agent prompt embeds this contract** — it is the quality core of the skill:

> **Objective:** <the slice's narrow goal>.
> **Answer exactly these questions:** <numbered list>.
> **How:** Do *deep* research — multiple searches, follow citations, go past the first page. **Fetch primary/official sources** (docs, pricing, changelog, spec, release notes) and **verify each load-bearing fact against the LIVE page** — do NOT answer from memory; prices/limits/features change. Get **current, dated** info ("as of <today's year>"); note when a source was last updated.
> **Return:** a short recommendation up top, then a section per question with **concrete facts** (exact amounts, limits, version numbers) and a **source URL** for each. **Separate hard cited facts from your own inference — flag inferences and state confidence.** Resolve any contradiction you hit rather than reporting both. Decision-ready, no padding.

For **Deep** mode, give parallel agents **distinct lenses** on the same target (one "official pricing", one "real-world gotchas/forums", one "head-to-head vs alternatives") instead of N identical searches — diversity surfaces what redundancy can't.

---

## Phase 3 — Verify the load-bearing claims (adversarial)

Pull out the handful of facts the recommendation will **hinge on** (a price, a hard cap, a licensing rule, a compatibility/version constraint). For each, in Standard mode re-confirm against a second independent source; in Deep mode spawn a small **refute panel** — agents prompted to *disprove* the claim, defaulting to "unverified" on a single source.

- **Resolve contradictions, don't average them.** When two agents disagree, dig until one wins with a primary source (a blog said "12", the official doc + changelog said "1" → trust the doc).
- **Right-size the advice to this project's scale.** A generic source will say "separate org, separate account, isolate everything." Recalibrate to `{{config.research.costCalibration}}`: strip cautions that only matter at a larger scale and say so. This judgment is the difference between a useful answer and a scary one.

---

## Phase 4 — Gaps & iterate (loop until saturation)

Run a **completeness critic** over what you have: *what's missing — an option never researched, a claim still unverified, a modality not searched, a cost not quantified, a Phase-0 constraint not addressed?*

- If there are real gaps and the mode warrants → spawn another **wave** (back to Phase 2 for just the gaps).
- **Stop** when a wave returns nothing materially new, the answer is decision-ready against every Phase-0 axis, or you've hit **diminishing returns** (new passes only restate or bikeshed). Don't loop forever — quit when rounds go style-only.
- **No silent caps.** If you bounded coverage (top-N options, skipped a region/language, sampled), say so in the output.

---

## Phase 5 — Synthesize ONE decision-ready recommendation

Findings first, then the call — and **be opinionated** (don't hand back an un-ranked survey). Synthesize; never relay raw agent dumps. Structure:

- **Recommendation** — the single best path, up top, in one or two sentences.
- **Options table** — candidates × the Phase-0 decision axes, with **concrete numbers** (cost/mo, limits, versions) in the cells.
- **Why** — the reasoning, tied back to the axes and the stated constraints.
- **Cost & effort** — give a **cheapest-viable vs. best-practice split** with real figures, and a **now-vs-later timeline** when the cheap path defers a cost, calibrated to `{{config.research.costCalibration}}`.
- **Citations** — source URLs for every load-bearing fact.
- **Confidence & caveats** — what's certain vs. inferred, and what to re-verify before betting on it.
- **Sequenced next steps** — what to do first.

---

## Phase 6 — Capture

Offer (don't do unsolicited):

- **Report** — write the full findings to a working research directory (`{{config.paths.researchDir}}/<kebab-name>.md`).
- **Issue** — open a tracking issue if the result is actionable work.
- **Memory/notes** — persist the decision + durable facts wherever the host tool keeps long-lived project notes (update an existing note first if one exists).

---

## Guardrails — do NOT

- **Answer from training memory alone.** If a fact wasn't fetched this run, it's unverified — say so or go get it. The skill's whole value is *current, cited* evidence.
- **Relay raw subagent reports.** Synthesize into one opinionated deliverable; cut the padding and the scare-framing.
- **Hand back a survey with no recommendation.** Be opinionated about which option has the best leverage for *this* project.
- **Over-prescribe.** Don't recommend larger-scale isolation/tooling than `{{config.research.costCalibration}}` warrants; right-size cost and effort.
- **Fabricate URLs or numbers.** A missing/unverifiable fact is reported as such, never invented.
- **Exceed the `{{config.execution.maxParallelSubagents}}` concurrency cap** unless the user opted into more.
- **Loop past diminishing returns**, or run forever chasing a marginally better source.
- **Implement or refactor during research** — findings first; write code only if the user asks after seeing the recommendation.
