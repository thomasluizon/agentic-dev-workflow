#!/usr/bin/env node
// Proof for the /update-harness deterministic machinery (stage 7g). The
// web-grounded judgement is the skill's job; this pins the parts a machine can
// settle without a network call — the model-pin scan (with exact file:line), the
// overlay-behind-CORE compare, and the monthly update clock — plus that the skill
// is actually wired into the roster. Zero bash-isms; runs identically on every OS.
//
// Exits non-zero on any failure so CI gates on it.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanModelPins,
  collectHarnessFiles,
  overlayBehindCore,
  isUpdateDue,
  nextDueDate,
  dueReport,
  readUpdateState,
  seedUpdateState,
  recordUpdateRun,
  UPDATE_STATE_FILE,
  DEFAULT_INTERVAL_DAYS,
} from "../core/meta/staleness.mjs";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const Truthy = (name, got) => T(name, Boolean(got), true);

const root = join(tmpdir(), "agentic-update-harness-proof");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

// ---------------------------------------------------------------------------
// 1. model-pin scan — vendor-prefixed ids WITH exact file:line, no false hits
// ---------------------------------------------------------------------------
console.log("# model-pin scan");
const files = [
  { path: "rules/a.md", text: "model: claude-opus-4-8\nplain text\nfallback claude-haiku-4-5-20251001 here" },
  { path: "config.yaml", text: "cheapSubagentModel: gpt-4.1-mini\nsecondModel: glm-5.2" },
  { path: "skills/claude-code.md", text: "run the claude-code CLI (not a model)" },
  { path: "two.md", text: "compare claude-sonnet-5 vs gpt-4.1-mini on one line" },
];
const pins = scanModelPins(files);
T("scan: finds the opus pin at the right file:line", pins.find((p) => p.model === "claude-opus-4-8"), { file: "rules/a.md", line: 1, model: "claude-opus-4-8", context: "model: claude-opus-4-8" });
Truthy("scan: finds a dated haiku pin on line 3", pins.some((p) => p.model === "claude-haiku-4-5-20251001" && p.file === "rules/a.md" && p.line === 3));
Truthy("scan: catches a GPT pin in config", pins.some((p) => p.model === "gpt-4.1-mini" && p.file === "config.yaml"));
Truthy("scan: catches a GLM pin", pins.some((p) => p.model === "glm-5.2"));
T("scan: 'claude-code' (no digit) is NOT flagged as a model", pins.some((p) => p.model === "claude-code" || p.context.includes("CLI")), false);
T("scan: two pins on one line are both captured", pins.filter((p) => p.file === "two.md" && p.line === 1).length, 2);
T("scan: empty input never throws, returns []", scanModelPins([]), []);

// ---------------------------------------------------------------------------
// 2. collectHarnessFiles — walk, filter by extension, skip node_modules
// ---------------------------------------------------------------------------
console.log("\n# collectHarnessFiles");
const scanDir = join(root, "harness");
mkdirSync(join(scanDir, "rules"), { recursive: true });
mkdirSync(join(scanDir, "node_modules", "pkg"), { recursive: true });
writeFileSync(join(scanDir, "rules", "r.md"), "model: gpt-5\n");
writeFileSync(join(scanDir, "config.yaml"), "x: 1\n");
writeFileSync(join(scanDir, "notes.txt"), "ignored extension\n");
writeFileSync(join(scanDir, "node_modules", "pkg", "dep.md"), "claude-opus-4-8 should be skipped\n");
const collected = collectHarnessFiles(scanDir);
Truthy("collect: reads the .md rule", collected.some((f) => f.path === "rules/r.md"));
Truthy("collect: reads the .yaml config", collected.some((f) => f.path === "config.yaml"));
T("collect: skips a non-scanned extension (.txt)", collected.some((f) => f.path === "notes.txt"), false);
T("collect: skips node_modules", collected.some((f) => f.path.startsWith("node_modules/")), false);
Truthy("collect: paths are posix-normalized", collected.every((f) => !f.path.includes("\\")));
T("collect: a missing root never throws, returns []", collectHarnessFiles(join(root, "nope")), []);
// End-to-end: scan the collected files.
Truthy("collect+scan: finds the gpt-5 pin end-to-end", scanModelPins(collected).some((p) => p.model === "gpt-5" && p.file === "rules/r.md"));

// ---------------------------------------------------------------------------
// 3. overlay-behind-CORE — pure hash compare
// ---------------------------------------------------------------------------
console.log("\n# overlay-behind-CORE");
T("behind: equal hashes are not behind", overlayBehindCore("abc", "abc"), { known: true, behind: false, installedCoreHash: "abc", currentCoreHash: "abc" });
T("behind: differing hashes are behind", overlayBehindCore("abc", "xyz").behind, true);
T("behind: a missing installed hash is unknown, not behind", overlayBehindCore("", "xyz"), { known: false, behind: false, installedCoreHash: null, currentCoreHash: "xyz" });
T("behind: both missing is unknown", overlayBehindCore("", "").known, false);

// ---------------------------------------------------------------------------
// 4. due math — fails toward reminding
// ---------------------------------------------------------------------------
console.log("\n# due math");
T("due: never-checked is due", isUpdateDue(null, "2026-02-01T00:00:00Z"), true);
T("due: inside the interval is not due", isUpdateDue("2026-02-01T00:00:00Z", "2026-02-15T00:00:00Z", 30), false);
T("due: past the interval is due", isUpdateDue("2026-01-01T00:00:00Z", "2026-02-15T00:00:00Z", 30), true);
T("due: exactly the interval is due", isUpdateDue("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z", 30), true);
T("due: an unparseable timestamp is due (broken clock nudges)", isUpdateDue("garbage", "2026-02-01T00:00:00Z"), true);
T("next-due: 30 days after the anchor", nextDueDate("2026-01-01T00:00:00Z", 30), "2026-01-31T00:00:00.000Z");
T("next-due: garbage anchor is null", nextDueDate("nope"), null);
T("default interval is monthly", DEFAULT_INTERVAL_DAYS, 30);

// ---------------------------------------------------------------------------
// 5. the update clock — seed / record / report round-trip
// ---------------------------------------------------------------------------
console.log("\n# update clock");
const clockDir = join(root, "claude");
mkdirSync(clockDir, { recursive: true });
T("clock: no state before seeding", readUpdateState(clockDir), null);
const seeded = seedUpdateState(clockDir, { installedAt: "2026-01-01T00:00:00Z" });
T("clock: seed records installedAt and a null lastCheckedAt", { i: seeded.installedAt, l: seeded.lastCheckedAt, d: seeded.intervalDays }, { i: "2026-01-01T00:00:00Z", l: null, d: 30 });
Truthy("clock: state file written", existsSync(join(clockDir, UPDATE_STATE_FILE)));
const reseed = seedUpdateState(clockDir, { installedAt: "2099-12-31T00:00:00Z" });
T("clock: re-seeding does NOT overwrite an existing clock", reseed.installedAt, "2026-01-01T00:00:00Z");
T("clock: due before any check (never checked)", dueReport(clockDir, "2026-01-10T00:00:00Z").due, true);
recordUpdateRun(clockDir, "2026-01-10T00:00:00Z");
T("clock: record sets lastCheckedAt", readUpdateState(clockDir).lastCheckedAt, "2026-01-10T00:00:00Z");
const report = dueReport(clockDir, "2026-01-20T00:00:00Z");
T("clock: not due right after a recorded run", report.due, false);
T("clock: nextDueAt is 30 days after the last check", report.nextDueAt, "2026-02-09T00:00:00.000Z");
T("clock: due again once the interval elapses", dueReport(clockDir, "2026-03-01T00:00:00Z").due, true);
T("clock: recordUpdateRun on a fresh dir never throws", typeof recordUpdateRun(join(root, "fresh"), "2026-01-01T00:00:00Z").lastCheckedAt, "string");

// ---------------------------------------------------------------------------
// 6. the skill is wired into the roster (gen-adapters ran)
// ---------------------------------------------------------------------------
console.log("\n# roster wiring");
const ccSkill = join(packRoot, "adapters", "claude-code", "skills", "update-harness", "SKILL.md");
Truthy("roster: the Claude Code /update-harness adapter exists", existsSync(ccSkill));
Truthy("roster: the CC adapter points at the core body", existsSync(ccSkill) && readFileSync(ccSkill, "utf8").includes("meta/update-harness.md"));
Truthy("roster: the opencode /update-harness adapter exists", existsSync(join(packRoot, "adapters", "opencode", "skills", "update-harness", "SKILL.md")));
Truthy("roster: the core body ships in the pack", existsSync(join(packRoot, "core", "meta", "update-harness.md")));

rmSync(root, { recursive: true, force: true });
console.log(`\n${fails === 0 ? "UPDATE-HARNESS PROOF OK" : `UPDATE-HARNESS PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
