#!/usr/bin/env node
// Claude Code UserPromptSubmit adapter for the repo-clean FACT/RULE injector. On a
// machine where the repo must stay pristine, a project's facts + rules cannot live
// in the checkout (no CLAUDE.md, no .claude/rules/*), so there is no native way to
// scope instructions to one repo. This hook closes that gap: it resolves the git
// root from cwd, looks up the out-of-repo store entry, and injects that project's
// facts + rules as additionalContext every turn.
//
// It is a no-op with ZERO output for any repo that has no store entry (mode-1 /
// mode-2 repos keep their facts in-repo, which Claude Code already auto-loads), so
// wiring it machine-wide never leaks one project's facts into another. The shared
// assembly lives in the logic core (store.mjs) so the opencode plugin injects the
// exact same text.
//
// Fail-open: any error exits 0 so the hook never wedges a prompt.

import { readFileSync, existsSync } from "node:fs";
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
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    input = {};
  }

  const { resolveRepoRoot, buildInjectedContext } = await core("store.mjs");
  const startDir = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const repoRoot = resolveRepoRoot(startDir);
  const context = repoRoot ? buildInjectedContext(repoRoot) : null;
  if (!context) process.exit(0);

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }),
  );
  process.exit(0);
} catch {
  process.exit(0);
}
