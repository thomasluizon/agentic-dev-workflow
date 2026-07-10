# Dual-target hook engine

Every enforceable invariant is written **once**, tool-neutrally, and enforced in
**both** Claude Code and opencode off that one shared logic core. Fix a rule in
one place; both tools inherit it. No project SDLC is a constant anywhere in here
— branch grammar, protected branches, banned phrases, forbidden trailers, ticket
formats all arrive from `hooks.policy.json` at runtime, which is why the
genericity gate can guarantee zero leakage.

```
core/hooks/
  logic/            ← the shared, pure, runtime-agnostic invariant checks
    git-action.mjs      evaluateGitCommand(command, policy, ctx)
    content-scan.mjs    scanContent(text, policy, filePath) + checkLargeBinary
    proactivity.mjs     reminder line + judge-prompt builder + verdict parse + transcript slice
    payload.mjs         normalize a Claude Code OR opencode payload -> one neutral record
    scope.mjs           glob -> RegExp + path-scope/exception matching (dependency-free)
    config.mjs          loadPolicy(startDir): DEFAULT_POLICY < global < project (JSON only)
  templates.mjs     ← the parameterized template library (the enforceable invariants)
  lint-generators/  ← code-level policies -> a real ESLint/Roslyn/ruff rule (strongest layer)

adapters/claude-code/hooks/   ← AUTHORED thin shells: read stdin -> logic -> exit 2 / block
adapters/opencode/plugin/     ← AUTHORED thin plugin: tool.execute.before -> throw; session.idle guard
adapters/claude-code/workflows/audit.mjs  ← Workflow-tool audit accelerator (config-driven)
```

## The two adapters, one core

A **template** (e.g. "no push to a protected branch") maps to a `logic/` function
and to each tool's block mechanism:

| | Claude Code | opencode |
|---|---|---|
| Entry | `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop` hook (`.mjs`) | plugin `tool.execute.before` / `event` |
| Payload | JSON on stdin (`tool_input.command`, `file_path`, `new_string` …) | `(input, output)` (`input.tool`, `output.args`) |
| Normalize | `payload.fromClaudeCode` | `payload.fromOpenCode` |
| Block | `exit 2` + stderr (or `{decision:block}` for Stop) | `throw new Error(...)` (opencode aborts the tool) |
| Allow | `exit 0` | return without throwing |

Both adapters resolve `logic/` at runtime (probing the vendored `_core` path and,
for opencode, the project directory) so the same file works in the pack repo and
in an installed project regardless of any plugin bundling.

## Enforce at the strongest layer

- **git actions** (branch name, protected ref, ticket ref, no `--no-verify`, no
  forbidden trailer, large binaries) → a git-action hook. Deterministic and
  portable no matter how the command is invoked.
- **content** (em dash, banned phrases, secrets, large binaries) → a content hook
  on the text an edit introduces — but a **code-level** policy in a linted stack
  goes to a **real ESLint / Roslyn / ruff rule** instead (`lint-generators/`); the
  content hook is the fallback only where no linter can express it.
- **disposition** (verify/do over guess/ask/improvise) → the proactivity guard:
  a re-injected reminder each turn (Layer 1) plus a cheap-model turn review that
  can send the turn back (Layer 2, model-configurable; empty model disables it).

## Path scopes + exceptions

Every content/git template takes optional `scope: { include, exclude }`. A
carve-out (em dash allowed in `CHANGELOG.md`, branch rule exempts `hotfix/*`)
**narrows** a rule — it never disables the whole rule.

## Policy, not constants

`config.loadPolicy` layers `DEFAULT_POLICY` (only universally-safe defaults: block
the git bypass flags, protect `main`/`master`, scan for unambiguous secrets) under
a global `~/.claude/hooks.policy.json` under the nearest project `hooks.policy.json`.
setup-harness writes that file from the interview + `workflow.config.yaml`; the
hooks only `JSON.parse` it (no YAML dependency at runtime). See
`hooks.policy.example.json` for the full shape. A machine that BANS an authorship
trailer and one that REQUIRES it are one policy field apart — neither is assumed.

## Proof

`node scripts/test-hook-engine.mjs` vendors the pack into a temp project and runs
the real Claude Code hook **and** the real opencode plugin against simulated
payloads — a push to a protected branch is blocked by both, a feature-branch push
is allowed by both, an em dash in scoped copy is caught by both — proving the
dual-target wiring end to end over one logic core.
