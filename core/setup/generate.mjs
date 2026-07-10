// Generate — the second half of setup-harness, step 3. Turns the APPROVED
// decomposition (post-gate) into concrete artifacts:
//
//   hooks.policy.json      the dual-target enforcement policy (CC hooks + opencode
//                          plugin both read it) — filled from the enforce rows
//   workflow.config.yaml   the mechanical values the generic pipeline skills read
//   CLAUDE.md              project facts (the FACT tier)
//   .claude/rules/*.md     re-injected rules + tool defaults (the RULE tier)
//   lint scaffolds         a real ESLint/Roslyn/ruff rule per code policy that a
//                          linter can express (the strongest layer)
//   .claude/skills/*       machine-specialized skills (investigate/ship) + new
//                          skills proposed from described bespoke flows
//
// Everything is derived from `answers` + the approved rows. This module writes
// NO project policy of its own — a machine that bans a trailer and one that
// requires it produce opposite artifacts from opposite rows. Each generator
// returns content; `planArtifacts` assembles the write plan and `writeArtifacts`
// commits it, so the runbook can preview before touching disk.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_POLICY, deepMerge } from "../hooks/logic/config.mjs";
import { toYaml } from "./answers.mjs";
import { strongestLayerFor } from "../hooks/lint-generators/index.mjs";

const ans = (answers, key) => answers?.answered?.[key];
const enforceRows = (approved) => (approved.rows || []).filter((r) => r.action === "enforce");
const rowsOfTier = (approved, tier) => (approved.rows || []).filter((r) => r.tier === tier);

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "rule";
}

// ---- hooks.policy.json -------------------------------------------------------

// Fill the runtime policy from the enforce rows. Starts at DEFAULT_POLICY (only
// universally-safe defaults) and turns on exactly what the decomposition enforces.
export function buildHooksPolicy(approved) {
  // Deep clone — a shallow copy would share (and MUTATE) DEFAULT_POLICY's nested
  // objects across calls.
  const policy = structuredClone(DEFAULT_POLICY);
  // A value-less row (e.g. a doc statement that names a rule but no concrete
  // value) enables the rule but must NEVER overwrite a concrete value an
  // earlier row (the interview) already set.
  for (const r of enforceRows(approved)) {
    switch (r.templateId) {
      case "branch-name":
        if (r.value) {
          policy.git.branchPattern = r.value;
          policy.git.branchExceptions = r.exceptions || [];
        }
        break;
      case "protected-ref":
        if (Array.isArray(r.value) && r.value.length) policy.git.protectedBranches = r.value;
        break;
      case "ticket-ref":
        if (r.value) policy.git.ticketPattern = r.value;
        break;
      case "forbidden-trailer":
        if (Array.isArray(r.value) && r.value.length) policy.git.forbiddenTrailers = r.value;
        break;
      case "large-binary":
        if (Array.isArray(r.value) && r.value.length) policy.git.largeBinaryGlobs = r.value;
        break;
      case "no-verify":
        policy.git.blockNoVerify = true;
        break;
      case "no-gpg-sign":
        policy.git.blockNoGpgSign = true;
        break;
      case "em-dash":
        policy.content.emDash = {
          enabled: true,
          allowNumericEnDash: r.value?.allowNumericEnDash !== false && policy.content.emDash.allowNumericEnDash !== false,
          scope: r.scopes || policy.content.emDash.scope || null,
        };
        break;
      case "banned-phrases": {
        const phrases = [...(policy.content.bannedPhrases.phrases || []), ...(r.value?.phrases || [])];
        policy.content.bannedPhrases = { enabled: true, phrases, scope: r.scopes || policy.content.bannedPhrases.scope || null };
        break;
      }
      case "secret-scan":
        policy.content.secretScan = deepMerge(policy.content.secretScan, { enabled: true });
        break;
      default:
        break;
    }
  }
  return policy;
}

// ---- workflow.config.yaml ----------------------------------------------------

function hooksConfigBlock(policy) {
  return {
    git: {
      protectedBranches: policy.git.protectedBranches,
      blockBypassFlags: policy.git.blockNoVerify !== false,
      requireSignedCommits: policy.git.blockNoGpgSign === true,
      branchPattern: policy.git.branchPattern || "",
      branchExceptions: policy.git.branchExceptions || [],
      ticketPattern: policy.git.ticketPattern || "",
      forbiddenTrailers: policy.git.forbiddenTrailers || [],
      largeBinaryGlobs: policy.git.largeBinaryGlobs || [],
    },
    content: policy.content,
    proactivity: policy.proactivity,
  };
}

// Assemble the config object the generic pipeline skills read. Pure mapping from
// answers; absent optional values keep the neutral default so a skill reports the
// step N/A rather than failing.
export function buildConfig(answers, approved, policy) {
  const gf = ans(answers, "branchNaming") || {};
  const tracker = ans(answers, "issueTracker") || {};
  const trailerRow = (approved.rows || []).find((r) => r.subject === "authorship-trailer" && r.stance === "require");
  return {
    projectName: ans(answers, "projectName") || answers?.machine?.git?.host || "Project",
    repos: (answers.repos || []).map((repo) => ({
      name: repo.name || "",
      path: repo.path || "",
      role: repo.role || "",
      testCmd: repo.commands?.testCmd ?? repo.testCmd ?? "",
      lintCmd: repo.commands?.lintCmd ?? repo.lintCmd ?? "",
      typeCheckCmd: repo.commands?.typeCheckCmd ?? repo.typeCheckCmd ?? "",
      buildCmd: repo.commands?.buildCmd ?? repo.buildCmd ?? "",
    })),
    branchNaming: {
      pattern: gf.creationTemplate || "{type}/{n}-{slug}",
      types: gf.types || ["feature", "fix", "chore"],
      protectedBranches: policy.git.protectedBranches,
    },
    pr: {
      baseBranch: gf.baseBranch || (policy.git.protectedBranches || ["main"])[0],
      squash: gf.mergeStrategy ? gf.mergeStrategy === "squash" : true,
      pairedPRs: (answers.repos || []).length > 1,
      commitTrailer: trailerRow?.value || "",
      prBodyFooter: "",
      forbiddenTrailers: policy.git.forbiddenTrailers || [],
    },
    issueTracker: {
      host: tracker.host || "none",
      repo: tracker.repo || "",
      labels: tracker.labels || [],
      milestones: tracker.milestones || [],
      ticketPattern: policy.git.ticketPattern || "",
    },
    investigate: ans(answers, "investigate") || { errorTracker: "", deployPlatform: "", prodDataQuery: "", codeNav: "" },
    auditAnchors: {
      scale: ans(answers, "auditAnchors.scale") || "solo",
      securityTiersInScope: ans(answers, "scale.security-tiers") || [1, 2],
    },
    execution: { maxParallelSubagents: 3, hasNamedAgentRegistry: true, hasHooks: true, cheapSubagentModel: "" },
    secondOpinion: { enabled: false, model: "" },
    conventionsDocs: answers?.machine?.conventionsDocs || ["CLAUDE.md"],
    hooks: hooksConfigBlock(policy),
  };
}

// ---- CLAUDE.md (facts) -------------------------------------------------------

export function buildClaudeMd(answers, approved) {
  const name = ans(answers, "projectName") || "Project";
  const lines = [`# ${name}`, "", "Project facts for the AI workflow. Generated by setup-harness from `harness.answers.yaml`; hand-edits are preserved on re-run (see `harness.manifest.json`).", ""];
  const repos = answers.repos || [];
  if (repos.length) {
    lines.push("## Repos", "");
    for (const repo of repos) lines.push(`- **${repo.name}**${repo.role ? ` (${repo.role})` : ""}${repo.path ? ` — \`${repo.path}\`` : ""}`);
    lines.push("");
  }
  const facts = rowsOfTier(approved, "FACT");
  if (facts.length) {
    lines.push("## Conventions", "");
    for (const f of facts) lines.push(`- ${f.rule}${f.source.startsWith("doc:") ? ` ([source](${f.source.slice(4)}))` : ""}`);
    lines.push("");
  }
  const tracker = ans(answers, "issueTracker");
  if (tracker?.host) lines.push("## Tracker", "", `- ${tracker.host}${tracker.repo ? ` — \`${tracker.repo}\`` : ""}`, "");
  lines.push("## Enforcement", "", "Deterministic rules are hook/lint-enforced (see `hooks.policy.json`); this file is facts only.", "");
  return lines.join("\n");
}

// ---- .claude/rules/*.md (rules + tool defaults) ------------------------------

export function buildRules(approved) {
  const artifacts = [];
  const ruleRows = rowsOfTier(approved, "RULE");
  const toolDefaults = ruleRows.filter((r) => r.subject === "tool-default");
  const others = ruleRows.filter((r) => r.subject !== "tool-default");
  if (toolDefaults.length) {
    const body = ["---", "description: Proactive tool defaults — reach for these by default, every session.", "---", "", "# Tool defaults", ""];
    for (const r of toolDefaults) body.push(`- ${r.rule}.`);
    artifacts.push({ path: ".claude/rules/tool-defaults.md", content: body.join("\n") + "\n", sourceRowIds: toolDefaults.map((r) => r.id) });
  }
  for (const r of others) {
    const src = r.source.startsWith("doc:") ? `\n\nSource: ${r.source.slice(4)}` : "";
    const body = ["---", `description: ${r.rule.slice(0, 100)}`, "---", "", `# ${r.rule}`, "", `${r.reason || "Project rule."}${src}`, ""].join("\n");
    artifacts.push({ path: `.claude/rules/${slug(r.rule)}.md`, content: body, sourceRowIds: [r.id] });
  }
  return artifacts;
}

// ---- lint scaffolds (strongest layer) ----------------------------------------

// Route each LINT row through the strongest-layer detector; emit the generated
// rule scaffold when a linter expresses it, else record a gap so the fallback
// (a content hook) is not silent.
export function buildLintArtifacts(approved, stack) {
  const artifacts = [];
  const gaps = [];
  for (const r of rowsOfTier(approved, "LINT")) {
    const descriptor = typeof r.value === "object" && r.value ? r.value : { kind: r.value };
    const routed = strongestLayerFor(descriptor, stack);
    if (routed.layer === "lint") {
      artifacts.push({
        path: `.harness/lint/${routed.linter}/${slug(r.rule)}.json`,
        content: JSON.stringify({ policy: descriptor, linter: routed.linter, artifact: routed.result.artifact, note: routed.result.note, wireUp: `Add this ${routed.linter} rule to the repo's lint config, then it fails CI.` }, null, 2) + "\n",
        sourceRowIds: [r.id],
        linter: routed.linter,
      });
    } else {
      gaps.push({ id: r.id, rule: r.rule, detail: `no linter on the detected stack expresses this — falls back to a content-scan hook (${routed.reason})` });
    }
  }
  return { artifacts, gaps };
}

// ---- skills (specialized + bespoke) ------------------------------------------

// Where each specializable skill's generic core body lives (relative to a
// vendored `_core/`), so the overlay points at the right file.
const CORE_BODY_PATH = { investigate: "ops/investigate.md", ship: "pipeline/ship.md" };

function specializedSkill(skillName, bindings, description) {
  const corePath = CORE_BODY_PATH[skillName] || `ops/${skillName}.md`;
  const filled = Object.entries(bindings || {}).filter(([, v]) => v).map(([k, v]) => `- **${k}**: ${v}`);
  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "---",
    "",
    `# ${skillName} (machine-specialized)`,
    "",
    "This overlay binds the generic core skill to this machine's tools. Run the core",
    `body with these bindings; where a binding is empty, use the core skill's fallback.`,
    "",
    "## Bindings",
    "",
    ...(filled.length ? filled : ["- (none captured — the core skill's generic fallback applies)"]),
    "",
    `> **Core body:** \`../_core/${corePath}\` (the vendored core path for this tool). Follow it verbatim, substituting the bindings above.`,
    "",
  ].join("\n");
}

function newSkill(flow) {
  const steps = (flow.steps || []).map((s, i) => `${i + 1}. ${s}`);
  const enforce = (flow.enforceable || []).map((e) => `- ${e} (proposed as a hook — see the decomposition)`);
  return [
    "---",
    `name: ${slug(flow.name)}`,
    `description: ${flow.trigger || flow.name}`,
    "---",
    "",
    `# ${flow.name}`,
    "",
    flow.trigger ? `**When:** ${flow.trigger}` : "",
    "",
    "## Steps",
    "",
    ...(steps.length ? steps : ["1. (describe the steps — captured from the interview)"]),
    "",
    ...(enforce.length ? ["## Enforced invariants", "", ...enforce, ""] : []),
  ].join("\n");
}

export function buildSkillArtifacts(approved) {
  const artifacts = [];
  for (const r of rowsOfTier(approved, "SKILL")) {
    const v = r.value || {};
    if (v.kind === "specialize") {
      artifacts.push({ path: `.claude/skills/${v.skill}/SKILL.md`, content: specializedSkill(v.skill, v.bindings || v.flow, r.rule), sourceRowIds: [r.id] });
    } else if (v.kind === "new" && v.flow?.name) {
      artifacts.push({ path: `.claude/skills/${slug(v.flow.name)}/SKILL.md`, content: newSkill(v.flow), sourceRowIds: [r.id] });
    }
  }
  return artifacts;
}

// ---- plan + write ------------------------------------------------------------

// Assemble every artifact into one write plan. `handEditable` marks the files a
// user is expected to refine (the manifest preserves those on re-run); the
// generated policy + config are AI-managed and overwritten.
export function planArtifacts(answers, approved, { stack = { linters: [] } } = {}) {
  const policy = buildHooksPolicy(approved);
  const config = buildConfig(answers, approved, policy);
  const lint = buildLintArtifacts(approved, stack);
  const plan = [
    { path: "hooks.policy.json", content: JSON.stringify(policy, null, 2) + "\n", kind: "policy", tier: "HOOK", handEditable: false, sourceRowIds: enforceRows(approved).map((r) => r.id) },
    { path: "workflow.config.yaml", content: toYaml(config), kind: "config", tier: "CONFIG", handEditable: false, sourceRowIds: [] },
    { path: "CLAUDE.md", content: buildClaudeMd(answers, approved), kind: "claude-md", tier: "FACT", handEditable: true, sourceRowIds: rowsOfTier(approved, "FACT").map((r) => r.id) },
    ...buildRules(approved).map((a) => ({ ...a, kind: "rule", tier: "RULE", handEditable: true })),
    ...lint.artifacts.map((a) => ({ ...a, kind: "lint", tier: "LINT", handEditable: true })),
    ...buildSkillArtifacts(approved).map((a) => ({ ...a, kind: "skill", tier: "SKILL", handEditable: true })),
  ];
  return { plan, policy, config, gaps: lint.gaps };
}

export function writeArtifacts(plan, root = process.cwd()) {
  const written = [];
  for (const artifact of plan) {
    const full = path.join(root, artifact.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, artifact.content);
    written.push(artifact.path);
  }
  return written;
}
