# Review Rubric (example — copy and customize)

> **Config inputs:** `config.review.rubricPath` (this file is the default the pack ships; point that key at your customized copy), `config.review.backendHardRules`, `config.review.frameworkTokens`, `config.parity.enabled`, `config.parity.mirrors`, `config.i18n.locales`, `config.i18n.paths`, `config.i18n.doNotTranslate`, `config.contract.enabled`, `config.contract.clientTypesGlob`, `config.contract.serverTypesGlob`, `config.contract.backwardCompat`

This is the single source of truth for **what** a review checks, shared verbatim by two
skills: `pr-review` walks it dimension-by-dimension over a **diff**, and
`audit-code-quality` walks it over the **whole repo**. Both read this one file (the copy at
`{{config.review.rubricPath}}`) — there is no second copy, so the two can never drift. It is
command-agnostic on purpose: it contains **dimensions, severities, and templates** — no
orchestration, no scope resolution, no PR mechanics. Those live in the consuming skill.

**This is an EXAMPLE you copy and customize.** Ships as
`core/review/pr-review.rubric.example.md`; copy it to the path named by
`{{config.review.rubricPath}}` and adapt the generic dimensions to your project's real
standards (your conventions docs, your lint rules, your design canon). The four
**config-conditional** dimensions (9 parity, 10 i18n, 11 contract/backward-compat, 13
backend hard rules) stay in the rubric but only activate when your config declares them —
each is marked below.

Every finding cites the rule it came from (a project code-standard rule, a lint rule, a
design-canon line, a backend hard rule, or a security category) so the author can trace it
back. Tag every finding with a severity from the ladder at the bottom.

---

## Severity ladder

One vocabulary for every dimension. A finding's severity is about blast radius, not which
dimension raised it.

| Severity | Meaning | Action |
|---|---|---|
| **Critical** | Exploitable, data loss, crash, broken contract, or **breaks an already-shipped client**. | Block merge. Fix now. |
| **High** | Type-safety hole, missing error handling, missing parity, missing validation, dead code that ships. | Fix before merge. |
| **Medium** | Pattern inconsistency, missing edge case, missing test, defense-in-depth gap. | Fix soon; OK to merge with a tracked follow-up. |
| **Low** | Style deviation, minor naming, micro-cleanup. | Address when convenient. |
| **Info** | Observation, forward-compatible note, praise. | No action required. |

### The `⚠️ breaks already-shipped clients` marker

A **Critical-class** marker, separate from the severity word, applied to any finding where a
shared/client-side schema or a server-side DTO change makes an **already-installed** client
misbehave. This matters only when `{{config.contract.enabled}}` is true and the project ships
a client that lags the server (e.g. a mobile app updated through an app store) — such a client
runs a **frozen snapshot** of the shared contract, so a server-side or shared rename is
invisible to it; it keeps using the old field name and silently breaks. Detection and
classification are defined in the **Contract drift + backward-compat guard** dimension below.
Any finding carrying this marker is Critical regardless of how small the diff looks. When the
contract dimension is off in config, this marker is inactive.

---

## Signal gate — post high-signal only

The review CONVERGES; it is not a nit machine. What gets posted is gated by severity:

- **Critical / High** — always post; these decide the outcome.
- **Medium** — post only when concretely actionable (a specific missing test, a real unhandled
  edge case, a definite pattern break). Never speculative.
- **Low / Info** — do **not** post as PR-review findings. A local deep audit may list them; on
  a PR they are noise.

**Never post — not findings, in any dimension:** style preferences (verbose vs concise, arrow
vs named function, optional-chaining vs guard); naming bikeshed; reformatting; "consider
extracting / hoisting / future-proofing" on code that already works; schema-modifier ordering
when behavior is correct; magic-number→const when the value is obvious from context; anything
the author chose defensibly that you would merely prefer otherwise; anything already addressed
in an earlier commit or a resolved review thread.

**Outcome is deterministic:** `NEEDS WORK` iff ≥1 surviving **Critical or High** finding
(including any `⚠️ breaks already-shipped clients`); otherwise `APPROVE`. Medium / Low / Info
never force NEEDS WORK. Never manufacture a Critical/High finding to avoid approving — a clean
diff earns a plain approval.

---

## Finding template

Every finding, every dimension, the same shape:

```
[SEVERITY] <one-line title>  ⚠️ breaks already-shipped clients (only if applicable)
· dimension: <rubric dimension>
· location: <repo>/<path>:<line>
· issue: <1-2 sentences — what is wrong>
· risk: <1-2 sentences — what goes wrong if it ships>
· fix: <the concrete change, or a corrected snippet>
· reference: <code-standard rule | comment-lint rule | design-canon line | backend hard rule | OWASP | security category>
```

---

## Dimensions

Each dimension is a checklist. A diff that doesn't touch a dimension's surface skips it
(noted as N/A) — do not invent findings for files the diff never changes. UI dimensions are
**gated to frontend/UI changes**; backend hard rules are gated to backend changes. The four
config-conditional dimensions are inert unless config declares them.

### 1. Correctness

> Reference: the change's own intent (PR body / linked issue / plan).

- Does it do what the PR/issue says, across every boundary it crosses?
- Data flow: request shape in → handler → response shape out → consumer reads it. Any mismatch
  in that chain?
- Boundary conditions: empty list, zero, null, first/last item, timezone edges (dates must
  route through the project's canonical date/timezone service on the backend — see dimension 13).
- State: are loading / error / empty states all handled, not just the happy path?
- Concurrency / ordering assumptions that the diff silently relies on.

### 2. Dead / stale code

> Reference: the project code standard "delete unused code."

- Orphaned exports, functions, or types with **zero references** after this change (cite the
  zero-reference grep).
- Dead branches that can no longer be reached.
- Commented-out code blocks.
- Stub functions and speculative "just in case" parameters.
- Imports / variables the diff itself left unused.

### 3. SOLID / clean architecture

> Reference: the project code standards on function size, premature abstraction, and DRY level.

- Function size soft cap ~50 lines, nesting ~3 levels; hard cap ~100. Over → the function is
  doing too much, split it.
- New endpoints follow the project's server-side handler pattern (e.g. command/query +
  handler + validator) where one exists.
- Frontend respects the platform-adapter split (server-side data layer vs direct-client call);
  shared logic lives in the shared package, not duplicated per app.
- No premature abstraction — extract on the third real use, not the second. Three similar lines
  beat a helper invented for two.
- DRY at the right level: cross-app → the shared package; cross-component → a shared component
  dir; cross-function-in-file → a local helper. Don't lift to shared for one caller.

### 4. Comment policy

> Reference: the project's comment-lint rule (adapt to yours).

The reviewer flags a comment exactly when the linter would. Typical **allowed** set (customize
to your rule), nothing else:

- A doc-block (`/** … */` / the language's doc-comment form) on an **exported** function, hook,
  or type — one short paragraph on intent and contract.
- The language's reference/XML-doc line form.
- A tooling directive (lint-disable, type-checker suppression, formatter-ignore, coverage /
  bundler pragmas).
- A WHY note that contains an `http(s)://` URL to an upstream issue/PR/doc — a real external
  constraint the author cannot fix here.

Everything else is a finding: narration, restating code, task/PR/fix references, TODOs. The fix
is never "reword the comment" — it is **rename the symbol or extract a well-named function** so
the code reads without prose.

### 5. No-workaround / root-cause

> Reference: the project code standard "root cause over workarounds."

- The signature smell: **ugly frontend written to dodge a missing or awkward API** —
  client-side reshaping, refetch-and-merge, optimistic patches that paper over a shape the
  backend should return directly. Flag it and point at the upstream fix.
- Fallbacks, defensive branches, or local patches for a problem that belongs to a config, a
  type, or a shared util.
- An unavoidable workaround is allowed **only** with a one-line WHY-with-URL note
  (dimension 4). No link → it is not a sanctioned workaround.

### 6. Type safety

> Reference: the project code standard "no escape-hatch casts."

- Any escape-hatch cast that defeats the type system (`any`, double-cast through `unknown`, or
  the target language's equivalent). Use a narrowed `unknown` instead.
- In statically-typed backends: implicit conversions and unjustified null-forgiving operators
  (the analog of an `any` cast).
- Inferred-`any` callbacks and untyped external payloads crossing a trust boundary without a
  schema parse.

### 7. No stray debug logging

> Reference: the project code standard "no debug logging in production code."

- Any stray debug print / console log in production code. Use the project logger or remove it.
  Test files are exempt.

### 8. Design-system / AI-slop

> Reference: the project's design canon (the design doc listed in `{{config.conventionsDocs}}`,
> if any). **Gated: only when the diff touches frontend/UI files.** If the project has no
> design canon, mark N/A.

Scan for generic AI-slop tells relative to the project's own anchor:

- Gradients used as decoration outside the sanctioned surfaces.
- Cards-in-cards (opaque card-on-card).
- Low-contrast text on colored backgrounds.
- Rounded-square icon tiles above headings.
- Semantic-destructive fills where the design shows a lighter treatment.
- Oversized centered headings outside hero contexts; decorative gradient borders.

Token / ban checks (adapt to the project's design canon):

- No raw palette references or hardcoded accent values — semantic design tokens only.
- No catch-all transitions (animate specific properties, named); no viewport-locked heights
  where a dynamic-viewport unit is required; no new font families, radii, or colors outside
  the spec.
- No per-component theme branches — themes resolve through tokens.

Then the **scene-sentence test**: describe the rendered screen in one sentence. If it reads
like every other app in its category, it is generic — flag it to rework until the sentence
names the project's own visual character.

### 9. Parity (mirrored surfaces) — CONFIG-CONDITIONAL

> Active **only** when `{{config.parity.enabled}}` is true; the mirror map comes from
> `{{config.parity.mirrors}}`. Otherwise this dimension is N/A. Reference: the project's
> cross-surface parity rule.

- Every changed file on one side of a mirror pair has its mirror on the other side changed in
  the same PR (and vice-versa), per `{{config.parity.mirrors}}`.
- The mirror is **behaviorally identical** — same logic, data flow, error handling. Only
  platform adapters may differ (server-side data layer vs direct-client call, cookie vs secure
  device storage, one styling system vs another, one i18n library vs another).
- `MISSING` (no mirror file) is High; `PARTIAL` (mirror exists, not updated) is High until
  proven intentional.

### 10. i18n — CONFIG-CONDITIONAL

> Active **only** when `{{config.i18n.locales}}` is non-empty; locale files come from
> `{{config.i18n.paths}}`. Otherwise N/A. Reference: the project's "add keys to every locale
> in the same edit" rule.

- Every new user-facing string has a key in **every** locale file under `{{config.i18n.paths}}`
  for **every** locale in `{{config.i18n.locales}}` (a key present in one but missing in another
  is a finding).
- No orphaned callsite referencing a key that exists in no locale.
- Brand / proper nouns in `{{config.i18n.doNotTranslate}}` stay untranslated.
- Keys stay hierarchical (dot-notation) and alphabetized within their hierarchy.

### 11. Contract drift + backward-compat guard — CONFIG-CONDITIONAL

> Active **only** when `{{config.contract.enabled}}` is true AND the project has more than one
> repo. Client-side types come from `{{config.contract.clientTypesGlob}}`, server-side from
> `{{config.contract.serverTypesGlob}}`; the backward-compat policy is
> `{{config.contract.backwardCompat}}`. Otherwise N/A. Reference: the project's API-contract
> rule.

First, drift (field-by-field shape comparison): missing-server-type, missing-client-type,
field drift, and path drift between `{{config.contract.clientTypesGlob}}` (+ the endpoint
constants) and `{{config.contract.serverTypesGlob}}` (+ the server routes).

Then the **backward-compat judgment** drift detection alone does not make — the direction and
the add/remove of each field, because a lagging client runs a frozen snapshot of the contract.
Apply the policy in `{{config.contract.backwardCompat}}` (typically append-only / expand-
contract):

- **Field removed from / renamed in a *response* type** → old clients that read it now get
  `undefined` → **`⚠️ breaks already-shipped clients` (Critical)**, unless the field was already
  optional AND unused (cite the grep proving it).
- **Field removed from / renamed in a *request* type, or a field made newly-required** → old
  clients still send the old shape → server validation rejects it →
  **`⚠️ breaks already-shipped clients` (Critical)**.
- **Field added as optional** → forward-compatible → **Info**, not a break.
- **Enum value removed** → old clients may still send it → flag.

Recommend the compatible alternative in the fix: keep-and-deprecate the old field, accept both
names server-side for a release, or gate behind the min-version gate described in
`{{config.contract.backwardCompat.minVersionGate}}`. When old-client reach is uncertain,
downgrade to **High** with a "verify old-client usage" note rather than over-claiming Critical.

### 12. Security

> Reference: OWASP + the project's security boundaries. When a generic security-reviewer agent
> is available it owns the backend categories; the frontend categories below are what that agent
> does NOT cover.

Review the categories relevant to the change.

**Injection** — raw or string-interpolated SQL / ORM queries; XSS via unescaped user input in
markup or a raw-HTML sink; command injection (spawning a process with user input); path
traversal from unsanitized input in file paths.

**Authentication & authorization** — missing authorization on a new API endpoint (the default
should be authenticated; missing both the auth attribute and an explicit anonymous marker is a
bug); missing auth checks on server-side data routes; hardcoded credentials, signing secrets,
or API keys; session config must stay httpOnly + sameSite strict + secure; CORS must stay
restrictive (no allow-any-header / allow-any-method, never allow-any-origin with credentials);
third-party SDK keys set once at startup, never per-request.

**Data exposure** — sensitive data (passwords, tokens, PII) in logs; responses leaking stack
traces or DB schema; secrets in source / config; missing input validation at the API boundary;
webhook handlers must verify signatures.

**Dependency & configuration** — known-vulnerable dependency versions; debug mode enabled in
production config; security-headers middleware (nosniff, frame-deny, referrer-policy) must not
be disabled; request-size limits intact.

**Cryptography** — weak hashing for passwords (use a modern password KDF); hardcoded encryption
keys; insecure RNG for security-sensitive values; HTTPS enforcement intact.

**Error handling** — verbose error messages exposing internals; unhandled promise rejections /
unobserved tasks; catch blocks that swallow errors silently; the project's result/error type
propagated correctly.

**Validation** — the backend is the source of truth; client-side schema validation is
convenience only. Every new endpoint needs server-side validation **and** a domain-entity
guard. Numeric bounds, date ranges, and mutually exclusive options are enforced server-side.

### 13. Backend hard rules — CONFIG-CONDITIONAL

> Active **only** when the diff touches a backend repo AND `{{config.review.backendHardRules}}`
> is non-empty. The concrete checks come from `{{config.review.backendHardRules}}`; grep the
> tokens in `{{config.review.frameworkTokens}}` to locate the relevant call sites. If that
> config is empty, mark N/A. Reference: the project's backend cross-cutting hard rules.

Walk each rule string in `{{config.review.backendHardRules}}` against the changed backend code
and flag any violation, using `{{config.review.frameworkTokens}}` to find where the rule
applies. Typical rule families a project encodes here:

- **Timezone**: user-facing dates go through the canonical user-date service, never raw
  server-clock conversion.
- **Authorization**: every controller endpoint requires the auth attribute unless it is a
  public route; new endpoints default to authenticated.
- **Validation**: validators live in the designated validators location **and** domain-entity
  guards back them.
- **Logging**: structured, consistent-cased properties, one language — never string-interpolated.
- **Tests**: every new handler, validator, and service has a unit test.

---

## Self-review note

This rubric and the skills that walk it are themselves held to the standard they enforce:
every code snippet here is exemplary (no narration comments, no escape-hatch casts, no debug
logging). Dogfood the rubric against the review output before posting.
