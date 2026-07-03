# PRD: Generate a Product Requirements Document

> **Config inputs:** `config.projectName`, `config.repos`, `config.parity`, `config.research.costCalibration`, `config.research.constraints`, `config.conventionsDocs`

Produce a Product Requirements Document from either a live conversation (warm) or a cold-start interview. This one skill has **two gathering paths** that converge on the same PRD template.

**Usage**: `prd [output-filename] [--cold] [--research | --no-research]`

- **Warm (default)** — synthesize the PRD from the conversation and codebase context you already have. Do NOT interview by default; fill reasonable assumptions and mark them.
- **Cold (`--cold`, or an empty idea/context)** — run the question-by-question interview first, then write the PRD from the answers.
- `--research` / `--no-research` — force on / force off the optional research branch (warm path). See Phase 1.5.

**Output file**: the `output-filename` argument with any flags stripped (default `PRD.md`), written to a working PRDs directory (`{{config.paths.prdsDir}}/`). Cold mode derives a kebab-case name from the idea when no filename is given.

---

## Mode detection (do this first)

Branch once, then do NOT run the other path.

| Condition | Path |
|---|---|
| `--cold` present, OR there is no warm conversation/idea to synthesize from | **Cold** — go to "Cold path (interview)". |
| An idea or discussion already exists in context and no `--cold` | **Warm** — go to "Warm path (synthesis)". |

Both paths end at the shared **PRD template**, **Validate**, and **Output** sections.

---

## Warm path (synthesis)

You are synthesizing what you already know. Interview only if a **material** product decision is missing.

### Phase 1 — Extract

Review the conversation and explore the repos in `{{config.repos}}` as needed (prefer targeted glob/grep/read; consult `{{config.conventionsDocs}}` for where canonical patterns live). Identify explicit requirements, implicit needs, constraints, and success criteria.

**Sketch the major modules** you would build or modify. Actively look for **deep modules** — a lot of behavior behind a small, testable interface that rarely changes. Where a module split affects scope, product behavior, or long-term architecture, confirm the split with the user, and confirm which modules they want tests for when it is not obvious.

If a **missing decision would materially change the PRD**, ask one focused question and wait. Otherwise proceed.

### Phase 1.5 — Research open decisions (conditional)

Most PRDs need NO external research — they extend an existing product surface. Reach for the `deep-research` skill only when the PRODUCT approach has a genuine unknown.

**Trigger** research when EITHER:
- `--research` was passed (force it), OR
- Phase 1 surfaced an open product/approach question with no in-house precedent — a feature **category** the project hasn't built; a third-party integration or vendor choice; a market/UX/pricing/compliance pattern needing current best practice; or an Open Question that is a genuine "what's the best way to X" rather than a decision you can just make.

**Skip** (the common case) when the PRD extends an existing feature, mirrors something already shipped, or `--no-research` was passed. Note in one line that research was skipped.

**How:** invoke `deep-research "<the specific open question>"` scoped to the decision, calibrated to `{{config.research.costCalibration}}` and `{{config.research.constraints}}`. Fold its findings into §6 (Architecture), §13 (Risks), and §14 (Open Questions) with cited sources. The PRD stays the source of truth; attach research as evidence, not a prose dump.

**Guardrail — project posture wins.** Research informs; it does not override the project's product posture, design canon, or the constraints in `{{config.research.constraints}}`. When a finding conflicts, the project choice wins and the PRD records the deviation and why.

### Phase 2 — Synthesize

Organize into the shared PRD template below. Fill reasonable assumptions where details are missing and track them. Maintain internal consistency.

Then continue to the **PRD template**, **Validate**, and **Output** sections.

---

## Cold path (interview)

You are a sharp product manager who starts with PROBLEMS, not solutions; thinks in hypotheses, not specs; and acknowledges uncertainty honestly.

**Anti-fluff rule:** never invent plausible-sounding requirements. If information is missing, write `TBD — needs research` rather than fabricating.

Ask **one focused group at a time** and wait for the answer before the next. If a question is answerable from the codebase, explore it instead of asking.

### Phase 1 — Initiate

- If no idea was provided: *"What do you want to build? Describe it in a few sentences."*
- If an idea was provided: restate it — *"I understand you want to build: {restated}. Correct?"* — and wait.

### Phase 2 — Foundation

> 1. **Who** has this problem? Be specific about the persona.
> 2. **What** problem do they face today?
> 3. **Why** can't they solve it now? What alternatives exist?
> 4. **Why now?** What changed that makes this worth building?
> 5. **How** will you know it's solved?

### Phase 3 — Deep dive

> 1. **Vision** — one sentence: the ideal end state.
> 2. **Job to be done** — "When [situation], I want to [motivation], so I can [outcome]."
> 3. **MVP** — the absolute minimum to test the hypothesis.
> 4. **Out of scope** — what you're explicitly NOT building.
> 5. **Constraints** — time, technical, or product.

### Phase 4 — Scope & surface

> 1. **Which repos?** Route against the roles in `{{config.repos}}` (e.g. frontend-only, backend-only, or both).
> 2. **Parity** — if `{{config.parity}}` is enabled, confirm any surface that must stay mirrored across the paired platforms, or call out an intentional single-surface exception.
> 3. **API surface** — new endpoints? modified shapes? auth changes? ("None" is a valid answer.)
> 4. **Data model** — new tables, columns, migrations? ("None" is valid.)
> 5. **User-facing strings** — any new copy that needs translating across the project's locales?

Then continue to the **PRD template**, **Validate**, and **Output** sections, filling from the answers (use `TBD — needs research` for anything still unknown).

---

## PRD template

Write the PRD in markdown, concrete examples over abstractions, code snippets in technical sections. Keep it **product-oriented, not file-oriented** — do not pin specific file paths or code that will go stale. Route every behavior-bearing section against the repo **roles** in `{{config.repos}}`; when `{{config.parity}}` is enabled, call out any web-or-mobile-only intent explicitly.

**1. Executive summary** — overview (2-3 paragraphs), core value proposition, MVP goal statement.

**2. Key hypothesis** — "We believe {capability} will {solve problem} for {users}. We'll know we're right when {measurable outcome}."

**3. Target users** — primary personas, technical comfort, key needs/pain points, and the **Job to be done** ("When {situation}, I want to {motivation}, so I can {outcome}"). Name the non-users too.

**4. Scope** — In Scope (checkboxes, grouped by repo role), Out of Scope (checkboxes + rationale), and a **Repo Touch Matrix**:

| Capability | {role A} | {role B} | shared |
|------------|----------|----------|--------|
| … | yes/no | yes/no | yes/no |

(Columns are the roles present in `{{config.repos}}` plus any shared layer.)

**5. User stories** — 5-8 in "As a [user], I want to [action], so that [benefit]" form, each with a concrete example, each tagged with the repo role(s) it touches.

**6. Architecture & patterns** — high-level approach per repo role: for a client role, which surfaces/routes, data-access seam, state; for a server role, the command/query handlers, validators, controller/route, migrations; for a shared layer, new types, endpoint constants, query keys. Fold in any Phase 1.5 research findings with citations.

**7. API contract** (if server changes) — endpoint path, request/response shape (typed schema), auth requirements, example payloads. Locate these in the shared contract layer named by `{{config.conventionsDocs}}`.

**8. UI/UX** (if client changes) — the flow per platform, i18n keys to add across every locale, theme/color considerations. Respect the project's design canon.

**9. Data model** — new domain entities, DB migration sketch, query keys to add.

**10. Security & configuration** — auth approach, env/config needed, validation requirements at trust boundaries.

**11. Success criteria** — MVP success definition, functional requirements (checkboxes), quality indicators (test coverage, perf budgets), and a metrics table (metric · target · how measured).

**12. Implementation phases** — 3-4 phases, each: Goal, Deliverables (checkboxes), Validation criteria, depends-on. Prefer a thin vertical slice across roles, or server-first then client.

**13. Risks & mitigations** — 3-5 risks with mitigations.

**14. Open questions** — anything to resolve before breaking the PRD into stories. Mark genuine "what's the best way to X" items as research candidates.

---

## Validate

Before emitting:

- [ ] All required sections present (unknowns marked `TBD — needs research`, not fabricated).
- [ ] Every user story is tagged with its repo role(s).
- [ ] The Repo Touch Matrix is filled.
- [ ] Implementation phases are actionable and ordered by dependency.
- [ ] Assumptions are tracked, not silent.

---

## Output

Write the file, then emit a compact digest:

```markdown
## PRD Created

**File**: {{config.paths.prdsDir}}/{name}

**Product**: {name}
**Problem**: {one line}
**Solution**: {one line}
**Key metric**: {primary}
**Repos touched**: {roles}

### Summary
- {N} user stories · {N} in-scope capabilities · {N} phases

### Assumptions made
{list or "None"}

### Open questions ({count})
{list}

### Recommended next step
Run `stories {{config.paths.prdsDir}}/{name}` to break the PRD into issues (once open questions are resolved).
```

---

## Rules

- Keep the PRD product-oriented, not file-oriented — no brittle file paths or code dumps.
- Do not invent requirements. Mark assumptions clearly; use `TBD — needs research` for genuine gaps.
- Warm path: do not interview unless a missing decision materially changes the PRD.
- Cold path: do not double-interview — the interview subsumes any separate grilling step.
- Research informs but never overrides the project's stated posture and constraints.
