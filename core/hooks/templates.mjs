// The parameterized hook-template library. Each entry is one enforceable
// invariant expressed once, tool-neutrally, over the shared logic core. Setup
// (a later stage) reads this registry to (a) render the decomposition-table gate
// and (b) build hooks.policy.json from the interview + workflow.config.yaml; the
// generated adapters read the resulting policy. NOTHING here is a project
// constant — `configBinding` names WHERE in workflow.config.yaml a value comes
// from, `policyPath` names WHERE in hooks.policy.json it lands, and `default` is
// a universally-safe fallback. Anything a template does not cover is generated
// bespoke by setup off the same logic core.
//
// Every content/git template carries `supportsPathScopes` / `supportsExceptions`
// — a carve-out (em-dash allowed in CHANGELOG.md, branch rule exempts hotfix/*)
// NARROWS a rule, it never disables it.

export const TIER = { HOOK: "HOOK", LINT: "LINT", RULE: "RULE", FACT: "FACT" };

export const TEMPLATES = [
  {
    id: "no-verify",
    title: "No --no-verify / commit -n",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.blockNoVerify",
    configBinding: "git.blockBypassFlags",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: true,
    describe: "Block any git command that skips the commit/push hooks via --no-verify (or the `commit -n` alias).",
  },
  {
    id: "no-gpg-sign",
    title: "No --no-gpg-sign",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.blockNoGpgSign",
    configBinding: "git.requireSignedCommits",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: true,
    describe: "Block commits that bypass signing (--no-gpg-sign or commit.gpgsign=false).",
  },
  {
    id: "protected-ref",
    title: "No commit/push to a protected branch",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.protectedBranches",
    configBinding: "branchNaming.protectedBranches",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: ["main", "master"],
    describe: "Block a direct or forced push to a protected branch, and a bare push issued while HEAD is on one.",
  },
  {
    id: "branch-name",
    title: "Branch name must match the convention",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.branchPattern",
    configBinding: "branchNaming.pattern",
    supportsPathScopes: false,
    supportsExceptions: true,
    default: "",
    describe: "Block creating a branch whose name does not match the required regex (exceptions carve out e.g. hotfix/*).",
  },
  {
    id: "ticket-ref",
    title: "Commit message must carry a ticket ref",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.ticketPattern",
    configBinding: "issueTracker.ticketPattern",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: "",
    describe: "Block an inline commit (-m) whose message lacks a ticket reference matching the required regex.",
  },
  {
    id: "forbidden-trailer",
    title: "No forbidden commit/PR trailer",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.forbiddenTrailers",
    configBinding: "pr.forbiddenTrailers",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: [],
    describe: "Block a commit whose message contains a banned trailer (e.g. a machine that forbids authorship trailers). The inverse of a project that REQUIRES one — this is a pure policy field, never assumed.",
  },
  {
    id: "large-binary",
    title: "No large binaries committed",
    tier: TIER.HOOK,
    logic: "git-action",
    claudeCode: { event: "PreToolUse", matcher: "Bash", file: "git-guardrails.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["bash"] },
    policyPath: "git.largeBinaryGlobs",
    configBinding: "git.largeBinaryGlobs",
    supportsPathScopes: false,
    supportsExceptions: false,
    default: [],
    describe: "Block `git add` of a path matching the blocked-binary globs; steer to the configured asset storage.",
  },
  {
    id: "em-dash",
    title: "No em dashes in copy",
    tier: TIER.HOOK,
    logic: "content-scan",
    claudeCode: { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", file: "content-guard.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["edit", "write"] },
    policyPath: "content.emDash",
    configBinding: "content.emDash",
    supportsPathScopes: true,
    supportsExceptions: true,
    strongerLayer: "lint",
    default: { enabled: false, allowNumericEnDash: true },
    describe: "Flag an em dash (—) newly written into scoped copy — a banned typographic tell. Numeric en-dash ranges (1–10) allowed. Prefer a real lint rule in source files; the hook covers non-source copy.",
  },
  {
    id: "banned-phrases",
    title: "No banned phrases",
    tier: TIER.HOOK,
    logic: "content-scan",
    claudeCode: { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", file: "content-guard.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["edit", "write"] },
    policyPath: "content.bannedPhrases",
    configBinding: "content.bannedPhrases",
    supportsPathScopes: true,
    supportsExceptions: true,
    strongerLayer: "lint",
    default: { enabled: false, phrases: [] },
    describe: "Flag a configured banned phrase newly written into scoped files.",
  },
  {
    id: "secret-scan",
    title: "No secrets in source",
    tier: TIER.HOOK,
    logic: "content-scan",
    claudeCode: { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", file: "content-guard.mjs" },
    opencode: { hook: "tool.execute.before", tools: ["edit", "write"] },
    policyPath: "content.secretScan",
    configBinding: "content.secretScan",
    supportsPathScopes: true,
    supportsExceptions: true,
    default: { enabled: true, extraPatterns: [] },
    describe: "Flag a newly-written secret matching a conservative universal set (AWS/GitHub/Google/Slack/Stripe keys, private-key blocks) plus project extras. Default-excludes test/fixture paths.",
  },
  {
    id: "proactivity-guard",
    title: "Proactivity guard (disposition gate)",
    tier: TIER.HOOK,
    logic: "proactivity",
    claudeCode: { event: "UserPromptSubmit+Stop", matcher: "*", file: "proactivity-reminder.mjs + proactivity-guard.mjs" },
    opencode: { hook: "event", tools: [], note: "session.idle — best-effort nudge; cannot rewind a finished turn like the Claude Code Stop hook" },
    policyPath: "proactivity",
    configBinding: "proactivity",
    supportsPathScopes: false,
    supportsExceptions: false,
    modelConfigurable: true,
    default: { reminder: { enabled: true }, guard: { enabled: false, judgeModel: "" } },
    describe: "Re-inject one verify/do-it-yourself line each turn (Layer 1) and, when a judge model is configured, review the finished turn and send it back on a clear shortcut (Layer 2). Model-configurable; empty judgeModel disables Layer 2.",
  },
];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// Rows for the decomposition-table gate setup-harness presents before writing
// anything. `selected` maps template id -> chosen action (enforce/soften/drop).
export function gateTable(selected = {}) {
  return TEMPLATES.map((t) => ({
    id: t.id,
    rule: t.title,
    proposedTier: t.tier,
    action: selected[t.id] || "enforce",
    claudeCode: t.claudeCode.file,
    opencode: t.opencode.hook,
    scopes: t.supportsPathScopes ? "path-scoped" : "global",
    exceptions: t.supportsExceptions ? "supported" : "n/a",
    strongerLayer: t.strongerLayer || null,
    why: t.describe,
  }));
}
