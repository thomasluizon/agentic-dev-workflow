# Second Opinion (cross-model)

> **Config inputs:** `config.secondOpinion.enabled`, `config.secondOpinion.model`

**Input**: a claim to test, optionally with a `file:line` to pull context from.

Ask a **different model** — run through the local `opencode` CLI (model
`{{config.secondOpinion.model}}`) — to independently judge one concrete claim. Two model
architectures fail in different ways: a second one disagreeing is real signal, an agreement is
corroboration. This is **on-demand cross-model diversity** reserved for high-stakes calls — not
standing consensus voting (the adversarial skeptic in the verification protocol already beats
that; bring the second model only when it pays).

## Operating rules

- **Interactive-only, degrades to a no-op.** `opencode` is a local CLI, absent from CI runners
  (and unfunded / rate-limited plans, and offline). Every one of those returns `UNAVAILABLE`
  and the skill **says so and moves on** — it never blocks, never invents a verdict, never
  treats "couldn't ask" as "disagreed." When the tool isn't there, the work still completes.
- **Never force a decision.** A second-opinion verdict is *input*, not a gate. It never
  auto-merges, auto-drops a finding, or overrides the primary judgement — it surfaces a second
  view for a human to weigh.
- **One claim per call.** Feed a single, self-contained finding + its code. The second model
  judges only from the text you send it — no repo access — so include the cited hunk.
- **Gated by config.** Runs only when `{{config.secondOpinion.enabled}}` is true. When false or
  the model slug is empty, this skill is a no-op and callers skip it.

## How it runs — the helper

The mechanics (invoke opencode, parse its JSONL event stream, extract the verdict, degrade on
any failure) live in a deterministic helper — `second-opinion.helper.mjs`, alongside this body
in the pack core — so nothing is left to per-run improvisation:

```bash
node <core>/review/second-opinion.helper.mjs --model {{config.secondOpinion.model}} <<'FINDING'
<the finding dossier: title · severity · repo/path:line · the claimed defect · the cited code/diff hunk>
FINDING
```

(`<core>` is where the pack vendored its core — e.g. `.claude/skills/_core` for Claude Code,
`.opencode/skills/_core` for opencode.) It reads the dossier from **stdin** (no argv length /
quoting limits — diffs are safe), prompts the second model as an independent skeptic, and prints
**one line of JSON** to stdout, always exiting 0:

| Field | Meaning |
|---|---|
| `status` | `OK` (a verdict was obtained) or `UNAVAILABLE` (opencode absent / capped / errored / unparseable) |
| `verdict` | `AGREE` · `DISAGREE` · `UNSURE` (only when `status: OK`) |
| `confidence` | `high` · `medium` · `low` |
| `reasoning` | ≤ 2 sentences citing the specific code |
| `reason` | why it degraded (only when `status: UNAVAILABLE`) |
| `model` | the slug used |

Options: `--model <slug>` (defaults to `{{config.secondOpinion.model}}`; swap only to a live
opencode slug), `--timeout <ms>` (default 180000). A verbose/slow model is backstopped by the
timeout, which yields `UNAVAILABLE`, never a hang.

## Interpreting the verdict

| Result | What it means | What to do |
|---|---|---|
| `OK` · **AGREE** | An independent model confirms the defect and the severity. | Corroborated — state that the finding is cross-model confirmed. |
| `OK` · **DISAGREE** | The second model argues the code is correct / the severity inflated / the claim unsupported. | Mark the finding **CONTESTED**; surface **both** verdicts and let the human decide. Do not silently drop it and do not force a merge. |
| `OK` · **UNSURE** | The context couldn't decide it. | Note it; the finding stands as the primary review ruled. |
| **UNAVAILABLE** | No second opinion was obtained. | Say so in one line (with the `reason`); the finding stands unchanged. Never read this as agreement or disagreement. |

## Standalone use

For a `second-opinion <claim>` invocation outside a review:

1. Build the dossier: the claim in one line, plus — if the input names a `file:line` or a
   snippet — read that context and include the relevant hunk so the model judges the real code.
2. Run the helper.
3. Report **your** read of the claim and the **second model's** verdict side by side. On
   `DISAGREE`, present both cases and recommend how to resolve; on `UNAVAILABLE`, answer from
   your own analysis and note the second opinion wasn't reachable.

## Inside `pr-review`

`pr-review` Phase 6 fires this on each **Critical** finding that survives the adversarial
skeptic (interactive runs only, gated by `{{config.secondOpinion.enabled}}`). The contract there
is identical: `DISAGREE` → the finding is tagged `CONTESTED` with both verdicts shown, the
recommendation is never forced, and `UNAVAILABLE` leaves the finding exactly as the skeptic left
it.
