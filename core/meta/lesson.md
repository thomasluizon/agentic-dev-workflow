# Lesson: capture a correction without bloating context

> **Config inputs:** `config.paths.workflowDir`

**Input**: the mistake or correction. If empty, infer it from the last correction in this
session.

## Why this exists

An auto-writer that appends "lessons" straight into loaded memory degrades over time
(instruction-budget dilution, contradictory rules, no measured win anywhere). The reliable
pattern is a GATED, GRADUATING loop: capture to a staging file, the user approves, and
anything machine-checkable graduates OUT of prose into a hook or lint/analyzer rule so it
costs zero instruction budget and cannot be forgotten.

This is measured, not a hunch: instruction adherence decays as context grows — roughly ~100%
at ~10 instructions down to ~69% at ~500 — and pure prohibitions decay worse than requirements
(~73% → ~20%). A "never do X" memory note is therefore the weakest possible form of a rule,
which is exactly WHY a machine-checkable lesson should graduate out of prose into a
deterministic gate (a hook or a lint/analyzer rule) that a growing context cannot erode.

## Trigger

Only capture on a genuine signal: the user explicitly corrected you, OR the same mistake has
recurred (3+ times). Do NOT capture on every turn.

## Steps

1. **Name the lesson** in one line: what went wrong and the correct behavior, plus the
   trigger context (which files/task it applies to).
2. **Classify it:**
   - **Machine-checkable** (a banned API/token/literal, a required command, a format) → it
     should become a HOOK or a LINT/analyzer rule, not a memory note. A hook is written once
     as shared logic and enforced dual-target (a Claude Code command hook AND an opencode
     plugin) so it holds no matter which tool runs. Draft the rule.
   - **Judgment** (an approach, a preference, a gotcha) → it becomes a concise, path-scoped
     rule (`.claude/rules/<topic>.md`) or a short project-facts note.
3. **Append a candidate to the staging file** `{{config.paths.workflowDir}}/pending-lessons.md`
   (create if missing) — NEVER write directly into a loaded convention doc or rule. Format:
   ```
   ## <date> — <one-line lesson>
   - Trigger: <files/task where it applies>
   - Type: checkable | judgment
   - Proposed home: <hook name / lint rule / path-scoped rule / project-facts note>
   - Draft: <the rule text, or the hook/lint sketch>
   ```
4. **Tell the user it is staged** and ask whether to promote it now. Do not promote unattended.

## On promotion (only after the user approves)

- **Checkable** → implement the gate: a dual-target hook (shared logic → Claude Code hook +
  opencode plugin) or a lint/analyzer rule; verify it with a piped-input test; then delete the
  staging entry. The lesson now lives as a gate.
- **Judgment** → add a concise entry to the right scoped `.claude/rules/<topic>.md` (with
  `paths:` if file-specific) or a project-facts note, then delete the staging entry.

## Housekeeping

Periodically (or when asked), review `{{config.paths.workflowDir}}/pending-lessons.md`: merge
duplicates, delete stale/contradicted entries, and graduate any checkable rule still living as
prose.
