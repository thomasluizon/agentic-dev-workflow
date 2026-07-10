#!/usr/bin/env node
// Proof for the dual-target hook engine. Two layers:
//   1. Logic-core unit checks — the pure invariants in isolation.
//   2. End-to-end — vendor the pack into a temp project (real install layout),
//      then run the REAL Claude Code hook AND the REAL opencode plugin against
//      simulated payloads. The same rule, off the same logic core, must block
//      in both tools and allow the benign case in both.
// Exits non-zero on any failure so CI gates on it.

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendor } from "./install.mjs";
import { evaluateGitCommand } from "../core/hooks/logic/git-action.mjs";
import { scanContent } from "../core/hooks/logic/content-scan.mjs";
import { globToRegExp, inScope } from "../core/hooks/logic/scope.mjs";
import { DEFAULT_POLICY } from "../core/hooks/logic/config.mjs";
import { fromClaudeCode, fromOpenCode } from "../core/hooks/logic/payload.mjs";
import { TEMPLATES, gateTable } from "../core/hooks/templates.mjs";
import { strongestLayerFor } from "../core/hooks/lint-generators/index.mjs";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const NV = "--no-" + "verify";

// ---------------------------------------------------------------------------
// 1. Logic core
// ---------------------------------------------------------------------------
console.log("# logic core");
const gp = DEFAULT_POLICY.git;
T("git: push protected blocked", !!evaluateGitCommand("git push origin main", gp)?.blocked, true);
T("git: push feature allowed", evaluateGitCommand("git push origin feature/x", gp), null);
T("git: no-verify blocked", evaluateGitCommand("git commit -m x " + NV, gp)?.rule, "no-verify");
T("git: commit -n blocked", evaluateGitCommand("git commit -n -m x", gp)?.rule, "no-verify");
T("git: force push protected", evaluateGitCommand("git push -f origin main", gp)?.rule, "force-push-protected");
T("git: branch pattern blocked", evaluateGitCommand("git checkout -b wip", { ...gp, branchPattern: "^(feature|fix)/" })?.rule, "branch-name");
T("git: branch exception allowed", evaluateGitCommand("git checkout -b hotfix/1", { ...gp, branchPattern: "^(feature|fix)/", branchExceptions: ["hotfix/*"] }), null);
T("git: forbidden trailer blocked", evaluateGitCommand('git commit -m "x\n\nBanned-Trailer: a"', { ...gp, forbiddenTrailers: ["Banned-Trailer"] })?.rule, "forbidden-trailer");
T("git: ticket-ref missing blocked", evaluateGitCommand('git commit -m "add thing"', { ...gp, ticketPattern: "[A-Z]+-\\d+" })?.rule, "ticket-ref");
T("git: ticket-ref present allowed", evaluateGitCommand('git commit -m "AB-12 add thing"', { ...gp, ticketPattern: "[A-Z]+-\\d+" }), null);
T("git: bare push on protected", evaluateGitCommand("git push", gp, { resolveHeadBranch: () => "main", cwd: "." })?.rule, "push-protected");
T("git: bare push on feature allowed", evaluateGitCommand("git push", gp, { resolveHeadBranch: () => "feature/x", cwd: "." }), null);
T("git: large binary add blocked", evaluateGitCommand("git add video.mp4", { ...gp, largeBinaryGlobs: ["*.mp4"] })?.rule, "large-binary");

const cp = { emDash: { enabled: true }, secretScan: { enabled: true } };
T("content: em dash flagged", scanContent("we shipped it — today", cp, "a.md").length, 1);
T("content: numeric en-dash allowed", scanContent("range 1–10 items", cp, "a.md").length, 0);
T("content: secret flagged", scanContent("k=AKIAABCDEFGHIJKLMNOP", cp, "a.ts").some((f) => f.rule === "secret"), true);
T("content: secret excluded in test path", scanContent("AKIAABCDEFGHIJKLMNOP", { secretScan: { enabled: true, scope: { exclude: ["**/*.test.*"] } } }, "x.test.ts").length, 0);
T("content: banned phrase flagged", scanContent("this is a synergy leverage", { bannedPhrases: { enabled: true, phrases: ["synergy"] } }, "a.md").length, 1);

T("scope: ** matches deep", globToRegExp("apps/**/x.ts").test("apps/a/b/x.ts"), true);
T("scope: {a,b} alternation", globToRegExp("*.{md,txt}").test("readme.md"), true);
T("scope: exclude wins", inScope("CHANGELOG.md", { exclude: ["CHANGELOG.md"] }), false);

T("payload: cc bash normalized", fromClaudeCode({ tool_name: "Bash", tool_input: { command: "git push" } }).kind, "git");
T("payload: cc edit addedText", fromClaudeCode({ tool_name: "Edit", tool_input: { file_path: "a.ts", new_string: "hi" } }).addedText, "hi");
T("payload: oc bash normalized", fromOpenCode("bash", { command: "git push" }).kind, "git");
T("payload: oc write addedText", fromOpenCode("write", { filePath: "a.ts", content: "hi" }).addedText, "hi");

T("templates: registry size", TEMPLATES.length, 11);
T("templates: gate rows", gateTable().length, 11);

// lint generators — strongest layer routing + fallback
T("lint: js console -> eslint", strongestLayerFor({ kind: "no-console", language: "javascript" }, { linters: ["eslint"] }).layer, "lint");
T("lint: csharp severity -> roslyn", strongestLayerFor({ kind: "severity", diagnosticId: "CA1822", language: "csharp" }, { linters: ["roslyn"] }).layer, "lint");
T("lint: python print -> ruff", strongestLayerFor({ kind: "no-print", language: "python" }, { linters: ["ruff"] }).layer, "lint");
T("lint: text ban -> hook fallback", strongestLayerFor({ kind: "ban-text" }, { linters: ["eslint"] }).layer, "hook");
T("lint: no stack -> hook fallback", strongestLayerFor({ kind: "no-console" }, { linters: [] }).layer, "hook");

// ---------------------------------------------------------------------------
// 2. End-to-end: vendor + run the real adapters in both tools
// ---------------------------------------------------------------------------
console.log("\n# end-to-end (vendored adapters)");
const root = join(tmpdir(), "agentic-hook-engine-proof");
rmSync(root, { recursive: true, force: true });

const testPolicy = {
  git: { protectedBranches: ["main"] },
  content: { emDash: { enabled: true, scope: null } },
};

function setup(tool) {
  const into = join(root, tool);
  mkdirSync(into, { recursive: true });
  vendor({ tool, into });
  writeFileSync(join(into, "hooks.policy.json"), JSON.stringify(testPolicy));
  return into;
}

// --- Claude Code: run the real hook files with stdin payloads ---
const cc = setup("claude-code");
function runCcHook(file, payload) {
  const res = spawnSync(process.execPath, [join(cc, ".claude", "hooks", file)], {
    input: JSON.stringify({ ...payload, cwd: cc }),
    encoding: "utf8",
  });
  return { status: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
}
T("cc hook: push protected -> exit 2", runCcHook("git-guardrails.mjs", { tool_name: "Bash", tool_input: { command: "git push origin main" } }).status, 2);
T("cc hook: push feature -> exit 0", runCcHook("git-guardrails.mjs", { tool_name: "Bash", tool_input: { command: "git push origin feature/x" } }).status, 0);
T("cc hook: no-verify -> exit 2", runCcHook("git-guardrails.mjs", { tool_name: "Bash", tool_input: { command: "git commit -m x " + NV } }).status, 2);
T("cc hook: em dash write -> exit 2", runCcHook("content-guard.mjs", { tool_name: "Write", tool_input: { file_path: join(cc, "notes.md"), content: "we shipped — today" } }).status, 2);
T("cc hook: clean write -> exit 0", runCcHook("content-guard.mjs", { tool_name: "Write", tool_input: { file_path: join(cc, "notes.md"), content: "we shipped today" } }).status, 0);
const reminder = runCcHook("proactivity-reminder.mjs", { hook_event_name: "UserPromptSubmit" });
T("cc hook: reminder injects context", /additionalContext/.test(reminder.stdout) && /verify/i.test(reminder.stdout), true);

// --- opencode: import the real plugin and drive tool.execute.before ---
const oc = setup("opencode");
// Node imports a .js as CJS without a package.json type:module; copy to .mjs so
// this test can import the ESM plugin. opencode itself loads the .js natively.
const pluginMjs = join(oc, ".opencode", "plugin", "agentic-harness.probe.mjs");
cpSync(join(oc, ".opencode", "plugin", "agentic-harness.js"), pluginMjs);
const plugin = (await import(pathToFileURL(pluginMjs).href)).default;
const hooks = await plugin({ directory: oc });
async function ocBlocks(tool, args) {
  try {
    await hooks["tool.execute.before"]({ tool }, { args });
    return false;
  } catch {
    return true;
  }
}
T("oc plugin: push protected throws", await ocBlocks("bash", { command: "git push origin main" }), true);
T("oc plugin: push feature allowed", await ocBlocks("bash", { command: "git push origin feature/x" }), false);
T("oc plugin: em dash write throws", await ocBlocks("write", { filePath: join(oc, "notes.md"), content: "we shipped — today" }), true);
T("oc plugin: clean write allowed", await ocBlocks("write", { filePath: join(oc, "notes.md"), content: "we shipped today" }), false);
T("oc plugin: exposes session.idle guard", typeof hooks["event"], "function");

rmSync(root, { recursive: true, force: true });

console.log(`\n${fails === 0 ? "HOOK ENGINE PROOF OK" : `HOOK ENGINE PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
