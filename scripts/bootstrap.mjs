#!/usr/bin/env node
// bootstrap.mjs — the ONE command you run once after `git clone` to stand the
// harness up on a machine. It installs the portable CORE globally into ~/.claude
// so `/setup-harness` (and every generic pipeline/review/intake skill) is
// available in EVERY project, then you run `/setup-harness` inside a project to
// generate that project's overlay.
//
// What it does, cross-platform (Windows / macOS / Linux, no bash-isms):
//   1. Hard-checks Node is present and new enough (structuredClone + cpSync).
//   2. COPIES — never symlinks — the Claude Code CORE (skills + agents + hooks +
//      workflows + the vendored `_core` bodies/logic) into ~/.claude. A copy
//      survives moving or deleting the cloned pack; a symlink would not.
//   3. Installs the behavioral baseline as a global auto-loading rule (the
//      disposition every session starts from, before any company overlay).
//   4. Wires the machine-wide proactivity guard into ~/.claude/settings.json
//      (idempotent, backed up; skip with --no-hooks).
//   5. Records ~/.claude/harness.bootstrap.json — a versioned manifest of exactly
//      what it installed, so a later run updates in place (and prunes what the
//      pack dropped) instead of piling up stale files.
//
// It is destructive ONLY on the pack's own artifacts: it replaces each CORE skill
// it owns and never touches sibling skills/agents/hooks the user or another tool
// put in ~/.claude. This is the split from install.mjs — that vendors CORE into
// ONE project's .claude/.opencode; this installs the harness globally, once.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashTree } from "./install.mjs";

const packRootDefault = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BOOTSTRAP_MANIFEST = "harness.bootstrap.json";
export const MIN_NODE_MAJOR = 18;

// ---- node hard-check ---------------------------------------------------------

// Major version from a "24.13.0" / "v18.4.1" string. Pure so the proof can check
// the boundary without spawning a second Node.
export function nodeMajor(versionString) {
  const match = String(versionString || "").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function assertNodeVersion(min = MIN_NODE_MAJOR, actual = process.versions.node) {
  const major = nodeMajor(actual);
  if (major < min) {
    throw new Error(
      `Node ${min}+ is required (found ${actual || "no node"}). The harness hooks use structuredClone and fs.cpSync — install a current Node LTS and re-run.`,
    );
  }
  return major;
}

// ---- ~/.claude resolution (cross-platform) -----------------------------------

// Global config dir, honoring Claude Code's CLAUDE_CONFIG_DIR override, else
// ~/.claude. os.homedir() is correct on Windows (USERPROFILE), macOS, and Linux.
export function resolveClaudeDir(explicit) {
  if (explicit) return explicit;
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return join(os.homedir(), ".claude");
}

// ---- copy plan ---------------------------------------------------------------

function childDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
}

function childFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
}

// Every CORE item bootstrap owns, as { type, name, from (abs), dest (posix) }.
// `dest` is relative to ~/.claude and stored posix so the manifest compares
// cleanly across platforms; copies rebuild the real path from it.
function buildPlan(packRoot) {
  const cc = join(packRoot, "adapters", "claude-code");
  const items = [];
  for (const name of childDirs(join(cc, "skills"))) {
    items.push({ type: "skill", name, from: join(cc, "skills", name), dest: `skills/${name}`, isDir: true });
  }
  items.push({ type: "core", name: "_core", from: join(packRoot, "core"), dest: "skills/_core", isDir: true });
  for (const file of childFiles(join(cc, "agents"))) {
    items.push({ type: "agent", name: file, from: join(cc, "agents", file), dest: `agents/${file}`, isDir: false });
  }
  for (const file of childFiles(join(cc, "hooks"))) {
    items.push({ type: "hook", name: file, from: join(cc, "hooks", file), dest: `hooks/${file}`, isDir: false });
  }
  for (const file of childFiles(join(cc, "workflows"))) {
    items.push({ type: "workflow", name: file, from: join(cc, "workflows", file), dest: `workflows/${file}`, isDir: false });
  }
  return items;
}

const toAbs = (root, posixDest) => join(root, ...posixDest.split("/"));

// The behavioral baseline shipped in core, wrapped in rule frontmatter so it
// auto-loads every session as the machine-wide disposition. Derived from the ONE
// source in core/_shared so it never drifts from the skills' baseline.
function baselineRule(packRoot) {
  const body = readFileSync(join(packRoot, "core", "_shared", "behavioral-baseline.md"), "utf8").replace(/\r\n/g, "\n");
  const front = ["---", "description: Behavioral best-practices baseline — how to work in every session, before any project overlay.", "---", "", ""].join("\n");
  return front + body;
}

// ---- proactivity hooks -> ~/.claude/settings.json ----------------------------

// Wire ONLY the two machine-wide CORE hooks (the disposition reminder + the turn
// guard). The git/content guardrails are project overlay — setup-harness wires
// those per project, where a hooks.policy.json exists. Idempotent: matches an
// existing entry by the hook filename so a re-run never duplicates. Absolute
// command paths so it is location-independent on every OS.
export function wireProactivityHooks(claudeDir, { backupStamp = "" } = {}) {
  const settingsPath = join(claudeDir, "settings.json");
  let settings = {};
  let existed = false;
  if (existsSync(settingsPath)) {
    existed = true;
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) || {};
    } catch {
      settings = {};
    }
  }
  const wanted = [
    { event: "UserPromptSubmit", file: "proactivity-reminder.mjs", timeout: 10 },
    { event: "Stop", file: "proactivity-guard.mjs", timeout: 60 },
  ];
  const added = [];
  const alreadyPresent = [];
  settings.hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  for (const { event, file, timeout } of wanted) {
    const command = `node "${join(claudeDir, "hooks", file)}"`;
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const present = list.some((entry) => (entry.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(file)));
    if (present) {
      alreadyPresent.push(file);
    } else {
      list.push({ hooks: [{ type: "command", command, timeout }] });
      added.push(file);
    }
    settings.hooks[event] = list;
  }
  if (added.length) {
    if (existed) writeFileSync(join(claudeDir, `settings.json.harness-bak${backupStamp ? `-${backupStamp}` : ""}`), readFileSync(settingsPath));
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { added, alreadyPresent, wired: added.length > 0 || alreadyPresent.length === wanted.length };
}

// ---- bootstrap ---------------------------------------------------------------

export function readBootstrapManifest(claudeDir) {
  try {
    return JSON.parse(readFileSync(join(claudeDir, BOOTSTRAP_MANIFEST), "utf8"));
  } catch {
    return null;
  }
}

// Install (or update in place) the CORE into a global ~/.claude. Returns a report
// the CLI prints and the proof asserts on. Deterministic — the CLI stamps the
// real time via `generatedAt` so the module stays testable.
export function bootstrap({ claudeDir, packRoot = packRootDefault, wireHooks = true, generatedAt = "", ref = "main", nodeVersion = process.versions.node } = {}) {
  assertNodeVersion(MIN_NODE_MAJOR, nodeVersion);
  const root = resolveClaudeDir(claudeDir);
  const plan = buildPlan(packRoot);
  if (!plan.some((i) => i.type === "skill" && i.name === "setup-harness")) {
    throw new Error(`setup-harness skill not found under ${join(packRoot, "adapters", "claude-code", "skills")} — run gen-adapters first.`);
  }

  const previous = readBootstrapManifest(root);

  // Copy each owned item (replace-in-place), then the derived baseline rule.
  for (const item of plan) {
    const dest = toAbs(root, item.dest);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(item.from, dest, { recursive: true });
  }
  const baselineDest = "rules/agentic-baseline.md";
  const baselineAbs = toAbs(root, baselineDest);
  mkdirSync(dirname(baselineAbs), { recursive: true });
  writeFileSync(baselineAbs, baselineRule(packRoot));
  const items = [...plan.map(({ type, name, dest }) => ({ type, name, dest })), { type: "rule", name: "agentic-baseline.md", dest: baselineDest }];

  // Prune anything a previous install owned that this pack no longer ships.
  const currentDests = new Set(items.map((i) => i.dest));
  const pruned = [];
  for (const old of previous?.items || []) {
    if (!currentDests.has(old.dest)) {
      rmSync(toAbs(root, old.dest), { recursive: true, force: true });
      pruned.push(old.dest);
    }
  }

  const hooks = wireHooks ? wireProactivityHooks(root, { backupStamp: generatedAt.replace(/[:.]/g, "-") }) : { added: [], alreadyPresent: [], wired: false };

  const manifest = {
    version: 1,
    tool: "claude-code",
    packRef: ref,
    installedAt: generatedAt,
    node: nodeVersion,
    coreHash: hashTree(toAbs(root, "skills/_core")),
    hooksWired: hooks.wired,
    items,
  };
  writeFileSync(join(root, BOOTSTRAP_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");

  const skills = items.filter((i) => i.type === "skill").map((i) => i.name);
  return {
    claudeDir: root,
    manifest,
    skills,
    hasSetupHarness: skills.includes("setup-harness"),
    hasUpdateHarness: skills.includes("update-harness"),
    pruned,
    hooks,
  };
}

// ---- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { wireHooks: true, ref: "main" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-hooks") args.wireHooks = false;
    else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--ref") args.ref = argv[++i];
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = bootstrap({ ...args, generatedAt: new Date().toISOString() });
    console.log(`Installed the CORE harness into ${report.claudeDir}`);
    console.log(`  ${report.skills.length} skills · agents · hooks · workflows · _core (coreHash ${report.manifest.coreHash.slice(0, 12)}…)`);
    console.log(`  /setup-harness ${report.hasSetupHarness ? "installed" : "MISSING"}${report.hasUpdateHarness ? " · /update-harness installed" : " · /update-harness not built yet (arrives in a later pack)"}`);
    if (report.hooks.added.length) console.log(`  wired proactivity hooks: ${report.hooks.added.join(", ")}`);
    else if (args.wireHooks) console.log(`  proactivity hooks already wired`);
    if (report.pruned.length) console.log(`  pruned ${report.pruned.length} stale item(s) from a previous install`);
    console.log(`\nNext: open any project and run  /setup-harness  to generate its tailored overlay.`);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
