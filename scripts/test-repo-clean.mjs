#!/usr/bin/env node
// Proof for Stage 8 — the REPO-CLEAN (global-only) install mode. On a machine
// where the repo working dir must stay pristine, setup writes the whole overlay
// to an out-of-repo store under ~/.claude, keyed by git root, and delivers it at
// runtime. This drives that end to end against a temp HOME + two fixture git repos
// and asserts the acceptance contract:
//
//   1. repo-clean setup writes ZERO files inside the repo;
//   2. the effective config + policy + facts resolve for that repo FROM the store;
//   3. enforcement BLOCKS a protected-branch push (a feature push passes) via the
//      store policy — using the SAME logic core the runtime hooks use;
//   4. the CC injector (the real vendored hook) emits repo1's facts and NO-OPS for
//      an unrelated repo2;
//   5. the opencode injector (the real plugin's system.transform hook) does the same;
//   6. a linked worktree of repo1 resolves to repo1's store entry;
//   7. repo2 is unaffected (no store entry -> defaults, injector no-ops);
//   8. bootstrap wires the global install + fact injector + enforcement machine-wide;
//   9. the store-aware sync re-applies the overlay from the store, remapped.
//
// Zero bash-isms; deterministic; exits non-zero on any failure so CI gates on it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  resolveRepoRoot, slugForPath, storeRoot, storeEntryDir, registerStoreEntry,
  readStorePolicy, readIndex, listStoreEntries, buildInjectedContext,
} from "../core/hooks/logic/store.mjs";
import { resolveConfig, readStoreConfig } from "../core/setup/config.mjs";
import { loadPolicy } from "../core/hooks/logic/config.mjs";
import { decode } from "../core/setup/decode.mjs";
import { applyEdits } from "../core/setup/gate.mjs";
import { planArtifacts, writeArtifacts } from "../core/setup/generate.mjs";
import { buildManifest, writeManifest } from "../core/setup/manifest.mjs";
import { writeAnswers, ANSWERS_FILENAME } from "../core/setup/answers.mjs";
import { evaluateGitCommand } from "../core/hooks/logic/git-action.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { reapplyOverlay } from "./sync.mjs";

let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);

const packRoot = join(import.meta.dirname, "..");
const base = join(tmpdir(), "agentic-repo-clean-proof");
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });

// The store honors CLAUDE_CONFIG_DIR — point every in-process store read at a temp
// HOME so nothing touches the real ~/.claude.
const claudeDir = join(base, "home", ".claude");
mkdirSync(claudeDir, { recursive: true });
const prevEnv = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeDir;

// ---- fixture git repos -------------------------------------------------------

function gitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  const g = (args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  g(["config", "user.email", "t@example.com"]);
  g(["config", "user.name", "Test"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "init"]);
  return resolveRepoRoot(dir);
}

const repo1Root = gitRepo(join(base, "repos", "repo1"));
const repo2Root = gitRepo(join(base, "repos", "repo2"));

// ---- 0. bootstrap the global install (repo-clean requires it) ----------------

console.log("# bootstrap — global install + fact injector + enforcement");
const boot = bootstrap({ claudeDir, wireHooks: true, enforceGlobally: true, generatedAt: "2026-02-01T00:00:00Z", ref: "test" });
Truthy("bootstrap: fact injector wired (project-facts.mjs)", boot.factsInjector.added.includes("project-facts.mjs"));
Truthy("bootstrap: enforcement wired machine-wide", boot.enforcement.added.includes("git-guardrails.mjs") && boot.enforcement.added.includes("content-guard.mjs"));
Truthy("bootstrap: the CC injector hook is vendored", existsSync(join(claudeDir, "hooks", "project-facts.mjs")));
Truthy("bootstrap: the store logic core is vendored", existsSync(join(claudeDir, "skills", "_core", "hooks", "logic", "store.mjs")));

// ---- 1. repo-clean setup writes ZERO files in the repo -----------------------

console.log("\n# repo-clean setup — generate into the store, nothing in the repo");
const answers = {
  version: 1,
  mode: "thorough",
  machine: { conventionsDocs: ["CLAUDE.md"], git: { host: "github" } },
  repos: [{ name: "app", path: repo1Root, role: "backend", commands: { testCmd: "npm test", lintCmd: "npm run lint" } }],
  answered: {
    installMode: "repo-clean",
    projectName: "Cleanroom",
    branchNaming: { creationTemplate: "TB-{n}", enforceRegex: "^TB-\\d+", protectedBranches: ["main"], mergeStrategy: "rebase" },
    "hooks.content": { emDash: { enabled: true, scope: { include: ["**/*.md"] } } },
    toolDefaults: [{ tool: "aws", domain: "cloud ops", kind: "cli" }],
    issueTracker: { host: "github", repo: "acme/app" },
  },
  docs: { links: [], sources: [], normativeStatements: [] },
  tracker: { host: "github", tool: { cli: "gh" } },
};
const stack = { linters: [], languages: [] };
const approved = applyEdits(decode(answers, { stack }), {});
const { plan } = planArtifacts(answers, approved, { stack, layout: "store" });

const entry = registerStoreEntry(repo1Root, { mode: "repo-clean" });
const entryDir = entry.entryDir;
writeArtifacts(plan, entryDir);
writeAnswers(join(entryDir, ANSWERS_FILENAME), answers);
writeManifest(entryDir, buildManifest(plan, { answersHash: "h", generatedAt: "2026-02-01T00:00:00Z" }));

const repo1Files = readdirSync(repo1Root).sort();
T("repo-clean: repo dir holds ONLY its own files (no harness artifacts)", repo1Files, [".git", "README.md"]);
for (const leaked of ["CLAUDE.md", ".claude", "workflow.config.yaml", "hooks.policy.json", ANSWERS_FILENAME, "harness.manifest.json"]) {
  T(`repo-clean: no ${leaked} in the repo`, existsSync(join(repo1Root, leaked)), false);
}
Truthy("store: entry dir lives under ~/.claude/harness", entryDir.startsWith(storeRoot()));
T("store: index.json keys the entry by absolute repo root", Object.keys(readIndex()), [repo1Root]);
T("store: index records repo-clean mode + the deterministic slug", { mode: readIndex()[repo1Root].mode, slug: readIndex()[repo1Root].slug }, { mode: "repo-clean", slug: slugForPath(repo1Root) });
Truthy("store: facts.md written (CLAUDE.md remapped)", existsSync(join(entryDir, "facts.md")));
Truthy("store: hooks.policy.json + workflow.config.yaml written", existsSync(join(entryDir, "hooks.policy.json")) && existsSync(join(entryDir, "workflow.config.yaml")));
T("store: no .claude/ path leaked into the store plan", plan.some((a) => a.path.startsWith(".claude/")), false);

// ---- 2. config + policy + facts resolve for repo1 FROM the store -------------

console.log("\n# resolution from the store");
const cfg1 = resolveConfig(repo1Root);
T("config: resolveConfig reads the store project name", cfg1.projectName, "Cleanroom");
Truthy("config: resolveConfig reads the store repos[]", Array.isArray(cfg1.repos) && cfg1.repos.length === 1);
Truthy("config: readStoreConfig returns the parsed store config", readStoreConfig(repo1Root)?.projectName === "Cleanroom");
const pol1 = loadPolicy(repo1Root);
T("policy: loadPolicy reads the store branch pattern", pol1.git.branchPattern, "^TB-\\d+");
T("policy: loadPolicy reads the store protected branches", pol1.git.protectedBranches, ["main"]);
Truthy("policy: readStorePolicy resolves the entry directly", readStorePolicy(repo1Root)?.git?.branchPattern === "^TB-\\d+");
Truthy("facts: buildInjectedContext returns repo1 facts", (buildInjectedContext(repo1Root) || "").includes("Cleanroom"));

// ---- 3. enforcement BLOCKS a protected-branch push via the store policy -------

console.log("\n# enforcement via the store policy");
const blocked = evaluateGitCommand("git push origin main", pol1.git);
Truthy("enforce: a protected-branch push is BLOCKED by the store policy", blocked?.blocked);
T("enforce: it fires the push-protected rule", blocked?.rule, "push-protected");
const allowed = evaluateGitCommand("git push origin feature/x-1", pol1.git);
T("enforce: an ordinary feature push passes", allowed, null);
const offBranch = evaluateGitCommand("git checkout -b nope-not-matching", pol1.git);
Truthy("enforce: an off-convention branch name is blocked", offBranch?.blocked);

// ---- 4. the REAL vendored CC injector: facts for repo1, no-op for repo2 -------

console.log("\n# CC injector (the vendored UserPromptSubmit hook)");
const hookPath = join(claudeDir, "hooks", "project-facts.mjs");
const runHook = (cwd) =>
  execFileSync("node", [hookPath], { input: JSON.stringify({ cwd }), env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, encoding: "utf8" });
const out1 = runHook(repo1Root);
Truthy("CC injector: emits additionalContext for repo1", out1.includes("additionalContext") && out1.includes("Cleanroom"));
const parsed1 = JSON.parse(out1);
T("CC injector: uses the UserPromptSubmit envelope", parsed1.hookSpecificOutput?.hookEventName, "UserPromptSubmit");
const out2 = runHook(repo2Root);
T("CC injector: NO-OPS (empty output) for an unrelated repo2", out2.trim(), "");

// ---- 5. the REAL opencode injector plugin: same verdict ----------------------

console.log("\n# opencode injector (the plugin's experimental.chat.system.transform)");
const pluginMod = await import(pathToFileURL(join(packRoot, "adapters", "opencode", "plugin", "agentic-harness.js")).href);
const hooks1 = await pluginMod.default({ directory: repo1Root, worktree: repo1Root });
const sys1 = { system: [] };
await hooks1["experimental.chat.system.transform"]({}, sys1);
T("oc injector: pushes exactly one system entry for repo1", sys1.system.length, 1);
Truthy("oc injector: the entry carries repo1's facts", (sys1.system[0] || "").includes("Cleanroom"));
const hooks2 = await pluginMod.default({ directory: repo2Root, worktree: repo2Root });
const sys2 = { system: [] };
await hooks2["experimental.chat.system.transform"]({}, sys2);
T("oc injector: NO push for an unrelated repo2", sys2.system.length, 0);

// ---- 6. a linked worktree of repo1 resolves to repo1's store entry -----------

console.log("\n# linked worktree resolution");
const worktree = join(base, "worktrees", "repo1-wt");
execFileSync("git", ["-C", repo1Root, "worktree", "add", "-q", "-b", "wt-branch", worktree], { stdio: "ignore" });
T("worktree: resolveRepoRoot follows the .git FILE to the main root", resolveRepoRoot(worktree), repo1Root);
T("worktree: it maps to repo1's store entry dir", storeEntryDir(resolveRepoRoot(worktree)), entryDir);
Truthy("worktree: loadPolicy from the worktree reads repo1's store policy", loadPolicy(worktree)?.git?.branchPattern === "^TB-\\d+");
Truthy("worktree: the CC injector emits repo1 facts from the worktree", runHook(worktree).includes("Cleanroom"));

// ---- 7. repo2 is unaffected --------------------------------------------------

console.log("\n# repo2 is untouched");
T("repo2: no store entry", storeEntryDir(repo2Root) && existsSync(storeEntryDir(repo2Root)), false);
T("repo2: buildInjectedContext is null (no facts to inject)", buildInjectedContext(repo2Root), null);
T("repo2: loadPolicy falls back to the safe defaults", loadPolicy(repo2Root).git.protectedBranches, ["main", "master"]);
T("repo2: resolveConfig is empty (no store, no in-repo, no global)", resolveConfig(repo2Root), {});
T("store: only one entry registered", listStoreEntries().length, 1);

// ---- 8. store-aware sync re-applies from the store, remapped ------------------

console.log("\n# store-aware sync");
const synced = reapplyOverlay(entryDir, { generatedAt: "2026-03-01T00:00:00Z", layout: "store" });
Truthy("sync: re-applies facts.md from the store", synced.written.includes("facts.md"));
T("sync: never remaps back to a .claude/ path", synced.written.some((p) => p.startsWith(".claude/")), false);
T("repo-clean after sync: STILL zero files in the repo", readdirSync(repo1Root).sort(), [".git", "README.md"]);

// ---- cleanup -----------------------------------------------------------------

execFileSync("git", ["-C", repo1Root, "worktree", "remove", "--force", worktree], { stdio: "ignore" });
if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
else process.env.CLAUDE_CONFIG_DIR = prevEnv;
rmSync(base, { recursive: true, force: true });

console.log(`\n${fails === 0 ? "REPO-CLEAN PROOF OK" : `REPO-CLEAN PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
