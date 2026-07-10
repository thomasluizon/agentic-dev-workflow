#!/usr/bin/env node
// config.mjs — the two-layer resolver for the MECHANICAL config the generic
// pipeline skills read. It mirrors the hook policy's layering (see
// hooks/logic/config.mjs): a machine/company-wide global config at
// ~/.claude/workflow.config.yaml supplies defaults, and each project's
// workflow.config.yaml OVERRIDES it. A skill resolving `{{config.*}}` reads the
// EFFECTIVE (merged) config, so a PC where every project follows the same
// conventions answers the machine-wide questions ONCE (global) and each repo
// carries only its overrides + repos[].
//
// AI-managed, never hand-edited: setup-harness populates both layers, sync
// re-applies them, and this resolver is the single runtime read. Generic — the
// merge knows nothing project-specific; every value comes from the two files.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { toYaml, fromYaml } from "./answers.mjs";
import { deepMerge } from "../hooks/logic/config.mjs";

export const CONFIG_FILENAME = "workflow.config.yaml";

// Which top-level config belongs to the GLOBAL (machine/company) layer vs the
// PROJECT layer, per plan section A: global = tracker host/driver, branch
// grammar, merge strategy, tool/audit/enforcement defaults; project = repos[],
// name, conventions, and the tracker's project coordinates. issueTracker is split
// down the middle and recombines on merge (deepMerge is deep).
const GLOBAL_KEYS = ["branchNaming", "pr", "auditAnchors", "execution", "secondOpinion", "investigate", "hooks"];
const PROJECT_KEYS = ["projectName", "repos", "conventionsDocs"];
const TRACKER_GLOBAL = ["host", "driver", "ticketPattern"];
const TRACKER_PROJECT = ["repo", "labels", "milestones"];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// Partition a full config into { global, project } so the machine-wide defaults
// live once in ~/.claude and a project file carries only its own coordinates +
// overrides. resolveConfigFrom(global, project) reconstructs the whole.
export function splitConfig(full = {}) {
  const tracker = full.issueTracker || {};
  const global = pick(full, GLOBAL_KEYS);
  const project = pick(full, PROJECT_KEYS);
  const trackerGlobal = pick(tracker, TRACKER_GLOBAL);
  const trackerProject = pick(tracker, TRACKER_PROJECT);
  if (Object.keys(trackerGlobal).length) global.issueTracker = trackerGlobal;
  if (Object.keys(trackerProject).length) project.issueTracker = trackerProject;
  return { global, project };
}

// Project overrides global. Pure so the proof can pin it without touching disk.
export function resolveConfigFrom(globalConfig, projectConfig) {
  return deepMerge(globalConfig || {}, projectConfig || {});
}

export function readConfig(file) {
  try {
    return fromYaml(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function globalConfigPath() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(claudeDir, CONFIG_FILENAME);
}

// Nearest project config, walking up from startDir — never the global one.
function findProjectConfig(startDir) {
  let dir = startDir || process.cwd();
  const globalPath = globalConfigPath();
  for (let i = 0; i < 40; i++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (candidate !== globalPath && fs.existsSync(candidate)) return readConfig(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// The effective config a skill reads: global defaults < project overrides.
export function resolveConfig(startDir) {
  const global = readConfig(globalConfigPath());
  const project = findProjectConfig(startDir);
  return resolveConfigFrom(global, project);
}

// ---- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--file") args.file = argv[++i];
  }
  return args;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const { dir, file } = parseArgs(rest);
  if (command === "resolve") {
    process.stdout.write(toYaml(resolveConfig(dir || process.cwd())));
  } else if (command === "split") {
    process.stdout.write(JSON.stringify(splitConfig(readConfig(file) || {}), null, 2) + "\n");
  } else {
    console.error("usage: config.mjs <resolve --dir <path> | split --file <workflow.config.yaml>>");
    process.exit(1);
  }
}
