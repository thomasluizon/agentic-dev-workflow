#!/usr/bin/env node
// staleness.mjs — the deterministic half of /update-harness.
//
// The web-grounded judgement (is THIS model pin superseded? is THAT flag
// deprecated?) is the skill's job, done with live sources. This module does only
// the parts a machine can settle without a network call, and does them purely so
// the proof can pin them:
//
//   - scanModelPins   : find every vendor-prefixed model id in the installed
//                       harness, WITH its file:line, so the skill has an exact
//                       candidate list to web-verify (never invents locations).
//                       Store-aware: `collectStoreFiles` also reaches every
//                       repo-clean project's out-of-repo store entry, since that
//                       overlay lives under ~/.claude/harness, not in the repo.
//   - overlayBehindCore: compare the coreHash the install recorded against the
//                       pack's current coreHash — a pure "is my install behind?"
//   - the update clock : a machine-global staleness record + due math, so the
//                       monthly reminder is real and portable (no scheduler
//                       assumed; the runbook documents wiring a hard one).
//
// Everything here is generic — no project strings, no SDLC policy, no network.
// Cross-platform Node built-ins only; pure functions take an explicit `now` so
// they are deterministic, the CLI stamps the real time at the boundary.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { listStoreEntries } from "../hooks/logic/store.mjs";

export const UPDATE_STATE_FILE = "harness.update.json";
export const DEFAULT_INTERVAL_DAYS = 30;
const DAY_MS = 86_400_000;

// ---- model-pin scan ----------------------------------------------------------

// A model id is a known vendor prefix + a hyphen + a token carrying at least one
// digit (so "claude-code" the TOOL is not mistaken for a model, but
// "claude-opus-4-8" the model is caught). These are only CANDIDATES — the skill
// checks each against the live roster before ever calling one stale.
const VENDOR_PREFIXES = ["claude", "gpt", "gemini", "glm", "llama", "mistral", "deepseek", "grok", "qwen", "command"];
const MODEL_RE = new RegExp(`\\b(?:${VENDOR_PREFIXES.join("|")})-[a-z0-9][a-z0-9.\\-]*\\b`, "gi");

const SCAN_EXTENSIONS = [".md", ".yaml", ".yml", ".json", ".mjs", ".js"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".harness-backup"]);

// Extract every model-pin candidate from a set of { path, text } files. Returns
// [{ file, line, model, context }], deduped by file+line+model, so the skill can
// cite exactly where a stale pin lives without re-reading anything.
export function scanModelPins(files) {
  const seen = new Set();
  const pins = [];
  for (const { path, text } of files) {
    const lines = String(text || "").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const match of line.matchAll(MODEL_RE)) {
        const model = match[0];
        if (!/\d/.test(model)) continue;
        const key = `${path}::${i + 1}::${model.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pins.push({ file: path, line: i + 1, model, context: line.trim() });
      }
    });
  }
  return pins;
}

// Store-aware collection: every REPO-CLEAN project's overlay lives in the
// out-of-repo store, not in the repo, so /update-harness scans there too. Returns
// the same [{ path, text }] shape as collectHarnessFiles, but each path is prefixed
// with the project's store slug so a stale pin cites WHICH project's store it is
// in. Empty when no repo-clean project is registered.
export function collectStoreFiles({ extensions = SCAN_EXTENSIONS } = {}) {
  const out = [];
  for (const entry of listStoreEntries()) {
    for (const file of collectHarnessFiles(entry.entryDir, { extensions })) {
      out.push({ path: `harness/projects/${entry.slug}/${file.path}`, text: file.text });
    }
  }
  return out;
}

// Walk a harness root and read the files worth scanning (skill bodies, config,
// policy, hook/workflow code). Returns [{ path (root-relative, posix), text }].
export function collectHarnessFiles(root, { extensions = SCAN_EXTENSIONS } = {}) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.toLowerCase().endsWith(ext))) {
        out.push({ path: relative(root, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

// ---- overlay-behind-CORE -----------------------------------------------------

// Pure comparator: does the coreHash the install recorded still match the pack's
// current coreHash? The skill computes each side (the install's from its bootstrap
// manifest, the pack's from a fresh clone) and passes the two strings here.
export function overlayBehindCore(installedCoreHash, currentCoreHash) {
  const known = Boolean(installedCoreHash) && Boolean(currentCoreHash);
  return {
    known,
    behind: known && installedCoreHash !== currentCoreHash,
    installedCoreHash: installedCoreHash || null,
    currentCoreHash: currentCoreHash || null,
  };
}

// ---- the update clock (machine-global staleness record) ----------------------

const statePath = (claudeDir) => join(claudeDir, UPDATE_STATE_FILE);

export function readUpdateState(claudeDir) {
  try {
    return JSON.parse(readFileSync(statePath(claudeDir), "utf8"));
  } catch {
    return null;
  }
}

export function writeUpdateState(claudeDir, state) {
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(statePath(claudeDir), JSON.stringify(state, null, 2) + "\n");
  return state;
}

// Start the clock at install time WITHOUT resetting an existing one — so
// re-running bootstrap never pushes the next check out. Returns the live state.
export function seedUpdateState(claudeDir, { installedAt = "", intervalDays = DEFAULT_INTERVAL_DAYS } = {}) {
  const existing = readUpdateState(claudeDir);
  if (existing) return existing;
  return writeUpdateState(claudeDir, { version: 1, installedAt, lastCheckedAt: null, intervalDays });
}

// Record that /update-harness ran — resets the monthly clock.
export function recordUpdateRun(claudeDir, checkedAtISO) {
  const state = readUpdateState(claudeDir) || { version: 1, installedAt: checkedAtISO, intervalDays: DEFAULT_INTERVAL_DAYS };
  state.lastCheckedAt = checkedAtISO;
  return writeUpdateState(claudeDir, state);
}

// ---- due math (pure) ---------------------------------------------------------

const parseTime = (iso) => {
  const t = Date.parse(String(iso || ""));
  return Number.isNaN(t) ? null : t;
};

// Due when never checked, when the record is unreadable, or when the interval has
// elapsed. Fail toward reminding — a broken clock should nudge, not go silent.
export function isUpdateDue(lastCheckedISO, nowISO, intervalDays = DEFAULT_INTERVAL_DAYS) {
  const last = parseTime(lastCheckedISO);
  const now = parseTime(nowISO);
  if (last === null || now === null) return true;
  return now - last >= intervalDays * DAY_MS;
}

export function nextDueDate(baseISO, intervalDays = DEFAULT_INTERVAL_DAYS) {
  const base = parseTime(baseISO);
  if (base === null) return null;
  return new Date(base + intervalDays * DAY_MS).toISOString();
}

// Everything the runbook needs to greet the user with the clock state.
export function dueReport(claudeDir, nowISO) {
  const state = readUpdateState(claudeDir);
  const intervalDays = state?.intervalDays ?? DEFAULT_INTERVAL_DAYS;
  const anchor = state?.lastCheckedAt || state?.installedAt || null;
  return {
    due: isUpdateDue(state?.lastCheckedAt, nowISO, intervalDays),
    lastCheckedAt: state?.lastCheckedAt || null,
    installedAt: state?.installedAt || null,
    nextDueAt: anchor ? nextDueDate(anchor, intervalDays) : null,
    intervalDays,
  };
}

// ---- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") args.dir = argv[++i];
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const { dir } = parseArgs(rest);
  const now = new Date().toISOString();
  if (command === "scan") {
    const root = dir || process.cwd();
    console.log(JSON.stringify(scanModelPins(collectHarnessFiles(root)), null, 2));
  } else if (command === "scan-store") {
    console.log(JSON.stringify(scanModelPins(collectStoreFiles()), null, 2));
  } else if (command === "due") {
    console.log(JSON.stringify(dueReport(dir || process.cwd(), now), null, 2));
  } else if (command === "record") {
    console.log(JSON.stringify(recordUpdateRun(dir || process.cwd(), now), null, 2));
  } else {
    console.error("usage: staleness.mjs <scan|scan-store|due|record> --dir <path>");
    process.exit(1);
  }
}
