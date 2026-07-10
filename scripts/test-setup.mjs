#!/usr/bin/env node
// Proof for the setup-harness detection + interview machinery (stage 7c). Runs
// each module against real inputs — the pack's own repo for detection, throwaway
// fixture trees for command-inference and repo-discovery, and in-memory objects
// for the question set, the answers YAML round-trip, the tracker driver, and the
// doc normative-extractor. Exits non-zero on any failure so CI gates on it.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectOs, whichCli, detectGit, detectCi, detectConventionsDocs, detectMcpServers, hostFromRemoteUrl } from "../core/setup/detect.mjs";
import { inferCommands } from "../core/setup/commands.mjs";
import { discoverWorkspaceMembers, scanProjectsRoot, discoverRepos } from "../core/setup/discovery.mjs";
import { CORE_QUESTIONS, SECTIONS, expressQuestions, nextUnanswered, activeFollowups } from "../core/setup/questions.mjs";
import { toYaml, fromYaml, emptyAnswers, writeAnswers, readAnswers, setAnswer, recordNormative } from "../core/setup/answers.mjs";
import { resolveTracker } from "../core/setup/trackers.mjs";
import { extractNormativeStatements, classifyDocSource, partitionDocInputs } from "../core/setup/docs.mjs";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);

const root = join(tmpdir(), "agentic-setup-proof");
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

// ---------------------------------------------------------------------------
// 1. detect — read-only machine detection
// ---------------------------------------------------------------------------
console.log("# detect");
Truthy("detect: os has platform", detectOs().platform);
Truthy("detect: os has node version", detectOs().node);
Truthy("detect: git resolves (this repo is a git repo)", whichCli("git"));
T("detect: host from github url", hostFromRemoteUrl("git@github.com:x/y.git"), "github");
T("detect: host from gitlab url", hostFromRemoteUrl("https://gitlab.com/x/y.git"), "gitlab");
T("detect: host from azure url", hostFromRemoteUrl("https://dev.azure.com/org/proj/_git/y"), "azure");
T("detect: host from bitbucket url", hostFromRemoteUrl("git@bitbucket.org:x/y.git"), "bitbucket");
T("detect: host from unknown url", hostFromRemoteUrl("https://example.com/x/y.git"), "unknown");
T("detect: host from empty url", hostFromRemoteUrl(""), null);
T("detect: pack repo is a git repo", detectGit(packRoot).isRepo, true);
Truthy("detect: ci finds the pack's github workflow", detectCi(packRoot).some((c) => c.host === "github"));
Truthy("detect: conventions docs finds README", detectConventionsDocs(packRoot).includes("README.md"));
Truthy("detect: mcp servers returns an array", Array.isArray(detectMcpServers()));

// ---------------------------------------------------------------------------
// 2. commands — inference from manifests (never executed)
// ---------------------------------------------------------------------------
console.log("\n# commands");
const nodeRepo = fixture("node-repo", {
  "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", build: "next build" } }),
  "package-lock.json": "{}",
});
const nc = inferCommands(nodeRepo);
T("commands: npm test", nc.commands.testCmd, "npm test");
T("commands: npm run lint", nc.commands.lintCmd, "npm run lint");
T("commands: npm run typecheck", nc.commands.typeCheckCmd, "npm run typecheck");
T("commands: npm run build", nc.commands.buildCmd, "npm run build");
T("commands: node stack + npm pm", [nc.stack.includes("node"), nc.packageManager], [true, "npm"]);
T("commands: high confidence for named script", nc.inferred.testCmd.confidence, "high");

const pnpmRepo = fixture("pnpm-repo", {
  "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
});
T("commands: pnpm run test", inferCommands(pnpmRepo).commands.testCmd, "pnpm run test");

const dotnetRepo = fixture("dotnet-repo", { "Api.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>" });
const dc = inferCommands(dotnetRepo);
T("commands: dotnet test/build", [dc.commands.testCmd, dc.commands.buildCmd], ["dotnet test", "dotnet build"]);
T("commands: dotnet stack", dc.stack, ["dotnet"]);

const pyRepo = fixture("py-repo", {
  "pyproject.toml": "[build-system]\nrequires=[]\n[tool.ruff]\n[tool.pytest.ini_options]\n[tool.mypy]\n",
});
const pc = inferCommands(pyRepo);
T("commands: python steps", [pc.commands.testCmd, pc.commands.lintCmd, pc.commands.typeCheckCmd], ["pytest", "ruff check .", "mypy ."]);

const makeRepo = fixture("make-repo", { "Makefile": "test:\n\tgo test ./...\nlint:\n\tgolangci-lint run\n" });
T("commands: make targets", [inferCommands(makeRepo).commands.testCmd, inferCommands(makeRepo).commands.lintCmd], ["make test", "make lint"]);

T("commands: empty repo skips every step", inferCommands(fixture("empty-repo", {})).commands, { testCmd: "", lintCmd: "", typeCheckCmd: "", buildCmd: "" });

// ---------------------------------------------------------------------------
// 3. discovery — current repo + workspace members + projects-root scan
// ---------------------------------------------------------------------------
console.log("\n# discovery");
const monorepo = fixture("monorepo", {
  "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
  "apps/web/package.json": "{}",
  "apps/mobile/package.json": "{}",
  "packages/shared/package.json": "{}",
});
const members = discoverWorkspaceMembers(monorepo).map((m) => m.name).sort();
T("discovery: workspace members expanded", members, ["mobile", "shared", "web"]);

const projectsRoot = fixture("projects-root", {
  "repo-a/.git/HEAD": "ref: refs/heads/main",
  "repo-b/.git/HEAD": "ref: refs/heads/main",
  "not-a-repo/readme.txt": "x",
});
const siblings = scanProjectsRoot(projectsRoot).map((s) => s.name).sort();
T("discovery: scans sibling repos, skips non-repos", siblings, ["repo-a", "repo-b"]);
T("discovery: discoverRepos current repo is the pack", discoverRepos({ dir: packRoot }).current.isRepo, true);

// ---------------------------------------------------------------------------
// 4. questions — the fixed core set, express subset, resume, adaptivity
// ---------------------------------------------------------------------------
console.log("\n# questions");
T("questions: core set has 13 sections", CORE_QUESTIONS.length, 13);
const expectedSections = ["Install mode", "Scale", "Projects-root + repos", "Per-repo test/lint/typecheck/build", "VCS host + tracker", "Git-flow", "Text / style bans", "Code-level policies", "Tool defaults", "Doc sources", "Prod-investigation workflow", "Deploy / ship flow", "Bespoke flows"];
T("questions: every section-F topic present", SECTIONS, expectedSections);
T("questions: express essentials = mode/repos/commands/tracker/git-flow", expressQuestions().map((q) => q.id), ["installMode", "repos", "commands", "vcsTracker", "gitFlow"]);
T("questions: resume picks first unanswered", nextUnanswered(CORE_QUESTIONS, ["installMode", "scale"]).id, "repos");
const modeQ = CORE_QUESTIONS.find((q) => q.id === "installMode");
T("questions: repo-clean unlocks the store-location followup", activeFollowups(modeQ, { answers: { installMode: "repo-clean" } }).some((f) => f.id === "installMode.repoClean"), true);
T("questions: in-repo mode hides the repo-clean followup", activeFollowups(modeQ, { answers: { installMode: "in-repo" } }).length, 0);
T("questions: resume returns null when all answered", nextUnanswered(CORE_QUESTIONS, CORE_QUESTIONS.map((q) => q.id)), null);
const scaleQ = CORE_QUESTIONS.find((q) => q.id === "scale");
T("questions: enterprise scale unlocks security-tier followup", activeFollowups(scaleQ, { answers: { "auditAnchors.scale": "enterprise" } }).some((f) => f.id === "scale.security-tiers"), true);
T("questions: solo scale hides security-tier followup", activeFollowups(scaleQ, { answers: { "auditAnchors.scale": "solo" } }).length, 0);
const trackerQ = CORE_QUESTIONS.find((q) => q.id === "vcsTracker");
T("questions: atlassian MCP unlocks jira-key followup", activeFollowups(trackerQ, { detect: { mcpServers: ["atlassian"] } }).some((f) => f.id === "vcsTracker.jira-key"), true);
const reposQ = CORE_QUESTIONS.find((q) => q.id === "repos");
T("questions: workspace members unlock monorepo-scope followup", activeFollowups(reposQ, { detect: { workspaceMembers: [{ name: "web" }] } }).some((f) => f.id === "repos.monorepo-scope"), true);

// ---------------------------------------------------------------------------
// 5. answers — YAML round-trip + incremental resumable writes
// ---------------------------------------------------------------------------
console.log("\n# answers");
const sample = {
  version: 1,
  mode: "thorough",
  ok: true,
  missing: null,
  tags: ["a", "b-c", "d.e"],
  empty: [],
  repos: [
    { name: "web", path: "/absolute/path/to/web", commands: { testCmd: "npm test", lintCmd: "eslint: run" } },
    { name: "api", path: "C:/proj/api", commands: { testCmd: "dotnet test" } },
  ],
  answered: { "auditAnchors.scale": "solo", "gitFlow.coauthor": "banned" },
  note: "has: a colon, a #hash, and \"quotes\"",
};
T("answers: yaml round-trips deep", fromYaml(toYaml(sample)), sample);

const answersFile = join(root, "harness.answers.yaml");
writeAnswers(answersFile, emptyAnswers("express", "2026-01-01T00:00:00Z"));
setAnswer(answersFile, "auditAnchors.scale", "team");
setAnswer(answersFile, "repos", [{ name: "web", path: "/x", role: "frontend" }]);
const reloaded = readAnswers(answersFile);
T("answers: incremental scalar persisted", reloaded.answered["auditAnchors.scale"], "team");
T("answers: repos list mirrored to top-level", reloaded.repos[0].name, "web");
T("answers: progress tracks answered ids for resume", reloaded.progress.answeredIds, ["auditAnchors.scale", "repos"]);
recordNormative(answersFile, "https://docs.example.com/git", [{ text: "Never force-push to main.", strength: "hard" }, { text: "Never force-push to main.", strength: "hard" }]);
T("answers: normative statements deduped on record", readAnswers(answersFile).docs.normativeStatements.length, 1);

// ---------------------------------------------------------------------------
// 6. trackers — per-tracker best-tool resolution by availability
// ---------------------------------------------------------------------------
console.log("\n# trackers");
const ghCli = resolveTracker("github", { clis: { gh: true } });
T("trackers: github prefers its CLI when present", [ghCli.resolved, ghCli.tool.cli], [true, "gh"]);
T("trackers: github falls to MCP when no CLI", resolveTracker("github", { clis: {}, mcp: ["github"] }).tool.kind, "mcp");
T("trackers: github uses web fallback when nothing wired", resolveTracker("github", {}).usingFallback, true);
T("trackers: jira prefers atlassian MCP over CLI", resolveTracker("jira", { clis: { jira: true }, mcp: ["atlassian"] }).tool.kind, "mcp");
T("trackers: jira uses CLI when only CLI present", resolveTracker("jira", { clis: { jira: true } }).tool.cli, "jira");
T("trackers: linear resolves via MCP", resolveTracker("linear", { mcp: ["linear"] }).resolved, true);
T("trackers: linear falls back to web without MCP", resolveTracker("linear", {}).usingFallback, true);

// ---------------------------------------------------------------------------
// 7. docs — normative extraction + source classification
// ---------------------------------------------------------------------------
console.log("\n# docs");
const docText = [
  "# Engineering standards",
  "- You must reference a ticket in every commit.",
  "- Secrets should never be committed.",
  "- We prefer trunk-based development.",
  "This paragraph is just background context with no rule.",
].join("\n");
const extracted = extractNormativeStatements(docText);
Truthy("docs: extracts the hard 'must' rule", extracted.statements.some((s) => /must reference a ticket/i.test(s.text) && s.strength === "hard"));
Truthy("docs: extracts the hard 'never' rule", extracted.statements.some((s) => /never be committed/i.test(s.text) && s.strength === "hard"));
Truthy("docs: extracts the soft 'prefer' rule as soft", extracted.statements.some((s) => /trunk-based/i.test(s.text) && s.strength === "soft"));
Truthy("docs: ignores the non-normative background line", !extracted.statements.some((s) => /background context/i.test(s.text)));
T("docs: classifies a specific page URL as a link", classifyDocSource("https://wiki.example.com/pages/12345/Git-Flow").kind, "link");
T("docs: classifies a confluence space URL as a source", classifyDocSource("https://wiki.example.com/wiki/spaces/ENG").kind, "source");
T("docs: classifies a bare space key as a source", classifyDocSource("ENG").medium, "space-key");
T("docs: classifies an org/repo as a source", classifyDocSource("acme/handbook").medium, "repo");
const partitioned = partitionDocInputs(["https://wiki.example.com/pages/1/Page", "ENG"]);
T("docs: partitions inputs into links + sources", [partitioned.links.length, partitioned.sources.length], [1, 1]);

rmSync(root, { recursive: true, force: true });

console.log(`\n${fails === 0 ? "SETUP MACHINERY PROOF OK" : `SETUP MACHINERY PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
