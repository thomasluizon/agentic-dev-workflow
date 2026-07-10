#!/usr/bin/env node
// Proof for the setup-harness decode -> gate -> generate machinery (stage 7d).
// Exercises the second half of the installer against real inputs: the worked-
// example acceptance table (each free-form rule -> its tier), conflict flagging,
// the editable gate table round-trip, the generators (policy/config/CLAUDE.md/
// rules/lint/skills), adopt-vs-reset backup + decompose, the versioned manifest +
// hand-edit detection, and the post-generation self-verify (incl. the guardrail
// dry-run: the GENERATED policy must block a protected-branch push). Exits
// non-zero on any failure so CI gates on it.

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyStatement, decode, TIERS } from "../core/setup/decode.mjs";
import { renderGateTable, parseGateTable, applyEdits, pendingConflicts } from "../core/setup/gate.mjs";
import { buildHooksPolicy, buildConfig, buildClaudeMd, buildRules, buildLintArtifacts, buildSkillArtifacts, planArtifacts, writeArtifacts } from "../core/setup/generate.mjs";
import { backupExisting, decomposeExisting, backupPathFor } from "../core/setup/adopt.mjs";
import { buildManifest, writeManifest, readManifest, detectHandEdits, hashContent } from "../core/setup/manifest.mjs";
import { run as selfVerify, guardrailDryRun } from "../core/setup/verify.mjs";
import { fromYaml, toYaml, writeAnswers, readAnswers } from "../core/setup/answers.mjs";
import { detectStack } from "../core/hooks/lint-generators/detect.mjs";

let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);

const root = join(tmpdir(), "agentic-generate-proof");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const fixture = (name, files) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
};

const nodeStack = { linters: ["eslint"], languages: ["javascript"] };
const bareStack = { linters: [] };

// ---------------------------------------------------------------------------
// 1. decode — the worked-example acceptance table (free-form rule -> tier)
// ---------------------------------------------------------------------------
console.log("# decode: acceptance table");
T("em dash -> HOOK/em-dash", pick(classifyStatement("never use EM dashes")), [TIERS.HOOK, "em-dash"]);
T("TB-#### branch -> HOOK/branch-name", pick(classifyStatement("always create the branch with a TB-1234 Jira issue number", { stack: nodeStack })), [TIERS.HOOK, "branch-name"]);
T("never co-author -> HOOK/forbidden-trailer", pick(classifyStatement("never co-author commits / PRs")), [TIERS.HOOK, "forbidden-trailer"]);
T("required co-author -> FACT", classifyStatement("always add a co-authored-by trailer").tier, TIERS.FACT);
T("AWS CLI -> RULE (tool default)", classifyStatement("always use the AWS CLI").tier, TIERS.RULE);
T("Jira MCP -> RULE (tool default)", classifyStatement("always use the Jira MCP").tier, TIERS.RULE);
T("ticket ref -> HOOK/ticket-ref", pick(classifyStatement("you must reference a ticket in every commit")), [TIERS.HOOK, "ticket-ref"]);
T("secrets -> HOOK/secret-scan", pick(classifyStatement("secrets must never be committed")), [TIERS.HOOK, "secret-scan"]);
T("no-console on a linted stack -> LINT", classifyStatement("no console logging in production", { stack: nodeStack }).tier, TIERS.LINT);
T("no-console on a bare stack -> HOOK fallback", classifyStatement("no console logging in production", { stack: bareStack }).tier, TIERS.HOOK);
T("soft 'prefer' -> FACT", classifyStatement("we prefer trunk-based development", { strength: "soft" }).tier, TIERS.FACT);

// A Confluence doc's normative statements are each decoded to their own tier
// (decompose-each), never treated as one opaque "use these docs" rule.
console.log("\n# decode: per-statement decomposition + zero leakage");
const nodeRepo = fixture("acme-web", {
  "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "next build" }, devDependencies: { eslint: "^9" } }),
  "package-lock.json": "{}",
});
const answers = buildAnswers(nodeRepo);
const decoded = decode(answers, { stack: detectStack(nodeRepo) });
Truthy("decode: em-dash doc statement -> a HOOK row", decoded.rows.some((r) => r.templateId === "em-dash" && r.source.startsWith("doc:")));
Truthy("decode: ticket doc statement -> a ticket-ref HOOK row", decoded.rows.some((r) => r.templateId === "ticket-ref"));
Truthy("decode: secret doc statement -> a secret-scan HOOK row", decoded.rows.some((r) => r.templateId === "secret-scan"));
Truthy("decode: AWS CLI -> a tool-default RULE row", decoded.rows.some((r) => r.subject === "tool-default" && /aws/i.test(r.rule)));
Truthy("decode: Jira MCP tracker -> a RULE + a tracker CONFIG row", decoded.rows.some((r) => r.subject === "tool-default" && /mcp/i.test(r.rule)) && decoded.rows.some((r) => r.subject === "tracker"));
Truthy("decode: bespoke flow -> a SKILL row", decoded.rows.some((r) => r.tier === TIERS.SKILL && r.value?.kind === "new"));
Truthy("decode: investigate bindings -> a specialized SKILL row", decoded.rows.some((r) => r.value?.kind === "specialize" && r.value?.skill === "investigate"));
T("decode: branch-name row carries the interview regex", decoded.rows.find((r) => r.id === "gitflow.branch-name")?.value, "^TB-\\d+");

// ---------------------------------------------------------------------------
// 2. decode — conflict flagged, never auto-resolved (always-ask precedence)
// ---------------------------------------------------------------------------
console.log("\n# decode: conflicts (always-ask)");
Truthy("decode: interview-bans vs doc-requires trailer -> a conflict", decoded.conflicts.some((c) => c.subject === "authorship-trailer"));
Truthy("decode: both conflicting rows survive (nothing auto-resolved)", decoded.rows.filter((r) => r.subject === "authorship-trailer").length >= 2);
Truthy("decode: conflicting rows are flagged inline", decoded.rows.filter((r) => r.subject === "authorship-trailer").every((r) => r.conflicts.length > 0));

// ---------------------------------------------------------------------------
// 3. gate — render + parse round-trip, apply edits (drop/soften), pending
// ---------------------------------------------------------------------------
console.log("\n# gate");
const gateMd = renderGateTable(decoded, { projectName: "Acme" });
Truthy("gate: renders one Markdown table", /\| ID \| Rule \|/.test(gateMd));
Truthy("gate: conflicts get a resolve-before-go banner", /Conflicts — resolve/.test(gateMd));
const parsedEdits = parseGateTable(gateMd);
T("gate: parse round-trips every row's tier/action", Object.keys(parsedEdits).length, decoded.rows.length);
T("gate: an unedited row parses to its proposed action", parsedEdits["gitflow.protected-ref"], { tier: "HOOK", action: "enforce" });

const docTrailerRow = decoded.rows.find((r) => r.subject === "authorship-trailer" && r.source.startsWith("doc:"));
const resolved = applyEdits(decoded, { [docTrailerRow.id]: { action: "drop" } });
T("gate: dropping the losing row clears the conflict", pendingConflicts(resolved).length, 0);
Truthy("gate: the dropped row is recorded, not silently gone", resolved.dropped.some((r) => r.id === docTrailerRow.id));
const softened = applyEdits(decoded, { "content.em-dash": { action: "soften" } });
T("gate: softening a HOOK downgrades it to an advisory RULE", softened.rows.find((r) => r.id === "content.em-dash")?.tier, "RULE");

// ---------------------------------------------------------------------------
// 4. generate — policy / config / CLAUDE.md / rules / lint (strongest layer)
// ---------------------------------------------------------------------------
console.log("\n# generate");
const approved = applyEdits(decoded, { [docTrailerRow.id]: { action: "drop" } });
const policy = buildHooksPolicy(approved);
T("generate: branch pattern filled from the interview", policy.git.branchPattern, "^TB-\\d+");
T("generate: protected branches filled", policy.git.protectedBranches, ["main", "release"]);
T("generate: forbidden trailer filled from the banned-trailer answer", policy.git.forbiddenTrailers, ["Co-authored-by"]);
T("generate: ticket pattern filled", policy.git.ticketPattern, "\\bTB-\\d+\\b");
T("generate: em-dash rule enabled with its scope", [policy.content.emDash.enabled, policy.content.emDash.scope.include], [true, ["**/*.md"]]);

const config = buildConfig(answers, approved, policy);
T("generate: config round-trips through the YAML emitter", fromYaml(toYaml(config)).repos.length, 1);
T("generate: merge strategy -> pr.squash", config.pr.squash, true);
T("generate: banned trailer mirrored into config", config.pr.forbiddenTrailers, ["Co-authored-by"]);
T("generate: tracker host carried to config", config.issueTracker.host, "jira");
T("generate: resolved tracker tool surfaced as issueTracker.driver", config.issueTracker.driver, "Jira MCP");
Truthy("generate: CLAUDE.md carries the project + repo facts", /Acme/.test(buildClaudeMd(answers, approved)) && /acme-web/.test(buildClaudeMd(answers, approved)));
Truthy("generate: tool-defaults rule file written", buildRules(approved).some((a) => a.path.endsWith("tool-defaults.md") && /AWS CLI/.test(a.content)));

const lintNode = buildLintArtifacts(approved, detectStack(nodeRepo));
Truthy("generate: a no-console policy -> a real eslint rule (strongest layer)", lintNode.artifacts.some((a) => a.linter === "eslint"));
const bareApproved = applyEdits(decode(buildAnswers(nodeRepo), { stack: bareStack }), {});
const lintBare = buildLintArtifacts(bareApproved, bareStack);
T("generate: no linter on the stack -> a recorded gap, not a silent drop", lintBare.gaps.length >= 0, true);
Truthy("generate: bespoke flow -> a proposed SKILL.md", buildSkillArtifacts(approved).some((a) => /release-runbook/.test(a.path)));
Truthy("generate: investigate -> a machine-specialized SKILL.md", buildSkillArtifacts(approved).some((a) => a.path.includes("investigate") && /Sentry/.test(a.content)));

// A regex is nothing but backslashes; it must survive the harness.answers.yaml
// file round-trip the runbook actually uses, not just an in-memory object.
const answersFile = join(root, "roundtrip.answers.yaml");
writeAnswers(answersFile, answers);
const reread = readAnswers(answersFile);
T("generate: a branch regex survives the answers YAML file round-trip", reread.answered.branchNaming.enforceRegex, "^TB-\\d+");
T("generate: the round-tripped regex still fills the policy", buildHooksPolicy(applyEdits(decode(reread, { stack: detectStack(nodeRepo) }), {})).git.branchPattern, "^TB-\\d+");

// ---------------------------------------------------------------------------
// 5. adopt-vs-reset — backup + decompose existing content (nothing lost)
// ---------------------------------------------------------------------------
console.log("\n# adopt");
const bloated = fixture("bloated", {
  "CLAUDE.md": "# Old\n\n- Never commit secrets to the repo.\n- Always use the internal CLI.\n- We prefer small PRs.\n",
  ".claude/rules/style.md": "- Never use em dashes.\n",
  ".claude/hooks/legacy.mjs": "export default 1;\n",
});
const backup = backupExisting(bloated, "2026-01-02T00-00-00Z");
T("adopt: backs up the existing artifacts", backup.backedUp.sort(), [".claude/hooks", ".claude/rules", "CLAUDE.md"]);
Truthy("adopt: backup copy exists on disk", existsSync(join(bloated, backupPathFor("2026-01-02T00-00-00Z"), "CLAUDE.md")));
const decomposed = decomposeExisting(bloated);
Truthy("adopt: old prose becomes decode candidates", decomposed.candidates.some((c) => /secrets/i.test(c.text)));
Truthy("adopt: existing hooks reported as already-enforced", decomposed.existingHooks.some((h) => /legacy\.mjs$/.test(h)));
Truthy("adopt: decomposed candidates re-tier via decode", decode({ answered: {}, docs: {} }, { existing: decomposed.candidates }).rows.some((r) => r.templateId === "secret-scan"));

// ---------------------------------------------------------------------------
// 6. end-to-end write + manifest + self-verify (the guardrail dry-run)
// ---------------------------------------------------------------------------
console.log("\n# generate -> write -> verify");
const project = join(root, "project");
mkdirSync(project, { recursive: true });
const planned = planArtifacts(answers, approved, { stack: detectStack(nodeRepo) });
const written = writeArtifacts(planned.plan, project);
Truthy("write: hooks.policy.json + workflow.config.yaml written", written.includes("hooks.policy.json") && written.includes("workflow.config.yaml"));

const manifest = buildManifest(planned.plan, { answersHash: hashContent(JSON.stringify(answers)), generatedAt: "2026-01-02T00:00:00Z" });
writeManifest(project, manifest);
Truthy("manifest: records every artifact traceable to answers", readManifest(project).artifacts.length === planned.plan.length && readManifest(project).answersHash.length === 64);
writeFileSync(join(project, "CLAUDE.md"), readFileSync(join(project, "CLAUDE.md"), "utf8") + "\n<!-- hand edit -->\n");
const edits = detectHandEdits(project, manifest);
T("manifest: a hand-edited CLAUDE.md is detected as such", edits.handEdited, ["CLAUDE.md"]);
Truthy("manifest: the AI-managed policy is unchanged (safe to overwrite)", edits.unchanged.includes("hooks.policy.json"));

const verified = selfVerify(project, { plan: planned.plan, gaps: planned.gaps, conflicts: pendingConflicts(approved), deferred: approved.dropped });
const guardrail = verified.checks.find((c) => c.name.includes("protected branch"));
Truthy("verify: the GENERATED policy blocks a push to a protected branch", guardrail?.pass);
Truthy("verify: an ordinary feature push is allowed", verified.checks.find((c) => c.name.includes("feature push"))?.pass);
Truthy("verify: --no-verify is blocked", verified.checks.find((c) => c.name.includes("--no-verify"))?.pass);
Truthy("verify: an off-convention branch is blocked", verified.checks.find((c) => c.name.includes("off-convention"))?.pass);
Truthy("verify: an em dash in scoped copy is caught", verified.checks.find((c) => c.name.includes("em dash"))?.pass);
Truthy("verify: config + policy parse", verified.checks.find((c) => c.name === "config parses")?.pass && verified.checks.find((c) => c.name === "policy parses")?.pass);
Truthy("verify: reports pass/fail per check", verified.checks.length >= 6 && typeof verified.allPassed === "boolean");

// ---------------------------------------------------------------------------
// 7. never-block — malformed / empty inputs degrade, never throw
// ---------------------------------------------------------------------------
console.log("\n# never-block");
T("never-block: decode of an empty record yields no rows, no throw", decode({}).rows.length, 0);
T("never-block: guardrail dry-run on an empty policy does not throw", Array.isArray(guardrailDryRun({})), true);
T("never-block: self-verify of a nonexistent project reports failures, no throw", typeof selfVerify(join(root, "does-not-exist")).allPassed, "boolean");

rmSync(root, { recursive: true, force: true });
console.log(`\n${fails === 0 ? "GENERATE MACHINERY PROOF OK" : `GENERATE MACHINERY PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);

// ---- helpers ----------------------------------------------------------------

function pick(classified) {
  return [classified.tier, classified.templateId];
}

// The interview record the decode + generators run against — a representative job
// machine whose policy is the OPPOSITE of the reference (bans co-authoring,
// TB-#### branches, Jira). No pack constant is assumed; every value is here.
function buildAnswers(repoPath) {
  return {
    version: 1,
    mode: "thorough",
    machine: { conventionsDocs: ["CLAUDE.md"], git: { host: "github" } },
    repos: [{ name: "acme-web", path: repoPath, role: "frontend", commands: { testCmd: "npm test", lintCmd: "npm run lint", typeCheckCmd: "", buildCmd: "npm run build" } }],
    answered: {
      projectName: "Acme",
      "auditAnchors.scale": "team",
      branchNaming: { creationTemplate: "{type}/{n}-{slug}", enforceRegex: "^TB-\\d+", protectedBranches: ["main", "release"], mergeStrategy: "squash", exceptions: ["hotfix/*"] },
      "gitFlow.coauthor": "banned",
      "gitFlow.coauthorTrailer": "Co-authored-by",
      "gitFlow.bypass": "block",
      "hooks.content": { emDash: { enabled: true, scope: { include: ["**/*.md"] } } },
      codePolicies: [{ id: "no-console", text: "No console logging in production", kind: "no-console", language: "javascript" }],
      toolDefaults: [{ tool: "AWS CLI", domain: "cloud ops", kind: "cli" }],
      issueTracker: { host: "jira", repo: "acme/backlog", ticketPattern: "\\bTB-\\d+\\b", labels: [], milestones: [] },
      investigate: { errorTracker: "Sentry MCP (org acme)", deployPlatform: "", prodDataQuery: "", codeNav: "" },
      bespokeFlows: [{ name: "Release Runbook", trigger: "cutting a release", steps: ["tag the release", "deploy", "announce"], enforceable: [] }],
    },
    docs: {
      links: [],
      sources: [],
      normativeStatements: [
        { source: "https://wiki.acme/eng/git", text: "You must reference a ticket in every commit.", strength: "hard" },
        { source: "https://wiki.acme/eng/style", text: "Never use em dashes in docs.", strength: "hard" },
        { source: "https://wiki.acme/eng/git", text: "Always add a co-authored-by trailer to commits.", strength: "hard" },
        { source: "https://wiki.acme/eng/sec", text: "Secrets must never be committed to the repo.", strength: "hard" },
      ],
    },
    tracker: { host: "jira", tool: { kind: "mcp" } },
  };
}
