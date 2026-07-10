// Decode — the second half of setup-harness, step 1. Takes the interview record
// (harness.answers.yaml: confirmed answers + the doc-derived normative
// statements) and classifies EVERY rule / instruction / policy to its authority
// tier, per the rule of thumb the whole harness upgrade used:
//
//   enforcement  -> HOOK  (git-action / content), or a real LINT rule at the
//                   strongest layer when the stack has a linter
//   procedure    -> SKILL
//   facts/convs  -> FACT  (CLAUDE.md) or RULE (re-injected each session)
//   tool default -> RULE  (unscoped, "never tell it again")
//
// The output is a DECOMPOSITION: one row per rule with its proposed tier, the
// template it binds to (for hooks), the concrete value, path-scopes/exceptions,
// and any CONFLICT with another source. Precedence is ALWAYS-ASK: a disagreement
// between the interview, the config, and a doc is flagged inline and never
// auto-resolved — the gate step surfaces it for the user to settle.
//
// ZERO project policy is baked in: every value comes from `answers`; this module
// only decides WHERE a rule belongs, never WHAT a project's rule is. A machine
// that bans authorship trailers and one that requires them decode to opposite
// rows from opposite answers — neither is assumed here.

import { templateById } from "../hooks/templates.mjs";

export const TIERS = { HOOK: "HOOK", LINT: "LINT", RULE: "RULE", FACT: "FACT", SKILL: "SKILL" };

const CODE_POLICY_HINTS =
  /\b(console|debugger|no[-\s]?any|untyped|type(?:d|script)? (?:escape|hatch)|comment(?:s)? policy|function (?:size|length|line)|nesting|layer(?:ing)?|banned import|restricted import|logging|log level|magic number)\b|print\(/i;

// Subjects that name a SINGLE decision (one branch grammar, one ticket format).
// For these, two rules proposing different concrete values is a conflict. A
// multi-instance subject (many tool defaults, many code policies) is not.
const SINGLETON_SUBJECTS = new Set(["branch-name", "ticket-ref", "protected-ref", "merge-strategy", "em-dash"]);

// Does a group of same-subject rows pull opposite ways? A ban vs a requirement is
// always a clash; two DIFFERENT concrete values on a singleton subject is too.
export function subjectClash(subject, rows) {
  const stances = new Set(rows.map((r) => r.stance));
  if (stances.has("ban") && stances.has("require")) return true;
  if (!SINGLETON_SUBJECTS.has(subject)) return false;
  const values = new Set(rows.filter((r) => r.value != null).map((r) => JSON.stringify(r.value)));
  return values.size > 1;
}

// Classify one free-form normative statement to its tier. Deterministic and
// keyword-driven; the gate lets the user correct any call. `subject` groups rows
// for conflict detection; `stance` ("ban" | "require") lets opposite rules on the
// same subject be caught as a conflict.
export function classifyStatement(text, { strength = "hard", stack = { linters: [] } } = {}) {
  const t = String(text || "").toLowerCase();
  const linted = (stack.linters || []).length > 0;
  const bans = /\b(never|no|not|ban|banned|forbid|forbidden|without|omit|avoid|don'?t|prohibit|disallow)\b/.test(t);

  if (/em[-\s]?dash|—/.test(t)) return { tier: TIERS.HOOK, templateId: "em-dash", subject: "em-dash", stance: "ban", reason: "typographic ban -> content hook (or a real lint rule where the stack expresses it)" };
  if (/co-?author|authorship trailer|co-?authored/.test(t)) {
    return bans
      ? { tier: TIERS.HOOK, templateId: "forbidden-trailer", subject: "authorship-trailer", stance: "ban", reason: "banned commit/PR trailer -> git-action hook" }
      : { tier: TIERS.FACT, subject: "authorship-trailer", stance: "require", reason: "required authorship trailer -> config pr.commitTrailer + a fact" };
  }
  if (/\bsecret|credential|api key|access key|private key|password|hardcoded token\b/.test(t)) return { tier: TIERS.HOOK, templateId: "secret-scan", subject: "secret", stance: "ban", reason: "secret leakage -> content secret-scan hook" };
  if (/--no-verify|bypass (?:the )?(?:hook|commit|pre-commit)|skip (?:the )?hook/.test(t)) return { tier: TIERS.HOOK, templateId: "no-verify", subject: "no-verify", stance: "ban", reason: "hook bypass -> git-action hook" };
  if (/force[-\s]?push|push (?:directly )?to (?:the )?(?:protected|main|master|trunk|default)|protected branch|direct(?:ly)? (?:commit|push) to/.test(t)) return { tier: TIERS.HOOK, templateId: "protected-ref", subject: "protected-ref", stance: "ban", reason: "protected branch -> git-action hook" };
  if (/\bbranch(?:es)?\b/.test(t) && /\b(name|naming|prefix|pattern|grammar|convention|create|creat\w*|start|cut|named|call|with|from|match)\b/.test(t)) return { tier: TIERS.HOOK, templateId: "branch-name", subject: "branch-name", stance: "require", reason: "branch grammar -> git-action hook" };
  if (/ticket (?:ref|reference|id|number)|issue (?:ref|reference|key) in (?:the )?commit|reference a ticket|jira (?:issue|key|ticket)/.test(t)) return { tier: TIERS.HOOK, templateId: "ticket-ref", subject: "ticket-ref", stance: "require", reason: "ticket reference -> git-action hook" };
  if (/\buse (?:the )?[\w.+-]+ (?:cli|mcp|command line|command-line)|always (?:use|reach for|prefer)|prefer (?:the )?[\w.+-]+ (?:cli|mcp)/.test(t)) return { tier: TIERS.RULE, subject: "tool-default", stance: "require", reason: "proactive tool default -> unscoped rule (never tell it again)" };
  if (CODE_POLICY_HINTS.test(t)) return linted ? { tier: TIERS.LINT, subject: "code-policy", stance: "ban", reason: "code-level policy on a linted stack -> a real lint rule (strongest layer)" } : { tier: TIERS.HOOK, templateId: "banned-phrases", subject: "code-policy", stance: "ban", reason: "code-level policy, no linter detected -> content-scan hook fallback" };
  if (/\b(then|next|first|finally)\b/.test(t) && /\b(open a (?:pr|pull request)|create (?:a )?branch|request review|merge|deploy|release|runbook|process|procedure|steps?)\b/.test(t)) return { tier: TIERS.SKILL, subject: "procedure", stance: "require", reason: "multi-step procedure -> a skill" };
  return strength === "hard"
    ? { tier: TIERS.RULE, subject: "convention", stance: "require", reason: "enforceable-but-unmapped rule -> a re-injected rule" }
    : { tier: TIERS.FACT, subject: "convention", stance: "require", reason: "soft convention -> a CLAUDE.md fact" };
}

function row(fields) {
  return {
    action: fields.tier === TIERS.HOOK || fields.tier === TIERS.LINT ? "enforce" : "keep",
    templateId: null,
    layer: null,
    value: null,
    scopes: null,
    exceptions: [],
    conflicts: [],
    stance: "require",
    ...fields,
  };
}

const ans = (answers, key) => answers?.answered?.[key];

// Git-flow answers (branch grammar, protected refs, ticket ref, authorship
// trailer, bypass policy, merge strategy) -> their tiered rows. Each value is
// read from the answer; none is assumed.
function rowsFromGitFlow(answers) {
  const out = [];
  const gf = ans(answers, "branchNaming") || {};
  const enforceRegex = gf.enforceRegex || ans(answers, "gitFlow.branchRegex") || "";
  if (enforceRegex) {
    out.push(row({ id: "gitflow.branch-name", source: "interview", rule: `Branch names must match /${enforceRegex}/`, tier: TIERS.HOOK, templateId: "branch-name", policyPath: "git.branchPattern", configBinding: "hooks.git.branchPattern", value: enforceRegex, exceptions: gf.exceptions || [], subject: "branch-name" }));
  }
  const protectedBranches = gf.protectedBranches || ans(answers, "gitFlow.protectedBranches");
  if (Array.isArray(protectedBranches) && protectedBranches.length) {
    out.push(row({ id: "gitflow.protected-ref", source: "interview", rule: `No commit/push to protected branches: ${protectedBranches.join(", ")}`, tier: TIERS.HOOK, templateId: "protected-ref", policyPath: "git.protectedBranches", configBinding: "hooks.git.protectedBranches", value: protectedBranches, subject: "protected-ref" }));
  }
  const ticket = gf.ticketRegex || ans(answers, "gitFlow.ticketRegex") || (ans(answers, "issueTracker") || {}).ticketPattern;
  if (ticket) {
    out.push(row({ id: "gitflow.ticket-ref", source: "interview", rule: `Commit messages must carry a ticket ref matching /${ticket}/`, tier: TIERS.HOOK, templateId: "ticket-ref", policyPath: "git.ticketPattern", configBinding: "hooks.git.ticketPattern", value: ticket, subject: "ticket-ref" }));
  }
  const coauthor = ans(answers, "gitFlow.coauthor");
  if (coauthor === "banned") {
    const trailer = ans(answers, "gitFlow.coauthorTrailer") || gf.coauthorTrailer || "";
    out.push(row({ id: "gitflow.forbidden-trailer", source: "interview", rule: `Commit/PR bodies must not contain the authorship trailer${trailer ? ` "${trailer}"` : ""}`, tier: TIERS.HOOK, templateId: "forbidden-trailer", policyPath: "git.forbiddenTrailers", configBinding: "hooks.git.forbiddenTrailers", value: trailer ? [trailer] : [], subject: "authorship-trailer", stance: "ban" }));
    out.push(row({ id: "gitflow.trailer-omit", source: "interview", rule: "The ship/commit procedure emits no authorship trailer", tier: TIERS.FACT, configBinding: "pr.commitTrailer", value: null, subject: "authorship-trailer", stance: "ban" }));
  } else if (coauthor === "required") {
    const trailer = ans(answers, "gitFlow.coauthorTrailer") || gf.coauthorTrailer || "";
    out.push(row({ id: "gitflow.trailer-required", source: "interview", rule: "Every commit carries the authorship trailer", tier: TIERS.FACT, configBinding: "pr.commitTrailer", value: trailer, subject: "authorship-trailer", stance: "require" }));
  }
  if (ans(answers, "gitFlow.bypass") === "block") {
    out.push(row({ id: "gitflow.no-verify", source: "interview", rule: "Bypassing hooks (--no-verify / commit -n) is blocked", tier: TIERS.HOOK, templateId: "no-verify", policyPath: "git.blockNoVerify", configBinding: "hooks.git.blockBypassFlags", value: true, subject: "no-verify", stance: "ban" }));
  }
  if (gf.mergeStrategy) {
    out.push(row({ id: "gitflow.merge-strategy", source: "interview", rule: `Merge strategy: ${gf.mergeStrategy}`, tier: TIERS.FACT, configBinding: "pr.squash", value: gf.mergeStrategy, subject: "merge-strategy" }));
  }
  return out;
}

// Text/style bans -> content-hook rows (em dash, banned phrases), each carrying
// its optional path-scope.
function rowsFromContentBans(answers) {
  const out = [];
  const content = ans(answers, "hooks.content") || ans(answers, "textBans") || {};
  const em = content.emDash;
  if (em?.enabled) out.push(row({ id: "content.em-dash", source: "interview", rule: "No em dashes in scoped copy", tier: TIERS.HOOK, templateId: "em-dash", policyPath: "content.emDash", configBinding: "hooks.content.emDash", value: { enabled: true, allowNumericEnDash: em.allowNumericEnDash !== false }, scopes: em.scope || null, subject: "em-dash", stance: "ban" }));
  const phrases = content.bannedPhrases?.phrases || content.bannedPhrases;
  if (Array.isArray(phrases) && phrases.length) out.push(row({ id: "content.banned-phrases", source: "interview", rule: `Banned phrases: ${phrases.join(", ")}`, tier: TIERS.HOOK, templateId: "banned-phrases", policyPath: "content.bannedPhrases", configBinding: "hooks.content.bannedPhrases", value: { enabled: true, phrases }, scopes: content.bannedPhrases?.scope || null, subject: "banned-phrases", stance: "ban" }));
  return out;
}

// Code-level policies -> the STRONGEST layer. A descriptor is routed to a real
// lint rule where the stack supports it (LINT), else the content-scan hook.
function rowsFromCodePolicies(answers, stack) {
  const policies = ans(answers, "codePolicies");
  if (!Array.isArray(policies)) return [];
  const linted = (stack?.linters || []).length > 0;
  return policies.map((p, i) => {
    const descriptor = typeof p === "string" ? { text: p } : p;
    const enforceable = descriptor.kind && linted;
    return row({
      id: `code.${descriptor.id || i}`,
      source: "interview",
      rule: descriptor.text || descriptor.kind || `code policy ${i}`,
      tier: enforceable ? TIERS.LINT : TIERS.HOOK,
      layer: enforceable ? "lint" : "hook",
      templateId: enforceable ? null : "banned-phrases",
      value: descriptor,
      subject: "code-policy",
      stance: "ban",
      reason: enforceable ? "code policy on a linted stack -> real lint rule" : "code policy without a matching linter -> content-scan hook fallback",
    });
  });
}

// Tool defaults ("always use the AWS CLI", "use the Jira MCP") -> unscoped rules.
function rowsFromToolDefaults(answers) {
  const defaults = ans(answers, "toolDefaults");
  if (!Array.isArray(defaults)) return [];
  return defaults.map((d, i) => {
    const tool = typeof d === "string" ? d : d.tool;
    const domain = typeof d === "string" ? "" : d.domain || "";
    return row({ id: `tool.${slug(tool) || i}`, source: "interview", rule: `Always reach for ${tool}${domain ? ` for ${domain}` : ""}`, tier: TIERS.RULE, subject: "tool-default", value: { tool, domain, kind: d.kind || "" } });
  });
}

// Issue tracker -> a config binding plus a fact; an MCP tracker also seeds a
// tool-default rule (the "RULE + CONFIG" of the worked example).
function rowsFromTracker(answers) {
  const tracker = ans(answers, "issueTracker");
  if (!tracker || !tracker.host) return [];
  const out = [row({ id: "tracker.config", source: "interview", rule: `Issue tracker: ${tracker.host}${tracker.repo ? ` (${tracker.repo})` : ""}`, tier: TIERS.FACT, configBinding: "issueTracker", value: tracker, subject: "tracker" })];
  const resolved = answers?.tracker?.tool;
  if (resolved?.kind === "mcp") out.push(row({ id: "tracker.mcp-default", source: "interview", rule: `Use the ${tracker.host} MCP for issue operations`, tier: TIERS.RULE, subject: "tool-default", value: { tool: `${tracker.host} MCP`, domain: "issue tracking", kind: "mcp" } }));
  return out;
}

// Every doc-derived normative statement -> its own tiered row (decompose each
// policy inside a fetched doc individually), carrying the source link for
// re-injection.
function rowsFromNormative(answers, stack) {
  const statements = answers?.docs?.normativeStatements || [];
  return statements.map((statement, i) => {
    const c = classifyStatement(statement.text, { strength: statement.strength, stack });
    return row({
      id: `doc.${i}`,
      source: `doc:${statement.source || "unknown"}`,
      rule: statement.text,
      tier: c.tier,
      templateId: c.templateId || null,
      layer: c.layer || null,
      subject: c.subject,
      stance: c.stance,
      reason: c.reason,
    });
  });
}

// Procedures the interview surfaced -> skills. `investigate` is machine-specialized
// from its tool bindings; each bespoke flow becomes a proposed new skill.
function rowsFromProcedures(answers) {
  const out = [];
  const investigate = ans(answers, "investigate");
  if (investigate && Object.values(investigate).some(Boolean)) {
    out.push(row({ id: "skill.investigate", source: "interview", rule: "Machine-specialized investigate runbook (bound to this machine's incident tools)", tier: TIERS.SKILL, value: { kind: "specialize", skill: "investigate", bindings: investigate }, subject: "procedure" }));
  }
  const ship = ans(answers, "shipFlow");
  if (ship && (ship.steps?.length || ship.describe)) {
    out.push(row({ id: "skill.ship", source: "interview", rule: "Specialized ship/flow skill for this machine's release path", tier: TIERS.SKILL, value: { kind: "specialize", skill: "ship", flow: ship }, subject: "procedure" }));
  }
  const bespoke = ans(answers, "bespokeFlows");
  if (Array.isArray(bespoke)) {
    for (const flow of bespoke) {
      if (!flow?.name) continue;
      out.push(row({ id: `skill.${slug(flow.name)}`, source: "interview", rule: `New skill: ${flow.name}`, tier: TIERS.SKILL, value: { kind: "new", flow }, subject: "procedure" }));
    }
  }
  return out;
}

// Scale + conventions -> facts CLAUDE.md carries.
function rowsFromFacts(answers) {
  const out = [];
  const scale = ans(answers, "auditAnchors.scale");
  if (scale) out.push(row({ id: "fact.scale", source: "interview", rule: `System scale: ${scale} (calibrates audit severity)`, tier: TIERS.FACT, configBinding: "auditAnchors.scale", value: scale, subject: "scale" }));
  return out;
}

// Existing CLAUDE.md/rules content, turned into decode candidates by the adopt
// path (each already an extracted normative statement), classified like doc text
// but sourced from the file so the manifest records where it came from.
function rowsFromExisting(existing, stack) {
  return (existing || []).map((item, i) => {
    const c = classifyStatement(item.text, { strength: item.strength, stack });
    return row({ id: `adopt.${i}`, source: `existing:${item.source || "CLAUDE.md"}`, rule: item.text, tier: c.tier, templateId: c.templateId || null, layer: c.layer || null, subject: c.subject, stance: c.stance, reason: c.reason });
  });
}

// A conflict = two rows on the same subject that pull opposite ways: a ban vs a
// requirement, or two different concrete values. Precedence is ALWAYS-ASK, so we
// only FLAG — never drop or auto-pick a winner.
export function detectConflicts(rows) {
  const bySubject = new Map();
  for (const r of rows) {
    if (!r.subject) continue;
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
    bySubject.get(r.subject).push(r);
  }
  const conflicts = [];
  for (const [subject, group] of bySubject) {
    if (group.length < 2 || !subjectClash(subject, group)) continue;
    const stances = new Set(group.map((r) => r.stance));
    const detail = stances.has("ban") && stances.has("require")
      ? `sources disagree on "${subject}": ${group.map((r) => `${r.source} wants to ${r.stance}`).join("; ")}`
      : `sources give different values for "${subject}"`;
    const rowIds = group.map((r) => r.id);
    conflicts.push({ subject, detail, rowIds, sources: group.map((r) => r.source) });
    for (const r of group) r.conflicts.push({ subject, detail, with: rowIds.filter((id) => id !== r.id) });
  }
  return conflicts;
}

// Decode the whole interview record into a decomposition: rows + flagged
// conflicts + a per-tier tally. `stack` (from the strongest-layer detector) routes
// code policies to lint vs hook; `existing` carries adopt-path candidates.
export function decode(answers = {}, { stack = { linters: [] }, existing = [] } = {}) {
  const rows = [
    ...rowsFromGitFlow(answers),
    ...rowsFromContentBans(answers),
    ...rowsFromCodePolicies(answers, stack),
    ...rowsFromToolDefaults(answers),
    ...rowsFromTracker(answers),
    ...rowsFromNormative(answers, stack),
    ...rowsFromProcedures(answers),
    ...rowsFromFacts(answers),
    ...rowsFromExisting(existing, stack),
  ];
  for (const r of rows) if (r.templateId && !r.reason) r.reason = templateById(r.templateId)?.describe || "";
  const conflicts = detectConflicts(rows);
  const stats = {};
  for (const r of rows) stats[r.tier] = (stats[r.tier] || 0) + 1;
  return { rows, conflicts, stats };
}

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function main() {
  const fs = await import("node:fs");
  const { readAnswers } = await import("./answers.mjs");
  const { detectStack } = await import("../hooks/lint-generators/detect.mjs");
  const file = process.argv[3] || "harness.answers.yaml";
  const answers = readAnswers(file);
  const repoPath = answers?.repos?.[0]?.path || process.cwd();
  const stack = fs.existsSync(repoPath) ? detectStack(repoPath) : { linters: [] };
  process.stdout.write(JSON.stringify(decode(answers, { stack }), null, 2) + "\n");
}

if (process.argv[1] && process.argv[2] === "decode") main();
