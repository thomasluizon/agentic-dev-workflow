# Update Harness: web-grounded monthly staleness audit

> **Machinery (ships beside this body in `meta/`):** `staleness.mjs` (model-pin scan · overlay-behind-CORE compare · the update clock + due math)
> **Produces:** a GATED staleness proposal, and — on approval — fixes to THIS machine's install plus, for any CORE drift, a proposed upstream change to the pack repo. Records the run so the monthly clock resets.

**Input**: run anywhere; it audits the installed harness in `~/.claude` (honoring `CLAUDE_CONFIG_DIR`). Flags: `--since <iso>` (audit as if last checked then), `--core-only` (skip local overlay, only check the pack's CORE).

This is the **proactive** maintenance counterpart to `/setup-harness`. Re-running `/setup-harness` is *reactive* — you know a doc or process changed and you bring it. `/update-harness` is *proactive* — it discovers drift you don't know about: a model pin a newer release superseded, a deprecated flag or tool, a drifted file/version reference, an install that has fallen behind the pack's CORE, and new Claude Code / opencode capabilities worth adopting. It **proposes behind a gate**; you approve; it applies.

## Operating rules

- **Web-grounded or it doesn't ship. (HARD REQUIREMENT.)** Every "X is stale" claim MUST cite a **live web source** fetched this run — the model roster / release notes for a model pin, vendor docs for a deprecated API/flag/tool, the pack's own history for behind-CORE. **Never call something stale from memory.** No live citation → the candidate is *dropped*, not flagged. The proposal lists a source URL on every row; a row without one is a bug.
- **Never mutate before the gate.** The scan + web research are read-only. Nothing on this machine or in the pack changes until you approve the proposal table.
- **Never block.** A dead doc URL, an offline roster, an unreachable pack remote → skip that dimension, flag it, and continue. The audit always completes with a gaps report.
- **Fix local, flag CORE.** A stale value in a *generated overlay* (this project's `CLAUDE.md`/rules/config) is fixed here. A stale value in a **CORE** skill body (ships to every machine) is *also* emitted as a proposed upstream change to the pack — fixing it locally alone would be silently reverted by the next `bootstrap`.
- **Monthly cadence.** This is a once-a-month pass, not per-session. Phase 0 checks the clock; the run resets it. Wire a real recurring reminder (Phase 6) so the month doesn't slip.

## Phase 0 — Locate the machinery + clock check

Find the `meta/` directory that ships beside this body (the pack's `core/meta/`, its vendored `_core/meta/` copy in an installed project, or the global `~/.claude/skills/_core/meta/` a bootstrap placed). Call it `META_DIR`; the helper is `node "<META_DIR>/staleness.mjs"`. Resolve the global config dir (`CLAUDE_CONFIG_DIR` or `~/.claude`); call it `CLAUDE_DIR`.

```
node "<META_DIR>/staleness.mjs" due --dir <CLAUDE_DIR>
```

Reports `{ due, lastCheckedAt, nextDueAt, intervalDays }`. If `due` is false and the user didn't force the run, say when the next check is due and stop. Otherwise continue.

## Phase 1 — Inventory the installed harness

Collect the auditable surface and the recorded install fingerprint:

```
node "<META_DIR>/staleness.mjs" scan --dir <CLAUDE_DIR>
```

Returns every **model-pin candidate** as `{ file, line, model, context }` — a vendor-prefixed model id (Claude / GPT / Gemini / GLM / …) found in a skill body, a rule, `workflow.config.yaml`, or `hooks.policy.json`, with its exact location. These are *candidates only*; Phase 3 verifies each against the live roster before flagging. (Scanning `<CLAUDE_DIR>` already reaches any repo-clean store under `~/.claude/harness`.)

**Store-aware — repo-clean projects.** A repo-clean project's overlay lives OUTSIDE its repo, in the out-of-repo store keyed by git root, so scan those entries explicitly for labeled per-project citations:

```
node "<META_DIR>/staleness.mjs" scan-store
```

Returns the same candidates, each `file` prefixed with `harness/projects/<slug>/…` so a stale pin cites which project's store it is in. When you fix one in Phase 5, edit the file in that store entry (and re-apply with `node scripts/sync.mjs --into <project>`, which for a repo-clean project targets the store).

Also read `~/.claude/harness.bootstrap.json` for the install's recorded `coreHash` and `packRef` (what the last `bootstrap` installed), and note the tool versions the machine reports (Claude Code / opencode `--version`) for the capability check.

## Phase 2 — Overlay-behind-CORE

Is this machine's install behind the pack? Refresh a clone of the pack (`agentic-dev-workflow`) to its latest default branch, recompute its CORE hash the same way `bootstrap` does, and compare against the install's recorded `coreHash`:

```
# in a fresh/updated pack clone:
node -e "import('./scripts/install.mjs').then(m => console.log(m.hashTree('core')))"
```

Feed the two hashes to `overlayBehindCore(installedCoreHash, currentCoreHash)` (from `staleness.mjs`). `behind: true` means `bootstrap` would install newer CORE — surface it as a proposal row ("re-run `node bootstrap.mjs`"), citing the pack commits between `packRef` and the clone's HEAD as the live source. If the remote is unreachable, skip and flag.

## Phase 3 — Web-grounded staleness research (the heart)

For each candidate, **fetch the authoritative live source and decide from it** — never from memory. Attach the URL to every kept row; drop anything you can't corroborate.

- **Model pins.** For each distinct model from Phase 1, check the vendor's live model roster / deprecation notes (WebSearch the current roster, WebFetch the vendor's models/deprecations doc). Flag only a pin the live source shows **retired or superseded**, and propose the current replacement the source names. A pin the roster still lists is *fine* — don't churn it.
- **Deprecated APIs / flags / tools.** For any tool flag, CLI invocation, SDK call, or MCP the harness leans on, check the vendor's current docs / release notes. Flag the ones the live docs mark deprecated/removed, with the doc URL and the current equivalent.
- **Drifted file/version references.** A skill or rule that references a file path, a pinned dependency version, or an external URL — verify it still resolves. Flag dead references with what they should point at now.
- **New capabilities worth adopting.** Skim the current Claude Code + opencode release notes / changelog for capabilities the harness could use (a new hook event, a skill mechanism, a plugin API). Propose adoptions as *optional* rows, each with the release-note URL.

Keep the pass proportional: a handful of well-sourced, high-signal rows beats a long list of speculative ones. If a dimension's source is down, flag "retry next month" rather than guessing.

## Phase 4 — The gated proposal

Present ONE proposal table. Nothing has changed yet.

| # | Finding | Evidence (live URL) | Scope | Proposed fix | Apply? |
|---|---|---|---|---|---|
| 1 | `<model>` pinned in `<file:line>` is superseded by `<new>` | `<roster/deprecation URL>` | LOCAL / CORE | swap the pin | ☐ |
| 2 | `<flag/tool>` deprecated | `<vendor doc URL>` | LOCAL / CORE | use `<replacement>` | ☐ |
| 3 | install behind CORE (`<packRef>`→`<head>`) | `<pack compare URL>` | CORE | re-run `bootstrap` | ☐ |
| 4 | new capability: `<X>` | `<release-note URL>` | CORE | adopt in `<skill>` | ☐ |

- **Scope LOCAL** = the drift is in a generated overlay on this machine → fixed here on approval.
- **Scope CORE** = the drift is in a portable CORE skill/config → fixed here (if installed) **and** emitted as an upstream change to the pack, since the next `bootstrap` would otherwise overwrite a local-only edit.
- Every row carries a live URL. A row without one was dropped in Phase 3 — it never reaches this table.

The user checks the rows to apply (or edits the fix), then says **go**. Default is propose-only; apply nothing unapproved.

## Phase 5 — Apply (after approval)

For each approved row:

- **LOCAL** — edit the generated artifact in place (the pinned model in a rule, the deprecated flag in a specialized skill, the drifted reference). If the project carries a manifest, treat these as AI-managed refreshes; a hand-edited file still asks before being changed.
- **behind-CORE** — run `node bootstrap.mjs` from the refreshed pack clone to reinstall the newer CORE globally (it updates in place and prunes what the pack dropped).
- **CORE drift** — in the pack clone, create a branch off the default branch, make the fix in `core/**` (the single source of truth), run the pack's gates (`check-genericity` + the `test-*` proofs), and open a pull request against the pack repo via your git host's PR tooling — so every machine gets the fix on its next update, not just this one. Link the live evidence URL in the PR body.

## Phase 6 — Record the run + keep the reminder honest

Reset the monthly clock:

```
node "<META_DIR>/staleness.mjs" record --dir <CLAUDE_DIR>
```

The clock lives in `~/.claude/harness.update.json` (`{ installedAt, lastCheckedAt, intervalDays }`). `bootstrap` seeds it at install; this run resets `lastCheckedAt`. For a **hard** monthly reminder that doesn't depend on remembering, wire a recurring trigger once (dep-sweep style) — pick the one that fits the machine:

- **macOS/Linux cron** — `0 9 1 * *` → a script that opens the tool and nudges "run /update-harness".
- **Windows Task Scheduler** — a monthly task that surfaces the same nudge.
- **CI cron** — a scheduled job in a repo you check often that opens a reminder issue/PR via your configured tracker.

Then print the completion summary:

```
## Harness update — complete

- **Audited**: {N} model pins · {M} tool/flag refs · overlay-behind-CORE {yes/no}
- **Flagged (web-sourced)**: {F} findings — {local} local · {core} CORE
- **Applied**: {A} local fix(es){; bootstrap re-run if behind}; {C} CORE change(s) proposed upstream (PR {link})
- **Deferred / gaps**: {offline roster, dead link, source to retry} …
- **Next check due**: {nextDueAt} — reminder wired: {cron/task/CI or "manual"}
```
