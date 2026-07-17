# Feature: idea → PRD → stories (gated)

> **Config inputs:** `config.issueTracker.repo`

Drive a rough idea through the full backlog pipeline until it becomes well-formed tracker issues, without hand-running each step. This is a **thin orchestrator**: it does NOT reimplement PRD writing or story slicing. It chains the already-shipped flows by name — `grill`, `prd`, `stories` — and inserts one hard confirmation gate of its own at the PRD→stories boundary. The second gate (before issues are created) is `stories`' OWN existing gate; reuse it, never duplicate it.

The pipeline ends at the report. It *suggests* the per-issue `prime → plan → implement` loop but never runs it.

**Usage**: `feature "<idea>" [--cold] [--milestone "<name>"] [--no-create]`

- `--cold` — force the full `prd` interview instead of warm synthesis. Also the route when `<idea>` is empty.
- `--milestone "<name>"` — pass-through to `stories`.
- `--no-create` — pass-through to `stories`; writes the local stories file only, skips issue creation. The dry/abort path for the issue side.

---

## Stage 0 — Input & flag parse

The args hold the idea string plus optional flags. Strip the flags; the remainder is the idea. Branch once, then do NOT run the other path:

| Condition | Route |
|---|---|
| `--cold` present, OR idea string is empty | **Cold path** — skip Stage 1; hand straight to the `prd` interview (Stage 2). |
| Idea is non-empty and no `--cold` | **Warm path** — run Stage 1 grill, then warm `prd` synthesis (Stage 2). |

Hold `--milestone` and `--no-create` to forward to `stories` in Stage 3.

---

## Stage 1 — Grill (clarifying questions) [warm path only]

Invoke the `grill` skill — it owns all grilling mechanics (batching, recommended answers, and researching the codebase instead of asking); do not restate or override them. Grill the load-bearing PRODUCT branches, and write no artifact during this stage. (The resolved decisions are captured durably by Stage 2's `prd`, which synthesizes them into the PRD file — so no separate paper trail is needed here.)

Stop when these are pinned: **scope** (in / out), **platforms/repos** (which of `{{config.issueTracker.repo}}`'s surfaces and which repo roles), **API & data surface** (endpoints, shapes, migrations, or "none"), and **out-of-scope**. This warms the conversation so the PRD step has real material — it is not busywork.

**No double-grill on the cold path.** When routing cold, this stage is subsumed by the `prd` interview's own questions. Skip Stage 1 entirely.

---

## Stage 2 — PRD

Derive a kebab-case name from the idea (e.g. "pin an item to the top of the list" → `pin-item-top`).

- **Warm path (default)** — run `prd <kebab-name>` (warm mode). Its argument is the output filename; it synthesizes from the now-warm conversation, writes the PRD, and emits its digest (product / problem / solution / story count / repos).
- **Cold path (`--cold` or empty idea)** — run `prd "<idea>" --cold`. It runs its own interview, derives its own filename, writes the PRD, and emits its summary. **Read the path back from that summary** before Stage 3 rather than assuming it.

Do not reimplement PRD content — the chained flow owns the template and the file write; `feature` only routes and passes the filename.

---

## GATE 1 — Confirm PRD (HARD, owned here)

After the PRD file exists, surface its path and a short digest reusing what the `prd` flow already emitted (problem line, solution line, story count, repos touched, open-questions count). Then **STOP and wait** for an explicit reply:

> PRD written to `<path>`. Proceed to break it into stories? Reply:
> `yes` to continue · `edit <notes>` to revise the PRD · `abort` to stop here.

Branches:

- **`yes`** → proceed to Stage 3.
- **`edit <notes>`** → loop back into the SAME `prd` flow with the notes to revise the file in place (same path, no new file), then re-hit GATE 1.
- **`abort`** → stop. Report the PRD path so the dev can resume later. Create no stories, no issues.

Nothing downstream runs until `yes`. This gate is what prevents stories/issues from being generated off an unconfirmed PRD.

---

## Stage 3 — Stories

Run `stories <prd-path>`, forwarding `--milestone "<name>"` and/or `--no-create` if they were passed. It writes the local stories file and then proceeds to its own creation gate.

Do not reimplement story slicing, the labels, or the issue-body template — they live in `stories`.

---

## GATE 2 — Confirm before issues are created (HARD, reused)

Do **not** add a second bespoke prompt. `stories` already halts with:

> About to create {N} issues in `{{config.issueTracker.repo}}`. Confirm?

Let that gate fire and let the dev answer it. `feature` must NOT auto-answer it, pre-confirm it, or suppress it.

- If `--no-create` was passed (or the tracker host is `none`), `stories` skips creation — report that no issues were created and how to create them later.
- The abort path here is the dev declining that prompt; `stories` then stops and `feature` reports the local stories file path.

---

## Report

Final compact summary:

- **PRD**: the PRD path.
- **Stories file**: the local stories file path.
- **Issues**: the created issue numbers/URLs (from `stories`), or "no issues created (`--no-create` / declined)".
- **Next step** (suggest, do not run): pick an issue → `prime <n>` → `plan <n>` → `implement`.

---

## Guardrails — do NOT

- Reimplement PRD writing or story slicing — chain `prd` / `stories` by name; they own the templates, labels, and issue bodies.
- Skip or weaken either gate. GATE 1 (PRD→stories) is owned here; GATE 2 (issue creation) is reused from `stories` — never re-spell it or auto-answer it.
- Create issues off an unconfirmed PRD, or run anything past GATE 1 before an explicit `yes`.
- Write any file except through the chained flows.
- Double-grill: on the cold path, Stage 1 is skipped — the `prd` interview does the questioning.
- Run the per-issue `plan`/`implement` loop — the skill ends at the report and only suggests it.
