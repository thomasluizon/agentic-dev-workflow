# Audit Security

> **Config inputs:** `config.repos`, `config.auditAnchors.scale`, `config.auditAnchors.securityTiersInScope`, `config.review.frameworkTokens`, `config.review.backendHardRules`, `config.execution.maxParallelSubagents`, `config.execution.hasNamedAgentRegistry`

**Input**: a path, a repo name, or blank (all repos in `{{config.repos}}`).

Run a repo-wide security audit across the repos in `{{config.repos}}` and produce one
severity-ranked, evidence-backed report of real risks — each finding pinned to a `file:line`,
with the threat it enables and the fix that closes it.

**Golden rule**: every finding is a *concrete, exploitable-or-not* claim tied to a `file:line`
and a threat, calibrated to the project's actual scale (`{{config.auditAnchors.scale}}`). No
theater — a finding either names how an attacker (or a buggy client, or another user) reaches
it, or it isn't a finding. **Right-size to the tiers below**; do not paste enterprise checklists
a small, pre-scale app will never hit.

---

## Phase 0 — Tiers, scale & self-containment

**Self-contained**: no network call at run time, no marketplace dependency, no live scanner. It
reads local repo files and runs `git` / `rg` against the project's own checkout — so it works
unchanged in CI.

### Severity tiers — calibrate every finding

Calibrate to `{{config.auditAnchors.scale}}`. Audit only the tiers listed in
`{{config.auditAnchors.securityTiersInScope}}`; mark tiers outside that set explicitly
out-of-scope so the report stays decision-ready, not a fear list.

| Tier | What it covers | In scope? |
|---|---|---|
| **Tier 1 — Must fix** | Cross-user data access, auth bypass, secret leakage, injection, an AI/agent tool that mutates another user's data, payment/webhook forgery. Exploitable now, real blast radius. | If `1 ∈ {{config.auditAnchors.securityTiersInScope}}` → **block on these.** |
| **Tier 2 — Should fix** | Missing rate-limit on an abusable/expensive route (auth, AI), verbose error leakage, defense-in-depth gaps, missing input validation at a boundary, permissive CORS not yet exploitable. | If `2 ∈ {{config.auditAnchors.securityTiersInScope}}` → **fix before/at launch.** |
| **Tier 3 — Enterprise / not-yet** | WAF, SIEM, pen-test cadence, secrets-vault rotation, DDoS scrubbing, SOC2 controls, threat-intel feeds. Real at scale, noise for a small pre-launch app. | Usually **out of scope** — list under "out of scope (Tier 3)" and move on. |

When old-client reach or real-world exploitability is uncertain, say so and pick the lower tier
with a "verify" note — never inflate to look thorough.

---

## Phase 1 — Resolve scope & load context

Parse the input: blank → **all repos in `{{config.repos}}`**; a repo name / role → that repo; a
path → just that path.

Load in parallel: **`audit-security.checklist.md`** (this skill's category list — read it
first), the project's security-boundary conventions docs, `{{config.review.backendHardRules}}`
(if a backend repo is in scope), and **`_shared/verification-protocol.md`** (the shared
reliability contract — its Verify phase and Deferred ledger run below). Exclude generated /
vendored dirs (dependency dirs, build output, generated migrations, vendored design assets).

---

## Phase 2 — Fan out by attack surface

Delegate to subagents, respecting `{{config.execution.maxParallelSubagents}}` (default 3
concurrent), each owning one non-overlapping surface and returning findings in the template
below. Map to where the project's risk actually concentrates, using
`{{config.review.frameworkTokens}}` to locate the relevant call sites:

| Surface | Where to look | Checklist sections |
|---|---|---|
| AuthZ & data-isolation | backend controllers + handlers — every handler must scope its query by the authenticated principal | A |
| AI / agent-tool scoping (if present) | the agent/tool handlers — confirm each resolves the caller's principal and cannot touch another user's rows | A, F |
| Injection | raw/interpolated SQL or ORM, raw-HTML sinks, process spawning, path building from user input | B |
| Secrets & config | hardcoded keys/secrets/connection strings; env-shaped values in source; debug flags; security headers/CORS at startup | C, D |
| Rate-limit & abuse | coverage on auth, password-reset, and AI/expensive endpoints; request-size limits; prompt-injection / unbounded-cost paths | E, F |
| Error leakage & client auth | stack traces / DB schema in responses; cookie flags; native token storage | G, H |

Each subagent prompt embeds:

> **Objective**: audit `<surface>` in `<repo>` against `audit-security.checklist.md` sections
> `<list>`. **Read the checklist first.** For every issue emit the finding template with an exact
> `file:line`, a tier, the **threat** (who reaches it and what they get), and a concrete **fix**.
> Prove cross-user-access risk by showing the query is *not* scoped to the caller's principal
> (cite the line). Skip out-of-scope-tier enterprise controls — note them once. Findings only, no
> padding.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, walk the surfaces **serially in one thread** —
same checklist, same rigor, no concurrency.

---

## Phase 3 — The must-checks (do not skip)

These are where an app with user data, AI tools, and billing actually bleeds — verify each
explicitly even if a subagent didn't surface it:

1. **Every data query is user-scoped.** Each handler filters by the authenticated principal
   (from the verified token, never from a client-controlled request field). A handler that loads
   by `id` with no ownership check is a **Tier 1 IDOR**.
2. **AI / agent tools cannot cross users** (if the project has them). Tools run *on behalf of*
   the authenticated user; confirm the tool layer derives the principal from the session and no
   tool accepts a target-user parameter. A tool mutating by raw id without ownership scoping is
   **Tier 1**.
3. **AI-abuse / prompt-injection** (if applicable). Is the AI endpoint rate-limited and
   size-capped? Can a crafted prompt make a tool act outside the user's own data or run an
   unbounded-cost loop? Model output must not *authorize* — authorization stays server-side.
4. **Authorization by default.** Every new endpoint requires authentication unless it is an
   explicit public route. An endpoint with neither the auth attribute nor an explicit anonymous
   marker is a **Tier 1** hole.
5. **Payment & webhook integrity** (if the project takes payments). Webhook handlers verify their
   signature; the payment SDK key is set once at startup, never per-request. An unverified webhook
   = forged subscription state (**Tier 1**).
6. **Secrets never in source.** No signing secret, DB password, third-party key, or private key
   committed. Config comes from env. A committed secret is **Tier 1**.
7. **Boundary flags intact.** Web auth cookie httpOnly + sameSite strict + secure; native tokens
   in the secure store; CORS not allow-any-origin with credentials; security-headers middleware
   not disabled.

---

## Phase 4 — Verify (adversarial + completeness)

Before writing the report, run `_shared/verification-protocol.md` — a finding ships only after
it survives a challenge, and the sweep must prove it covered the ground.

1. **Adversarial pass (§2).** For every in-scope-tier finding, spawn an independent skeptic
   subagent whose only job is to *refute* it — read the cited `file:line` in full context and
   argue it is a false positive (the query is actually principal-scoped, the route unreachable,
   the input already validated, a duplicate, the tier inflated). Default to refuted when
   uncertain. Drop or downgrade anything the skeptic disproves; survivors ship with confidence.
   Respect `{{config.execution.maxParallelSubagents}}`.
2. **Completeness critic + loop-until-dry (§3).** Run a fresh critic asking *"what did this audit
   NOT examine — an attack surface never swept, a handler skipped, an ownership claim
   unverified?"* Spawn a focused finder round on each gap it names; repeat until a round surfaces
   nothing new (cap: 2 dry rounds — log it).
3. **Deferred ledger (§4).** Roll everything in scope but un-verdicted (a surface left unswept, a
   repo not checked out in CI, out-of-scope tiers) into the report's **Deferred** section, one
   reason each — never implied as clean.

**Sequential fallback.** When `{{config.execution.hasNamedAgentRegistry}}` is false or
`{{config.execution.maxParallelSubagents}}` ≤ 1, run the skeptic passes and the completeness/loop
rounds **serially in the main thread** — the challenge and the loop are what matter, not the
concurrency.

---

## Phase 5 — Report

**Output path**: `{{config.paths.auditsDir}}/security-{scope}.md` (create the dir if absent).

```markdown
# Security Audit: {SCOPE}

**Scope**: {all repos / repo / path}
**Calibration**: tiers {{config.auditAnchors.securityTiersInScope}} in scope; other tiers listed as out-of-scope. Scale: {{config.auditAnchors.scale}}.
**Posture**: {1-line verdict}

## Findings

### Tier 1 — Must fix (exploitable now)
{findings in the template, or "None"}

### Tier 2 — Should fix (before/at launch)
{… or "None"}

## Out of scope (Tier 3 — enterprise, not yet)
{one line each: WAF, secrets-vault rotation, SIEM, … — acknowledged, deliberately deferred}

## Surface coverage

| Surface | Audited | Result |
|---|---|---|
| AuthZ & data-isolation | yes/no | clean / N findings |
| AI / agent-tool scoping | yes/no/N/A | … |
| Injection | yes/no | … |
| Secrets & config | yes/no | … |
| Rate-limit & abuse | yes/no | … |
| Error leakage & client auth | yes/no | … |

## Deferred — in scope but not verdicted

{Per verification protocol §4: any surface the sweep did not reach with a verdict, a repo not
checked out in CI, capped coverage — each with a one-line reason. "Nothing deferred — full
coverage" if the contract was met. (Tier-3 controls stay in their section above.)}

## What's solid

{Genuine strengths — controls done right. Not filler.}
```

### Finding template

```
[TIER N] <one-line title>
· category: <checklist section — e.g. A. AuthZ / data-isolation>
· location: <repo>/<path>:<line>
· threat: <who reaches it (other user / anon / forged webhook / crafted prompt) and what they get>
· evidence: <the line that proves it — e.g. "query loads entity by id with no principal filter">
· fix: <the concrete change>
· reference: <security boundary | backend hard rule | OWASP A0x | checklist section>
```

---

## Guardrails — do NOT

- **Inflate severity.** Tier-1 means *exploitable now with real blast radius*. Uncertain
  exploitability → lower tier + a "verify" note.
- **Paste enterprise checklists.** Out-of-scope-tier controls get one acknowledging line in "out
  of scope," not a finding each. Right-size to `{{config.auditAnchors.scale}}`.
- **Report a finding with no threat.** If you can't name who reaches it and what they get, it's
  an observation, not a security finding.
- **Trust the model for authz.** Flag any path where an AI tool's output decides access.
- **Guess at unscoped queries.** Cite the exact line where the principal filter is missing.
- **Remediate during the audit.** Findings first; fix only if the user asks after.
- **Audit generated / vendored code.**

---

## Output

```markdown
## Audit Complete — Security

**Scope**: {what was audited}
**Posture**: {1-line verdict}

| Tier | Count |
|---|---|
| Tier 1 (must fix) | {N} |
| Tier 2 (should fix) | {N} |
| Tier 3 (out of scope) | {acknowledged, not counted} |

**Report**: `{{config.paths.auditsDir}}/security-{scope}.md`
**Top risk**: {the single highest-priority thing to fix first, or "no Tier-1 findings"}
```
