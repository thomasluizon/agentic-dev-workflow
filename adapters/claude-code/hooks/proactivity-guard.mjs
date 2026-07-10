#!/usr/bin/env node
// Claude Code Stop adapter — Layer 2 of the proactivity guard. A cheap judge
// model (policy.proactivity.guard.judgeModel) reviews the finished turn and
// sends it back when it CLEARLY took a shortcut a cheaper/more-correct action
// beat. The prompt + verdict parsing live in the logic core; this file wires the
// Stop-hook I/O and the model call.
//
// Invariants: fail-OPEN on any error/ambiguity; no loops (stop_hook_active + a
// per-message marker); no recursion (the inner `claude -p` sets a guard env so
// its own Stop hook short-circuits); empty judgeModel disables Layer 2 (never
// pin a model that may retire).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUARD_ENV = "AGENTIC_PROACTIVITY_GUARD";
const STATE_PATH = path.join(os.homedir(), ".claude", ".agentic-proactivity-guard-state.json");

function allow() {
  process.exit(0);
}

async function core(mod) {
  for (const rel of ["../skills/_core/hooks/logic", "../../../core/hooks/logic"]) {
    const p = path.join(here, rel, mod);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error(`hook logic core not found: ${mod}`);
}

async function main() {
  if (process.env[GUARD_ENV]) allow();

  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    allow();
  }
  if (input.stop_hook_active) allow();

  const { loadPolicy } = await core("config.mjs");
  const policy = loadPolicy(input.cwd || process.cwd());
  const guard = policy.proactivity?.guard;
  if (!guard?.enabled || !guard.judgeModel) allow();

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) allow();

  let records = [];
  try {
    records = fs
      .readFileSync(transcriptPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    allow();
  }

  const { extractLatestTurn, loadSkillDigest, buildJudgePrompt, parseVerdict, LIMITS } = await core("proactivity.mjs");
  const turn = extractLatestTurn(records);
  if (!turn || turn.assistantText.length < LIMITS.MIN_CHARS) allow();

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    state = {};
  }
  if (turn.finalUuid && state.lastBlockedUuid === turn.finalUuid) allow();

  const skillDirs = guard.skillDirs?.length
    ? guard.skillDirs
    : [path.join(input.cwd || ".", ".claude", "skills"), path.join(os.homedir(), ".claude", "skills")];
  const judgePrompt = buildJudgePrompt({
    userPrompt: turn.userPrompt,
    toolsUsed: turn.toolsUsed,
    assistantText: turn.assistantText,
    skillDigest: loadSkillDigest(skillDirs),
  });

  const res = spawnSync("claude", ["-p", "--model", guard.judgeModel, "--strict-mcp-config"], {
    input: judgePrompt,
    encoding: "utf8",
    timeout: 45000,
    shell: true,
    env: { ...process.env, [GUARD_ENV]: "1" },
  });
  if (res.status !== 0 || !res.stdout) allow();

  const verdict = parseVerdict(res.stdout);
  if (!verdict) allow();

  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ lastBlockedUuid: turn.finalUuid }));
  } catch {
    /* marker is best-effort */
  }

  const reason =
    "[proactivity guard] " +
    verdict.reason.trim() +
    " Do or verify it now (or invoke the matching skill) before ending the turn; if this is a false positive, state why in one line and continue.";
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

main().catch(() => process.exit(0));
