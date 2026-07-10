# setup-harness machinery

The dependency-free Node modules that `setup-harness.md` drives to *research the
machine*, *interview for what it can't see*, *decode every rule to its tier*, and
— behind an approval gate — *generate a tailored harness*. The runbook (the skill
body) is the AI-facing procedure; these are the deterministic parts it calls so
detection, tiering, generation, and verification are exact, not guessed. Phases
0–5 are **read-only**; nothing enforcing is written until the user approves the
decomposition (phase 8).

```
core/setup/
  setup-harness.md   ← the gated runbook (research → interview → decode → gate → generate → verify)

  --- interview half (read-only) ---
  detect.mjs         ← OS/shell, installed CLIs (which/where + safe --version), git remotes+host,
                       CI configs, convention docs, MCP servers (~/.claude.json), inferred commands
  commands.mjs       ← infer test/lint/typecheck/build from package.json / *.csproj / pyproject.toml /
                       Makefile — each with its source, evidence, and confidence (never executed)
  discovery.mjs      ← current repo + workspace members (npm/pnpm/.sln) + a bounded projects-root scan
  questions.mjs      ← the fixed core question set (section F) + express subset + resume + adaptive
                       follow-ups (activeFollowups fires only what detection/prior answers make relevant)
  answers.mjs        ← harness.answers.yaml read/write/merge, incremental + resumable; a tiny scoped
                       YAML emitter/parser pair (the pack has no YAML dependency)
  trackers.mjs       ← per-tracker best-tool driver: resolve GitHub→gh / Jira→MCP-or-CLI / Linear→MCP…
                       by availability, not a blanket MCP-first rule
  docs.mjs           ← classify doc pointers (explicit link vs taught source) + extract every normative
                       statement ("must/never/always/required", hard vs soft) from fetched text

  --- generate half (gated) ---
  decode.mjs         ← classify EVERY rule/statement to its tier (HOOK/LINT/RULE/FACT/SKILL) + flag
                       conflicts inline (always-ask precedence, nothing auto-resolved)
  gate.mjs           ← render the ONE editable decomposition table (harness.decomposition.md), parse
                       the user's edits back, apply them, and report unresolved conflicts
  generate.mjs       ← build every artifact from the approved rows: hooks.policy.json, workflow.config.yaml,
                       CLAUDE.md, rules, lint scaffolds (strongest layer), machine-specialized/new skills
  adopt.mjs          ← adopt-vs-reset: back up an existing CLAUDE.md/hooks/rules to a timestamped folder,
                       then decompose the old prose into decode candidates (nothing lost)
  manifest.mjs       ← the versioned harness.manifest.json — each artifact traced to its answers rows +
                       hashed, so a re-run/sync preserves hand-edits (detectHandEdits)
  verify.mjs         ← post-generation self-verify: config/policy parse, skills load, and a guardrail
                       dry-run (a protected-branch push must BLOCK) + a gaps report; never throws
```

## What each phase produces

`setup-harness` runs these in order, recording to `harness.answers.yaml` and then
generating from it:

1. **Research** (`detect.mjs` + `commands.mjs`) → a machine profile; inferred commands shown for confirm.
2. **Discover** (`discovery.mjs`) → the confirmed repo set (current + workspace + siblings).
3. **Interview** (`questions.mjs` + `answers.mjs`) → each core question + its active follow-ups, written incrementally.
4. **Docs** (`docs.mjs`) → normative statements extracted from fetched policy docs, deduped and tagged.
5. **Tracker** (`trackers.mjs`) → the best available tool for the chosen tracker.
6. **Adopt** (`adopt.mjs`, if an existing setup) → backup + old prose decomposed into decode candidates.
7. **Decode** (`decode.mjs`) → every rule tiered; conflicts flagged.
8. **Gate** (`gate.mjs`) → the editable decomposition table; user edits + approves.
9. **Generate** (`generate.mjs` + `manifest.mjs`) → the artifacts + the versioned manifest.
10. **Verify** (`verify.mjs`) → parse + load + guardrail dry-run + gaps report.

## The gate is load-bearing

Nothing enforcing — no `CLAUDE.md`, rule, hook, or `hooks.policy.json` — is written
before phase 8. The decode step proposes; the user edits `harness.decomposition.md`
and says "go"; only then does generate run. Precedence on any conflict is
**always-ask** — the gate flags every disagreement and refuses to proceed while one
is unsettled.

## Genericity + proof

Everything here lives under `core/`, so `scripts/check-genericity.mjs` guarantees
no project string or baked SDLC policy leaks in — the decode classifier keys on
generic tokens (never the literal trailer string), a tracker's CLI verbs are held as
argument arrays, policy questions are neutral (required / banned / none are equal
options). `node scripts/test-setup.mjs` proves the interview half; `node
scripts/test-generate.mjs` proves the generate half — the worked-example acceptance
table (each free-form rule → its tier), conflict flagging, the gate round-trip, the
generators, adopt, the manifest, and the self-verify guardrail dry-run. CI gates on
both.
