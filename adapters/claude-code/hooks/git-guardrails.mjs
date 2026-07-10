#!/usr/bin/env node
// Claude Code PreToolUse(Bash) adapter for the git-action logic core. Thin by
// design: read the payload, normalize it, ask the shared logic for a verdict,
// translate a block to `exit 2` + stderr. All policy lives in hooks.policy.json;
// all logic lives in core/hooks/logic/git-action.mjs — this file only wires the
// Claude Code I/O contract to it. The opencode plugin wires the SAME core to its
// own contract, so a fix to the rule lands in both tools at once.
//
// Fail-open: any error exits 0 so the hook never wedges the Bash tool.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// The logic core is vendored to .claude/skills/_core/ next to this hook when
// installed, and lives in core/ in the pack repo. Probe both.
async function core(mod) {
  for (const rel of ["../skills/_core/hooks/logic", "../../../core/hooks/logic"]) {
    const p = join(here, rel, mod);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error(`hook logic core not found: ${mod}`);
}

try {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const { fromClaudeCode } = await core("payload.mjs");
  const event = fromClaudeCode(input);
  if (event.kind !== "git" || !event.command) process.exit(0);

  const { loadPolicy } = await core("config.mjs");
  const { evaluateGitCommand } = await core("git-action.mjs");

  const policy = loadPolicy(event.cwd || process.cwd());
  const resolveHeadBranch = (dir) =>
    execFileSync("git", ["-C", dir || event.cwd || process.cwd(), "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  const verdict = evaluateGitCommand(event.command, policy.git, { resolveHeadBranch, cwd: event.cwd || process.cwd() });
  if (verdict?.blocked) {
    process.stderr.write(`BLOCKED git command (${verdict.rule}):\n  ${event.command}\n\n${verdict.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0);
}
