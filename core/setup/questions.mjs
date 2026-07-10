// The fixed core question set for the setup-harness interview — section F of the
// design. It is deliberately NOT a rigid form: this module supplies the invariant
// spine (the questions every machine needs answered) plus, per question, the
// adaptive follow-ups that only apply given what detection found or what the user
// already said. The runbook walks the spine, and for each node asks only the
// follow-ups whose `when(context)` is true — a grill that branches, not a survey.
//
// `express: true` marks a question in the fast-start essentials set (repos /
// commands / tracker / git-flow); `--express` asks only those. Every question has
// an `answersKey` naming where its answer lands in harness.answers.yaml, so the
// record is resumable and the later decode step (a separate slice) can map each
// answer to its enforcement tier.
//
// ZERO policy is baked in here. A question about co-author trailers offers
// "required / banned / none" as equal options; the pack assumes none of them.

// Predicate helpers over the interview context { detect, answers }. All defensive
// — a missing detection field simply means the follow-up does not fire.
const cliPresent = (name) => (ctx) => Boolean(ctx.detect?.clis?.[name]?.present);
const mcpPresent = (needle) => (ctx) => (ctx.detect?.mcpServers || []).some((s) => s.toLowerCase().includes(needle));
const hostIs = (host) => (ctx) => ctx.detect?.git?.host === host;
const answered = (key, value) => (ctx) => ctx.answers?.[key] === value;
const always = () => true;
const anyOf = (...ps) => (ctx) => ps.some((p) => p(ctx));

export const CORE_QUESTIONS = [
  {
    id: "installMode",
    section: "Install mode",
    express: true,
    answersKey: "installMode",
    detectionHint: "detect.repoClean — a locked/scanned checkout or a policy forbidding committed AI files recommends repo-clean; else in-repo committed",
    prompt: "Where should this project's harness files live: committed IN the repo (default), gitignored but IN the repo, or REPO-CLEAN (nothing in the working dir at all — everything under ~/.claude, keyed to this repo)? Pick repo-clean when a company machine forbids adding or committing any AI/Claude files in a checkout. I pre-fill a recommendation from detection; you confirm.",
    followups: [
      { id: "installMode.repoClean", when: answered("installMode", "repo-clean"), prompt: "Repo-clean confirmed: every artifact goes to the out-of-repo store (default ~/.claude/harness, honoring CLAUDE_CONFIG_DIR), the global install + fact injector + enforcement are wired machine-wide, and I write ZERO files here. Is the default store location correct?" },
    ],
  },
  {
    id: "scale",
    section: "Scale",
    express: false,
    answersKey: "auditAnchors.scale",
    detectionHint: "not detectable — sets audit severity calibration",
    prompt: "What is the scale of this system: solo side-project, a team codebase, or enterprise? This calibrates how loud the audits get.",
    followups: [
      { id: "scale.security-tiers", when: answered("auditAnchors.scale", "enterprise"), prompt: "Which trust-boundary tiers are in scope for security review, and which are out of scope as enterprise-only?" },
      { id: "scale.review-reqs", when: anyOf(answered("auditAnchors.scale", "team"), answered("auditAnchors.scale", "enterprise")), prompt: "How many reviewer approvals does a PR need, and are there required reviewers or code-owner rules?" },
    ],
  },
  {
    id: "repos",
    section: "Projects-root + repos",
    express: true,
    answersKey: "repos",
    detectionHint: "detect.git + discovery (current repo, workspace members, projects-root scan)",
    prompt: "Confirm the set of repos this workflow spans. I detected the current repo and any workspace members; point me at a projects-root folder and I will scan it for siblings, or just name the repos.",
    followups: [
      { id: "repos.roles", when: (ctx) => (ctx.answers?.repos?.length || 0) > 1, prompt: "What is each repo's role (frontend / backend / shared / infra)? Roles route work and reports." },
      { id: "repos.monorepo-scope", when: (ctx) => (ctx.detect?.workspaceMembers?.length || 0) > 0, prompt: "This looks like a monorepo with workspace members. Which members are in scope, and do any need their own commands?" },
    ],
  },
  {
    id: "commands",
    section: "Per-repo test/lint/typecheck/build",
    express: true,
    answersKey: "repos[].commands",
    detectionHint: "commands.inferCommands per repo (package.json / *.csproj / pyproject.toml / Makefile)",
    prompt: "For each repo, confirm or correct the inferred test / lint / typecheck / build commands. An empty command means that step is skipped. I never run these — you confirm them.",
    followups: [
      { id: "commands.low-confidence", when: always, prompt: "Any command I marked low-confidence (a stack default, not a named script) — is it right, or what should it be?" },
      { id: "commands.missing", when: always, prompt: "Any step I could not infer — do you have a command for it, or should it stay skipped?" },
    ],
  },
  {
    id: "vcsTracker",
    section: "VCS host + tracker",
    express: true,
    answersKey: "issueTracker",
    detectionHint: "detect.git.host + resolveTracker over detected CLIs/MCPs",
    prompt: "Which forge hosts the code (GitHub / GitLab / Azure DevOps / Bitbucket) and which issue tracker do you use (its Issues, Jira, Linear, Azure Boards)? I resolve the best available tool for it.",
    followups: [
      { id: "vcsTracker.jira-key", when: anyOf(mcpPresent("jira"), mcpPresent("atlassian"), cliPresent("jira")), prompt: "What is the Jira project key and ticket format (e.g. a two-plus-letter prefix and a number)?" },
      { id: "vcsTracker.no-tool", when: (ctx) => !cliPresent("gh")(ctx) && !cliPresent("glab")(ctx) && !cliPresent("az")(ctx) && (ctx.detect?.mcpServers || []).length === 0, prompt: "I found no tracker CLI or MCP wired. How do you create and read issues today — a CLI I should look for, or the web?" },
      { id: "vcsTracker.repo", when: always, prompt: "Which repo (owner/name) holds the backlog issues, and what labels or milestones should new issues get?" },
    ],
  },
  {
    id: "gitFlow",
    section: "Git-flow",
    express: true,
    answersKey: "branchNaming",
    detectionHint: "detect.git.currentBranch + CI configs hint at protected refs",
    prompt: "Describe the git flow: branch-name grammar, protected branches, merge strategy (squash / rebase / merge commit), whether commits must carry a ticket ref, and review requirements.",
    followups: [
      { id: "gitFlow.ticket", when: anyOf(mcpPresent("jira"), cliPresent("jira"), (ctx) => ctx.answers?.["gitFlow.requireTicket"] === true), prompt: "What exact pattern must a branch name and/or commit message contain for the ticket ref? Any branches exempt (a release or hotfix prefix)?" },
      { id: "gitFlow.coauthor", when: always, prompt: "Commit authorship trailers / co-author lines: required, banned outright, or not cared about? (Each machine differs; I assume nothing.)" },
      { id: "gitFlow.bypass", when: always, prompt: "Should bypassing hooks or unsigned commits be blocked outright, or allowed?" },
    ],
  },
  {
    id: "textBans",
    section: "Text / style bans",
    express: false,
    answersKey: "hooks.content",
    detectionHint: "not detectable — free-form house-style bans",
    prompt: "Any text or style bans on written copy — em dashes, banned phrases, marketing filler, a house tone? These become content gates.",
    followups: [
      { id: "textBans.scope", when: (ctx) => Boolean(ctx.answers?.["textBans.any"]), prompt: "For each ban, where does it apply and where is it exempt (e.g. banned in docs and UI copy but allowed in a CHANGELOG)? A carve-out narrows a rule, never disables it." },
    ],
  },
  {
    id: "codePolicies",
    section: "Code-level policies",
    express: false,
    answersKey: "codePolicies",
    detectionHint: "detected linters (eslint / roslyn / ruff) decide hook-vs-real-lint-rule",
    prompt: "Any code-level policies to enforce — no console logging in production, a comment policy, no untyped escapes, function-size caps, layering rules? Where a linter exists I make these real lint rules, not just notes.",
    followups: [
      { id: "codePolicies.linter", when: anyOf((ctx) => (ctx.detect?.commands?.stack || []).includes("node"), (ctx) => (ctx.detect?.commands?.stack || []).includes("dotnet"), (ctx) => (ctx.detect?.commands?.stack || []).includes("python")), prompt: "Your stack has a linter/analyzer — should each code policy become a real lint rule (strongest layer) rather than a content hook?" },
    ],
  },
  {
    id: "toolDefaults",
    section: "Tool defaults",
    express: false,
    answersKey: "toolDefaults",
    detectionHint: "detect.clis + detect.mcpServers",
    prompt: "Which tools should I always reach for by default — a specific cloud CLI, a docs MCP, a package manager, a query tool? These become always-on tool-default rules.",
    followups: [
      { id: "toolDefaults.mcp", when: (ctx) => (ctx.detect?.mcpServers || []).length > 0, prompt: "You have MCP servers wired ({{detected}}). Which should be the default for their domain (errors, deploys, docs, data)?" },
    ],
  },
  {
    id: "docSources",
    section: "Doc sources",
    express: false,
    answersKey: "docs",
    detectionHint: "not detectable — explicit links + a taught doc-source",
    prompt: "Paste links to any company docs that carry policy (a Confluence page, a handbook, a standards repo), AND tell me WHERE such docs live (a Confluence space, a wiki base, a docs repo) so I can search it. I will fetch each and pull out every normative rule.",
    followups: [
      { id: "docSources.taught", when: (ctx) => Boolean(ctx.answers?.["docSources.hasSource"]), prompt: "For the doc-source you named, what should I search it for — the space/section, and which topics (git flow, security, style)?" },
      { id: "docSources.access", when: (ctx) => Boolean(ctx.answers?.["docSources.hasLinks"]), prompt: "Do any of these need auth I should reach via an MCP (Confluence/Notion), or are they public to WebFetch?" },
    ],
  },
  {
    id: "prodInvestigation",
    section: "Prod-investigation workflow",
    express: false,
    answersKey: "investigate",
    detectionHint: "detect.mcpServers hints at error tracker / deploy platform / data query",
    prompt: "How do you investigate a production incident here — which error tracker, deploy platform, prod-data query path, and code-nav tool? This machine-specializes the investigate runbook.",
    followups: [
      { id: "prodInvestigation.tracker", when: anyOf(mcpPresent("sentry"), mcpPresent("datadog"), mcpPresent("rollbar")), prompt: "I see an error-tracker MCP. What is the org/project slug and how do you usually pull an issue?" },
      { id: "prodInvestigation.deploy", when: anyOf(mcpPresent("render"), mcpPresent("vercel"), mcpPresent("aws"), mcpPresent("fly")), prompt: "For the deploy platform, how do you read deploys and runtime logs — and is there a workspace/project I must select first?" },
    ],
  },
  {
    id: "shipFlow",
    section: "Deploy / ship flow",
    express: false,
    answersKey: "shipFlow",
    detectionHint: "detect.ci shows the existing pipeline",
    prompt: "How does a change ship — open a PR, required checks, who merges, then how does it deploy (auto on merge, a manual promote, a release tag)? I can specialize a ship/flow skill for it.",
    followups: [
      { id: "shipFlow.ci", when: (ctx) => (ctx.detect?.ci || []).length > 0, prompt: "You already have CI configured. Should the local hooks enforce the same gates the pipeline does, so failures surface before push?" },
    ],
  },
  {
    id: "bespokeFlows",
    section: "Bespoke flows",
    express: false,
    answersKey: "bespokeFlows",
    detectionHint: "not detectable — surfaces new skills to generate",
    prompt: "Any other repeatable flow you run often — a release runbook, a data backfill, an onboarding sequence? If you describe one, I can propose a new skill for it.",
    followups: [
      { id: "bespokeFlows.enforceable", when: (ctx) => Boolean(ctx.answers?.["bespokeFlows.any"]), prompt: "Does that flow have any hard rules that must be enforced (not just followed)? Those become hooks; the steps become the skill." },
    ],
  },
];

export const SECTIONS = CORE_QUESTIONS.map((q) => q.section);

// The essentials subset for --express: repos, commands, tracker, git-flow.
export function expressQuestions() {
  return CORE_QUESTIONS.filter((q) => q.express);
}

export function questionsForMode(mode = "thorough") {
  return mode === "express" ? expressQuestions() : CORE_QUESTIONS;
}

// The next question not yet answered — how a resumed session picks up where an
// earlier one left off. `answeredIds` is the progress list from harness.answers.yaml.
export function nextUnanswered(questions, answeredIds = []) {
  const done = new Set(answeredIds);
  return questions.find((q) => !done.has(q.id)) || null;
}

// The follow-ups that apply right now, given detection + prior answers. This is
// what makes the interview adaptive rather than a fixed list.
export function activeFollowups(question, context = {}) {
  const ctx = { detect: context.detect || {}, answers: context.answers || {} };
  return (question.followups || []).filter((f) => {
    try {
      return f.when(ctx);
    } catch {
      return false;
    }
  });
}
