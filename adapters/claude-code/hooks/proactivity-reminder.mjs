#!/usr/bin/env node
// Claude Code UserPromptSubmit adapter — Layer 1 of the proactivity guard.
// Re-injects one high-salience disposition line every turn (verify/do over
// guess/ask/improvise). The line lives in the logic core so the opencode side
// shares it. Off when policy.proactivity.reminder.enabled is false.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

async function core(mod) {
  for (const rel of ["../skills/_core/hooks/logic", "../../../core/hooks/logic"]) {
    const p = join(here, rel, mod);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error(`hook logic core not found: ${mod}`);
}

try {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    input = {};
  }

  const { loadPolicy } = await core("config.mjs");
  const { REMINDER_LINE } = await core("proactivity.mjs");
  const policy = loadPolicy(input.cwd || process.cwd());
  if (!policy.proactivity?.reminder?.enabled) process.exit(0);

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER_LINE } }),
  );
  process.exit(0);
} catch {
  process.exit(0);
}
