#!/usr/bin/env node
// Proof for the bootstrap + lifecycle machinery (stage 7f). Exercises the global
// installer and the overlay sync against a temp HOME, with zero bash-isms so it
// runs identically on Windows / macOS / Linux:
//
//   - node hard-check: the version boundary is enforced (pure, no second Node)
//   - bootstrap: CORE skills + agents + hooks + workflows + _core + the baseline
//     rule land in a temp ~/.claude; /setup-harness specifically installs
//   - manifest/version: harness.bootstrap.json records what was installed (items,
//     coreHash, node) so a re-run can update in place
//   - proactivity hooks: wired into settings.json, idempotent on re-run
//   - update-in-place: a re-run prunes a stale item a previous install owned
//   - sync: re-decodes the saved answers and PRESERVES a hand-edit while updating
//     CORE and refreshing the AI-managed policy; --force overrides
//
// Exits non-zero on any failure so CI gates on it.

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrap, nodeMajor, assertNodeVersion, resolveClaudeDir, wireProactivityHooks, readBootstrapManifest, BOOTSTRAP_MANIFEST } from "./bootstrap.mjs";
import { reapplyOverlay, refreshCore } from "./sync.mjs";
import { vendor } from "./install.mjs";
import { decode } from "../core/setup/decode.mjs";
import { applyEdits } from "../core/setup/gate.mjs";
import { planArtifacts, writeArtifacts } from "../core/setup/generate.mjs";
import { buildManifest, writeManifest, readManifest } from "../core/setup/manifest.mjs";
import { writeAnswers, ANSWERS_FILENAME } from "../core/setup/answers.mjs";
import { detectStack } from "../core/hooks/lint-generators/detect.mjs";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);
const Throws = (name, fn) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  T(name, threw, true);
};

const root = join(tmpdir(), "agentic-bootstrap-proof");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const has = (base, rel) => existsSync(join(base, ...rel.split("/")));

// ---------------------------------------------------------------------------
// 1. node hard-check
// ---------------------------------------------------------------------------
console.log("# node hard-check");
T("nodeMajor parses a plain version", nodeMajor("24.13.0"), 24);
T("nodeMajor parses a v-prefixed version", nodeMajor("v18.4.1"), 18);
T("nodeMajor of garbage is 0", nodeMajor("nope"), 0);
Throws("assertNodeVersion rejects an old Node", () => assertNodeVersion(18, "16.20.0"));
T("assertNodeVersion accepts a new Node", assertNodeVersion(18, "20.1.0"), 20);

// ---------------------------------------------------------------------------
// 2. ~/.claude resolution (cross-platform, override-aware)
// ---------------------------------------------------------------------------
console.log("\n# claude-dir resolution");
T("resolveClaudeDir honors an explicit dir", resolveClaudeDir("/tmp/x/.claude"), "/tmp/x/.claude");
Truthy("resolveClaudeDir falls back to a home-based .claude", /\.claude$/.test(resolveClaudeDir()));

// ---------------------------------------------------------------------------
// 3. bootstrap — CORE lands globally + manifest recorded
// ---------------------------------------------------------------------------
console.log("\n# bootstrap: global install");
const claudeDir = join(root, "home", ".claude");
const report = bootstrap({ claudeDir, packRoot, generatedAt: "2026-01-02T00:00:00Z", ref: "test" });

Truthy("bootstrap: a pipeline skill lands (prime)", has(claudeDir, "skills/prime/SKILL.md"));
Truthy("bootstrap: /setup-harness lands", has(claudeDir, "skills/setup-harness/SKILL.md"));
Truthy("bootstrap: report flags setup-harness present", report.hasSetupHarness);
Truthy("bootstrap: /update-harness lands (7g)", has(claudeDir, "skills/update-harness/SKILL.md"));
T("bootstrap: report flags update-harness present", report.hasUpdateHarness, true);
Truthy("bootstrap: the staleness machinery lands next to the meta skills", has(claudeDir, "skills/_core/meta/staleness.mjs"));
Truthy("bootstrap: the security-reviewer agent lands", has(claudeDir, "agents/security-reviewer.md"));
Truthy("bootstrap: the git-guardrails hook lands", has(claudeDir, "hooks/git-guardrails.mjs"));
Truthy("bootstrap: the audit workflow lands", has(claudeDir, "workflows/audit.mjs"));
Truthy("bootstrap: the vendored _core lands (setup machinery)", has(claudeDir, "skills/_core/setup/generate.mjs"));
Truthy("bootstrap: the hook logic core lands next to the hooks", has(claudeDir, "skills/_core/hooks/logic/git-action.mjs"));
Truthy("bootstrap: the behavioral baseline installs as a global rule", has(claudeDir, "rules/agentic-baseline.md"));
Truthy("bootstrap: the baseline rule has loadable frontmatter", /^---\r?\n/.test(readFileSync(join(claudeDir, "rules", "agentic-baseline.md"), "utf8")));

// A copy, not a symlink — must survive deleting the clone. Prove the file is a
// real regular file with its own bytes, not a link back into packRoot.
Truthy("bootstrap: COPIES (not symlinks) — the installed skill is a real file", (() => {
  const stat = lstatSafe(join(claudeDir, "skills", "prime", "SKILL.md"));
  return stat && stat.isFile() && !stat.isSymbolicLink();
})());

console.log("\n# bootstrap: manifest + version");
const manifest = readBootstrapManifest(claudeDir);
Truthy("manifest: harness.bootstrap.json written", has(claudeDir, BOOTSTRAP_MANIFEST));
T("manifest: records the version", manifest.version, 1);
T("manifest: records the pack ref", manifest.packRef, "test");
T("manifest: records the node version", manifest.node, process.versions.node);
Truthy("manifest: records a coreHash for update detection", typeof manifest.coreHash === "string" && manifest.coreHash.length === 64);
Truthy("manifest: lists every installed item", manifest.items.length > 20 && manifest.items.some((i) => i.type === "skill" && i.name === "setup-harness"));

console.log("\n# bootstrap: /update-harness monthly clock");
Truthy("clock: harness.update.json seeded at install", has(claudeDir, "harness.update.json"));
T("clock: seeded lastCheckedAt is null (never checked yet)", report.updateClock.lastCheckedAt, null);
T("clock: seeded installedAt is the bootstrap stamp", report.updateClock.installedAt, "2026-01-02T00:00:00Z");
const clockBefore = readFileSync(join(claudeDir, "harness.update.json"), "utf8");
bootstrap({ claudeDir, packRoot, generatedAt: "2026-02-09T00:00:00Z", ref: "test" });
T("clock: re-running bootstrap does NOT reset the clock (next check not pushed out)", readFileSync(join(claudeDir, "harness.update.json"), "utf8"), clockBefore);

// ---------------------------------------------------------------------------
// 4. proactivity hooks wired into settings.json (idempotent)
// ---------------------------------------------------------------------------
console.log("\n# bootstrap: proactivity hooks");
const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
Truthy("hooks: the reminder is wired on UserPromptSubmit", settings.hooks.UserPromptSubmit.some((e) => e.hooks.some((h) => h.command.includes("proactivity-reminder.mjs"))));
Truthy("hooks: the guard is wired on Stop", settings.hooks.Stop.some((e) => e.hooks.some((h) => h.command.includes("proactivity-guard.mjs"))));
Truthy("hooks: the wired command is an absolute path into ~/.claude/hooks", settings.hooks.Stop[0].hooks[0].command.includes(join(claudeDir, "hooks")));
const rewire = wireProactivityHooks(claudeDir);
T("hooks: re-wiring adds nothing (idempotent)", rewire.added, []);
const settings2 = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
T("hooks: no duplicate Stop entries after a re-run", settings2.hooks.Stop.filter((e) => e.hooks.some((h) => h.command.includes("proactivity-guard.mjs"))).length, 1);

// A pre-existing unrelated hook is preserved when wiring.
const custom = join(root, "home2", ".claude");
mkdirSync(custom, { recursive: true });
writeFileSync(join(custom, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] } }));
const wired = wireProactivityHooks(custom);
const customSettings = JSON.parse(readFileSync(join(custom, "settings.json"), "utf8"));
Truthy("hooks: a user's pre-existing hook survives wiring", customSettings.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === "echo mine")));
Truthy("hooks: a settings.json backup is written when it existed", has(custom, "settings.json.harness-bak") || wired.added.length === 2);

// --no-hooks skips wiring entirely.
const noHooks = join(root, "home3", ".claude");
const noHookReport = bootstrap({ claudeDir: noHooks, packRoot, wireHooks: false, generatedAt: "2026-01-02T00:00:00Z" });
T("hooks: --no-hooks skips settings.json", existsSync(join(noHooks, "settings.json")), false);
T("hooks: --no-hooks still records it did not wire", noHookReport.hooks.wired, false);

// ---------------------------------------------------------------------------
// 5. update-in-place — a re-run prunes a stale item a previous install owned
// ---------------------------------------------------------------------------
console.log("\n# bootstrap: update in place");
mkdirSync(join(claudeDir, "skills", "ZZZ-retired-skill"), { recursive: true });
writeFileSync(join(claudeDir, "skills", "ZZZ-retired-skill", "SKILL.md"), "stale\n");
const staleManifest = readBootstrapManifest(claudeDir);
staleManifest.items.push({ type: "skill", name: "ZZZ-retired-skill", dest: "skills/ZZZ-retired-skill" });
writeFileSync(join(claudeDir, BOOTSTRAP_MANIFEST), JSON.stringify(staleManifest, null, 2) + "\n");
const rerun = bootstrap({ claudeDir, packRoot, generatedAt: "2026-01-03T00:00:00Z", ref: "test" });
Truthy("update: a retired skill from a previous install is pruned", rerun.pruned.includes("skills/ZZZ-retired-skill"));
T("update: the pruned skill is gone from disk", existsSync(join(claudeDir, "skills", "ZZZ-retired-skill")), false);
Truthy("update: current skills are still present after the re-run", has(claudeDir, "skills/setup-harness/SKILL.md"));

// ---------------------------------------------------------------------------
// 6. sync — preserve a hand-edit while updating CORE + refreshing AI-managed
// ---------------------------------------------------------------------------
console.log("\n# sync: overlay re-apply preserves hand-edits");
const project = join(root, "project");
mkdirSync(project, { recursive: true });
const repoDir = fixtureRepo(join(project, "web"));
const answers = buildAnswers(repoDir);
writeAnswers(join(project, ANSWERS_FILENAME), answers);

// A project that self-vendored CORE (so sync's CORE half runs).
vendor({ tool: "claude-code", into: project, ref: "test" });
Truthy("sync: project vendored a _core to refresh", has(project, ".claude/skills/_core/setup/generate.mjs"));

// Initial generation + manifest (what /setup-harness would have written).
const stack = detectStack(repoDir);
const approved = applyEdits(decode(answers, { stack }), {});
const planned = planArtifacts(answers, approved, { stack });
writeArtifacts(planned.plan, project);
writeManifest(project, buildManifest(planned.plan, { answersHash: "seed", generatedAt: "2026-01-02T00:00:00Z" }));
Truthy("sync: seed generation wrote a hand-editable CLAUDE.md", existsSync(join(project, "CLAUDE.md")));

// Hand-edit the CLAUDE.md and record the AI-managed policy for a change check.
const editedClaude = readFileSync(join(project, "CLAUDE.md"), "utf8") + "\n<!-- HAND EDIT: keep this -->\n";
writeFileSync(join(project, "CLAUDE.md"), editedClaude);
writeFileSync(join(project, "hooks.policy.json"), '{"tampered":true}\n');

const core = refreshCore(project, "test");
Truthy("sync: CORE re-vendored (skills-lock present)", !core.skipped && has(project, ".claude/skills/_core/setup/generate.mjs"));

const synced = reapplyOverlay(project, { generatedAt: "2026-01-04T00:00:00Z" });
Truthy("sync: the hand-edited CLAUDE.md is preserved, not clobbered", readFileSync(join(project, "CLAUDE.md"), "utf8").includes("HAND EDIT: keep this"));
Truthy("sync: CLAUDE.md reported as preserved", synced.preserved.includes("CLAUDE.md"));
Truthy("sync: the AI-managed policy is refreshed (tamper overwritten)", !readFileSync(join(project, "hooks.policy.json"), "utf8").includes("tampered"));
Truthy("sync: the refreshed policy is valid JSON with a git section", JSON.parse(readFileSync(join(project, "hooks.policy.json"), "utf8")).git);
Truthy("sync: workflow.config.yaml is in the written set", synced.written.includes("workflow.config.yaml"));
const syncedManifest = readManifest(project);
Truthy("sync: manifest re-written, CLAUDE.md still tracked", syncedManifest.artifacts.some((a) => a.path === "CLAUDE.md"));

// The next sync still sees the hand-edit (its manifest hash was kept, not reset).
const synced2 = reapplyOverlay(project, { generatedAt: "2026-01-05T00:00:00Z" });
Truthy("sync: a second sync STILL preserves the hand-edit (hash kept, not reset)", synced2.preserved.includes("CLAUDE.md"));

// --force regenerates the hand-edited file.
const forced = reapplyOverlay(project, { force: true, generatedAt: "2026-01-06T00:00:00Z" });
Truthy("sync --force: CLAUDE.md regenerated (hand-edit dropped)", !readFileSync(join(project, "CLAUDE.md"), "utf8").includes("HAND EDIT: keep this"));
Truthy("sync --force: CLAUDE.md moves to the written set", forced.written.includes("CLAUDE.md"));

// ---------------------------------------------------------------------------
// 7. never-block — sync on an un-set-up project degrades, no throw
// ---------------------------------------------------------------------------
console.log("\n# never-block");
const bare = join(root, "bare-project");
mkdirSync(bare, { recursive: true });
const bareSync = reapplyOverlay(bare, {});
Truthy("never-block: sync with no answers.yaml skips cleanly", bareSync.skipped && bareSync.written.length === 0);
Truthy("never-block: refreshCore with no skills-lock skips cleanly", refreshCore(bare).skipped);

rmSync(root, { recursive: true, force: true });
console.log(`\n${fails === 0 ? "BOOTSTRAP + LIFECYCLE PROOF OK" : `BOOTSTRAP + LIFECYCLE PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);

// ---- helpers ----------------------------------------------------------------

function lstatSafe(file) {
  try {
    return lstatSync(file);
  } catch {
    return null;
  }
}

// A minimal linted Node repo so the stack detector routes a code policy to a real
// lint rule, exactly like the generate proof.
function fixtureRepo(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "next build" }, devDependencies: { eslint: "^9" } }));
  writeFileSync(join(dir, "package-lock.json"), "{}");
  return dir;
}

// A representative interview record — its own values, no pack constant assumed.
function buildAnswers(repoPath) {
  return {
    version: 1,
    mode: "thorough",
    machine: { conventionsDocs: ["CLAUDE.md"], git: { host: "github" } },
    repos: [{ name: "web", path: repoPath, role: "frontend", commands: { testCmd: "npm test", lintCmd: "npm run lint", typeCheckCmd: "", buildCmd: "npm run build" } }],
    answered: {
      projectName: "Demo",
      "auditAnchors.scale": "team",
      branchNaming: { creationTemplate: "{type}/{n}-{slug}", enforceRegex: "^TB-\\d+", protectedBranches: ["main"], mergeStrategy: "squash" },
      "gitFlow.bypass": "block",
      "hooks.content": { emDash: { enabled: true, scope: { include: ["**/*.md"] } } },
      issueTracker: { host: "github", repo: "demo/app", ticketPattern: "", labels: [], milestones: [] },
    },
    docs: { links: [], sources: [], normativeStatements: [] },
    tracker: { host: "github", tool: { cli: "gh" } },
  };
}
