// Runtime-agnostic building blocks for the proactivity guard — the disposition
// gate that steers the agent toward verify/do over guess/ask/improvise. Two
// layers ship as a dual-target pair:
//   Layer 1 (reminder) — re-inject one high-salience line every turn.
//   Layer 2 (guard)    — a cheap judge model reviews the finished turn and, on a
//                        clear shortcut, sends it back (Claude Code Stop hook) or
//                        surfaces a nudge (opencode session.idle event).
// This module is pure: it builds the reminder line + the judge prompt and parses
// the verdict. The model call itself (claude -p, or the opencode client) lives
// in each adapter, so the logic stays tool-neutral.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REMINDER_LINE =
  "Before you assume a fact or ask the user to do something: can you verify it or do it right now " +
  "with a tool you already have (gh, files, MCP, a CLI)? If the request names a concrete thing you " +
  "have not inspected (an issue, file, PR, or resource), inspect it first. If the situation matches a " +
  "skill trigger (you were corrected: lesson; a diff needs review: pr-review; an idea needs PRD and " +
  "stories: feature), invoke the skill instead of improvising. Default to the cheap, correct action " +
  "over the guess, the question, or the hand-rolled version.";

export const LIMITS = { MIN_CHARS: 200, MAX_USER: 1500, MAX_ASSISTANT: 4000 };

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  }
  return "";
}

function isGenuineUserPrompt(rec) {
  if (!rec || rec.type !== "user" || rec.toolUseResult) return false;
  const c = rec.message && rec.message.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) return c.some((b) => b && b.type === "text");
  return false;
}

// Slice the most recent user->assistant turn out of a Claude Code transcript
// (array of parsed JSONL records). Returns null when there is nothing to judge.
export function extractLatestTurn(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let turnStart = -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (isGenuineUserPrompt(records[i])) {
      turnStart = i;
      break;
    }
  }
  if (turnStart === -1) return null;
  const turn = records.slice(turnStart);
  const userPrompt = textFromContent(records[turnStart].message.content).trim();
  const assistantRecords = turn.filter((r) => r.type === "assistant");
  if (assistantRecords.length === 0) return null;
  const finalAssistant = assistantRecords[assistantRecords.length - 1];
  let assistantText = textFromContent(finalAssistant.message && finalAssistant.message.content).trim();
  if (!assistantText) {
    assistantText = assistantRecords.map((r) => textFromContent(r.message && r.message.content)).join("\n").trim();
  }
  const toolsUsed = [
    ...new Set(
      assistantRecords.flatMap((r) => {
        const c = (r.message && r.message.content) || [];
        return Array.isArray(c) ? c.filter((b) => b && b.type === "tool_use").map((b) => b.name) : [];
      }),
    ),
  ];
  return { userPrompt, assistantText, toolsUsed, finalUuid: finalAssistant.uuid || "" };
}

// Digest of available skills (name: when-to-use), read from the given skill
// directories, so the judge can tell when a skill trigger was clearly matched.
export function loadSkillDigest(dirs) {
  const searchDirs = dirs && dirs.length ? dirs : [path.join(".", ".claude", "skills"), path.join(os.homedir(), ".claude", "skills")];
  const byName = new Map();
  for (const dir of searchDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      let raw = "";
      try {
        raw = fs.readFileSync(path.join(dir, e.name, "SKILL.md"), "utf8");
      } catch {
        continue;
      }
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) continue;
      const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
      const descMatch = fm[1].match(/^description:\s*(.+)$/m);
      const name = (nameMatch ? nameMatch[1] : e.name).trim();
      if (byName.has(name)) continue;
      let desc = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, "") : "";
      if (desc.length > 220) desc = desc.slice(0, 217) + "...";
      byName.set(name, desc);
    }
  }
  return [...byName.entries()].map(([n, d]) => `  /${n}: ${d}`).join("\n");
}

export function buildJudgePrompt({ userPrompt, toolsUsed, assistantText, skillDigest }) {
  return [
    "You are a strict but conservative proactivity gate reviewing an AI coding agent's just-finished turn.",
    "Block the turn ONLY when it CLEARLY took a shortcut that a cheaper, more-correct action beat. When in doubt, allow.",
    "",
    "Block if ANY of these clearly happened in THIS turn:",
    "(a) It asserted a specific factual claim about a NAMED artifact (an issue/PR number, a file path, a resource) while the tools-used list shows it never inspected that artifact this turn and nothing indicates it already knew the contents.",
    "(b) It asked the user to run a command, read a log, fetch data, or click something the agent had the tools to do itself (gh, files, MCP, a CLI).",
    "(c) It finished by offering clearly in-scope work as an optional 'want me to...?' instead of just doing it.",
    "(d) It hand-rolled a procedure when a listed skill's trigger clearly matched (a correction -> lesson; a diff needs review -> pr-review).",
    "",
    "Do NOT block for: legitimate clarifying questions about a genuine fork, work already done correctly, asking for a decision only the user can make, or things it verified in an earlier turn.",
    "",
    "Available skills (name: when-to-use):",
    skillDigest || "  (none found)",
    "",
    "=== USER REQUEST (this turn) ===",
    (userPrompt || "").slice(0, LIMITS.MAX_USER),
    "",
    "=== TOOLS THE AGENT USED THIS TURN ===",
    toolsUsed && toolsUsed.length ? toolsUsed.join(", ") : "(none)",
    "",
    "=== AGENT'S FINAL MESSAGE ===",
    (assistantText || "").slice(0, LIMITS.MAX_ASSISTANT),
    "",
    "Respond with ONLY minified JSON, no code fence, no prose:",
    '{"block": <true|false>, "clause": "<a|b|c|d|none>", "reason": "<one actionable sentence naming the artifact/skill and the cheaper action>"}',
  ].join("\n");
}

export function parseVerdict(out) {
  let s = (out || "").trim().replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();
  const tryParse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  let v = tryParse(s);
  if (!v) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) v = tryParse(m[0]);
  }
  if (!v || v.block !== true || typeof v.reason !== "string" || !v.reason.trim()) return null;
  return v;
}
