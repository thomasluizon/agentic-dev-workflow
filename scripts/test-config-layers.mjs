#!/usr/bin/env node
// Proof for the two-layer config (stage 7j) — plan section A: a machine-wide
// global config supplies defaults, each project overrides it, and a skill reads
// the merged (effective) config. Covers the pure resolver, the lossless split,
// on-disk resolution, the global-scope generation, the lean project slice, and
// the global enforcement wiring. Zero bash-isms; deterministic.
//
// Exits non-zero on any failure so CI gates on it.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfig, resolveConfigFrom, splitConfig, readConfig, CONFIG_FILENAME } from "../core/setup/config.mjs";
import { toYaml, fromYaml } from "../core/setup/answers.mjs";
import { decode } from "../core/setup/decode.mjs";
import { applyEdits } from "../core/setup/gate.mjs";
import { planArtifacts, planGlobalArtifacts } from "../core/setup/generate.mjs";
import { loadPolicy, deepMerge, DEFAULT_POLICY } from "../core/hooks/logic/config.mjs";
import { bootstrap, wireEnforcementHooks } from "./bootstrap.mjs";

let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);

const sortDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
};
const Equal = (name, a, b) => T(name, sortDeep(a), sortDeep(b));

const root = join(tmpdir(), "agentic-config-layers-proof");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

// ---------------------------------------------------------------------------
// 1. pure resolver — project overrides global, deep
// ---------------------------------------------------------------------------
console.log("# resolveConfigFrom — project overrides global");
const global = { branchNaming: { pattern: "TB-{n}", protectedBranches: ["main"] }, pr: { squash: false }, issueTracker: { host: "jira", driver: "jira-mcp" } };
const project = { projectName: "Acme", repos: [{ name: "web" }], pr: { squash: true }, issueTracker: { repo: "acme/web" } };
const eff = resolveConfigFrom(global, project);
T("resolve: global-only key survives", eff.branchNaming.pattern, "TB-{n}");
T("resolve: project-only key present", eff.projectName, "Acme");
T("resolve: project overrides a scalar (squash)", eff.pr.squash, true);
T("resolve: nested objects merge (tracker host + repo)", { h: eff.issueTracker.host, r: eff.issueTracker.repo, d: eff.issueTracker.driver }, { h: "jira", r: "acme/web", d: "jira-mcp" });
T("resolve: empty layers never throw", resolveConfigFrom(null, null), {});

// ---------------------------------------------------------------------------
// 2. a representative full config -> split -> lossless recombine
// ---------------------------------------------------------------------------
console.log("\n# splitConfig — lossless partition");
const answers = {
  version: 1,
  machine: { conventionsDocs: ["CLAUDE.md"], git: { host: "github" } },
  repos: [{ name: "web", path: "/p/web", role: "frontend", commands: { testCmd: "npm test", lintCmd: "npm run lint", typeCheckCmd: "", buildCmd: "npm run build" } }],
  answered: {
    projectName: "Nimbus",
    "auditAnchors.scale": "team",
    branchNaming: { creationTemplate: "TB-{n}", enforceRegex: "^TB-\\d+", protectedBranches: ["main", "release"], mergeStrategy: "rebase" },
    "gitFlow.coauthor": "banned",
    "gitFlow.coauthorTrailer": "Co-Authored-By",
    "hooks.content": { emDash: { enabled: true, scope: { include: ["**/*.md"] } } },
    toolDefaults: [{ tool: "aws", domain: "cloud ops", kind: "cli" }],
    issueTracker: { host: "github", repo: "nimbus/app", ticketPattern: "TB-\\d+", labels: [], milestones: [] },
  },
  docs: { links: [], sources: [], normativeStatements: [] },
  tracker: { host: "github", tool: { cli: "gh" } },
};
const approved = applyEdits(decode(answers, { stack: { linters: ["eslint"], languages: ["javascript"] } }), {});
const full = planArtifacts(answers, approved, { stack: { linters: ["eslint"], languages: ["javascript"] } }).config;
const { global: g, project: p } = splitConfig(full);

Truthy("split: global carries branchNaming (machine default)", g.branchNaming);
Truthy("split: global carries the enforcement mirror (hooks)", g.hooks);
T("split: global carries tracker host, NOT repo", { host: g.issueTracker.host, repo: g.issueTracker.repo }, { host: "github", repo: undefined });
Truthy("split: project carries repos[]", Array.isArray(p.repos) && p.repos.length === 1);
T("split: project carries tracker repo, NOT host", { host: p.issueTracker.host, repo: p.issueTracker.repo }, { host: undefined, repo: "nimbus/app" });
T("split: global has NO repos[] (that's project)", g.repos, undefined);
Equal("split: global+project recombine losslessly into the full config", resolveConfigFrom(g, p), full);

// ---------------------------------------------------------------------------
// 3. on-disk resolution honoring CLAUDE_CONFIG_DIR
// ---------------------------------------------------------------------------
console.log("\n# resolveConfig on disk");
const globalDir = join(root, "global-claude");
const projectDir = join(root, "proj");
mkdirSync(globalDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });
const prevEnv = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = globalDir;
writeFileSync(join(globalDir, CONFIG_FILENAME), toYaml(g));
writeFileSync(join(projectDir, CONFIG_FILENAME), toYaml(p));
const disk = resolveConfig(projectDir);
T("disk: project repo resolves from the project layer", disk.projectName, "Nimbus");
T("disk: branch pattern resolves from the global layer", disk.branchNaming.pattern, "TB-{n}");
Equal("disk: on-disk resolve equals the in-memory merge", disk, resolveConfigFrom(readConfig(join(globalDir, CONFIG_FILENAME)), readConfig(join(projectDir, CONFIG_FILENAME))));
if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
else process.env.CLAUDE_CONFIG_DIR = prevEnv;

// ---------------------------------------------------------------------------
// 4. planGlobalArtifacts — the machine-wide layer, no per-project files
// ---------------------------------------------------------------------------
console.log("\n# planGlobalArtifacts");
const globalPlan = planGlobalArtifacts(answers, approved);
const globalCfgArtifact = globalPlan.plan.find((a) => a.path === "workflow.config.yaml");
const globalCfg = fromYaml(globalCfgArtifact.content);
Truthy("global gen: emits a global workflow.config.yaml", Boolean(globalCfgArtifact));
Truthy("global gen: it carries the machine branch grammar", Boolean(globalCfg.branchNaming));
T("global gen: it carries NO repos[]", globalCfg.repos, undefined);
Truthy("global gen: emits a shared hooks.policy.json", globalPlan.plan.some((a) => a.path === "hooks.policy.json"));
Truthy("global gen: emits the tool-defaults rule under rules/ (not .claude/rules/)", globalPlan.plan.some((a) => a.path === "rules/tool-defaults.md"));
T("global gen: no CLAUDE.md / lint / project rules in the global layer", globalPlan.plan.some((a) => a.kind === "claude-md" || a.kind === "lint"), false);

// project-scope config artifact is the lean project slice
const leanPlan = planArtifacts(answers, approved, { stack: { linters: ["eslint"], languages: ["javascript"] }, configScope: "project" });
const leanCfg = fromYaml(leanPlan.plan.find((a) => a.path === "workflow.config.yaml").content);
T("project slice: lean config has repos[]", Array.isArray(leanCfg.repos), true);
T("project slice: lean config drops the machine branch grammar (lives global)", leanCfg.branchNaming, undefined);
Equal("project slice + global recombine into the full config", resolveConfigFrom(globalCfg, leanCfg), full);

// ---------------------------------------------------------------------------
// 5. loadPolicy already merges layers (global enforcement reads the effective policy)
// ---------------------------------------------------------------------------
console.log("\n# loadPolicy layering (regression)");
const polDir = join(root, "polproj");
mkdirSync(polDir, { recursive: true });
writeFileSync(join(polDir, "hooks.policy.json"), JSON.stringify({ git: { branchPattern: "^TB-\\d+" } }));
const merged = loadPolicy(polDir);
T("policy: project layer overrides the default branchPattern", merged.git.branchPattern, "^TB-\\d+");
T("policy: default protected branches survive the merge", merged.git.protectedBranches, ["main", "master"]);
T("policy: deepMerge is the same primitive both layers use", deepMerge(DEFAULT_POLICY, { git: { branchPattern: "x" } }).git.branchPattern, "x");

// ---------------------------------------------------------------------------
// 6. global enforcement wiring — opt-in, matcher-aware, idempotent
// ---------------------------------------------------------------------------
console.log("\n# wireEnforcementHooks");
const claudeDir = join(root, "enf", ".claude");
mkdirSync(claudeDir, { recursive: true });
const w1 = wireEnforcementHooks(claudeDir);
T("enforce: wires both guardrails on first run", w1.added.sort(), ["content-guard.mjs", "git-guardrails.mjs"]);
const s = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
Truthy("enforce: git-guardrails on PreToolUse(Bash)", s.hooks.PreToolUse.some((e) => e.matcher === "Bash" && e.hooks.some((h) => h.command.includes("git-guardrails.mjs"))));
Truthy("enforce: content-guard on PostToolUse(Edit|Write|MultiEdit)", s.hooks.PostToolUse.some((e) => e.matcher === "Edit|Write|MultiEdit" && e.hooks.some((h) => h.command.includes("content-guard.mjs"))));
const w2 = wireEnforcementHooks(claudeDir);
T("enforce: re-wiring adds nothing (idempotent)", w2.added, []);

// bootstrap opt-in: --enforce-globally wires the guardrails during install
const enfHome = join(root, "enf-home", ".claude");
const rpt = bootstrap({ claudeDir: enfHome, wireHooks: true, enforceGlobally: true, generatedAt: "2026-01-02T00:00:00Z", ref: "test" });
Truthy("bootstrap --enforce-globally: enforcement hooks wired at install", rpt.enforcement.added.includes("git-guardrails.mjs") && rpt.enforcement.added.includes("content-guard.mjs"));
// default bootstrap (no opt-in, no global policy) leaves enforcement OFF
const plainHome = join(root, "plain-home", ".claude");
const plain = bootstrap({ claudeDir: plainHome, wireHooks: true, generatedAt: "2026-01-02T00:00:00Z", ref: "test" });
T("bootstrap default: enforcement NOT wired without opt-in or a global policy", plain.enforcement.added, []);
// but once a global policy exists, a re-run auto-wires it
writeFileSync(join(plainHome, "hooks.policy.json"), JSON.stringify({ git: { branchPattern: "^X-\\d+" } }));
const plain2 = bootstrap({ claudeDir: plainHome, wireHooks: true, generatedAt: "2026-01-03T00:00:00Z", ref: "test" });
Truthy("bootstrap: a re-run auto-wires enforcement once a global policy is present", plain2.enforcement.added.length === 2);

rmSync(root, { recursive: true, force: true });
console.log(`\n${fails === 0 ? "CONFIG-LAYERS PROOF OK" : `CONFIG-LAYERS PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
