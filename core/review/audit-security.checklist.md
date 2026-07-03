# Security Audit Checklist

> **Config inputs:** `config.review.frameworkTokens`, `config.review.backendHardRules`, `config.auditAnchors.securityTiersInScope`

The category list the `audit-security` skill fans out against. Each category names what to look
for, where it typically lives, and what makes a finding real. Assembled from OWASP's Top 10 +
API Top 10 and generic secure-coding canon; adapt the "where to look" pointers to your stack
using `{{config.review.frameworkTokens}}` (the security-relevant tokens to grep) and layer any
project-specific rules from `{{config.review.backendHardRules}}` on top.

A finding is only real when you can name **who reaches it and what they get**. Calibrate every
finding to `{{config.auditAnchors.securityTiersInScope}}` (see the skill's tier table).

---

## A. Authorization & data-isolation

- Every data query/command handler filters by the **authenticated** principal's id (derived
  from the verified token/session, never from a request field the client controls).
- A handler that takes an entity `id` and loads it **without an ownership check** is an IDOR —
  another user reads/writes that entity.
- List endpoints scope their result set to the caller; no "load all, filter client-side."
- Role/permission checks on privileged actions are server-side, not inferred from client state.

## B. Injection

- Raw or string-interpolated SQL / ORM queries built from user input.
- XSS via unescaped user input in markup or a raw-HTML sink.
- Command injection — spawning a process with user-controlled arguments.
- Path traversal — building a filesystem path from unsanitized input.

## C. Secrets & credentials

- No signing secret, DB password, third-party API key, or private key committed to source or
  baked into config that ships.
- Config comes from the environment / a secret store, not literals.
- No secret echoed into logs, error messages, or responses.

## D. Configuration & transport

- CORS is restrictive: no allow-any-header, no allow-any-method, never allow-any-origin combined
  with credentials.
- Security-headers middleware (nosniff, frame-deny, referrer-policy, XSS protections) present
  and not disabled.
- Debug/verbose mode off in production config.
- Request-size limits in place (a global cap plus tighter caps on large-payload endpoints).
- HTTPS enforcement / secure transport intact.

## E. Rate-limiting & abuse

- Abuse-prone or expensive endpoints (auth, password-reset, verification-code, AI/chat) carry a
  rate limit.
- No unauthenticated endpoint can be driven to exhaust a resource or run up cost unbounded.

## F. AI / agent-tool scoping (only if the project exposes AI or agent tools)

- Every AI/agent tool that mutates data derives the acting principal from the **session**, and
  no tool accepts a target-user parameter — a tool that mutates by raw id without ownership
  scoping is a top-tier hole.
- User text reaching a model is size-capped and rate-limited; a crafted prompt cannot make a
  tool act outside the caller's own data or run an unbounded-cost loop.
- **Model output never authorizes** — authorization stays server-side; the model is not trusted
  to decide access.

## G. Error handling & information leakage

- No stack traces, DB schema, or internal identifiers in responses.
- Catch blocks don't swallow errors silently; the project's result/error type propagates.
- Verbose diagnostics gated to non-production.

## H. Session & client-side auth

- Web auth cookie: httpOnly + sameSite strict + secure.
- Native/mobile tokens in the platform secure store, never plaintext app storage.
- No auth token or session id exposed to client-readable storage where an XSS could lift it.

## Payment & webhook integrity (if the project takes payments)

- Every payment/subscription webhook verifies its signature before processing — an unverified
  webhook is forged subscription state.
- The payment SDK key is set once at startup, never per-request.
- Entitlement/interval values are validated against a server-side whitelist.
