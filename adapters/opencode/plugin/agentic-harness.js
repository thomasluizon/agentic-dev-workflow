// opencode plugin adapter for the dual-target hook engine. It wires the SAME
// logic core the Claude Code hooks use to opencode's plugin contract:
//   - tool.execute.before  -> FULL enforcement parity: a policy block throws,
//                             which aborts the tool (git-action + content-scan).
//   - event(session.idle)  -> the proactivity guard, best-effort: opencode's
//                             idle event cannot rewind a finished turn the way
//                             the Claude Code Stop hook does, so this surfaces a
//                             nudge; the deterministic enforcement above is the
//                             real parity.
// All policy lives in hooks.policy.json; all logic in .../skills/_core/hooks/
// logic/. opencode auto-loads this from .opencode/plugin/ — no wiring needed.
//
// The core is located via the runtime-provided project `directory` first
// (robust to any plugin bundling), with import.meta.url probes as a fallback.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
})();

function coreCandidates(directory) {
  const list = [];
  if (directory) {
    list.push(join(directory, ".opencode", "skills", "_core", "hooks", "logic"));
    list.push(join(directory, ".claude", "skills", "_core", "hooks", "logic"));
  }
  if (here) {
    list.push(join(here, "..", "skills", "_core", "hooks", "logic"));
    list.push(join(here, "..", "..", "..", "core", "hooks", "logic"));
  }
  return list;
}

async function core(mod, directory) {
  for (const base of coreCandidates(directory)) {
    const p = join(base, mod);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error(`hook logic core not found: ${mod}`);
}

export default async ({ directory, worktree } = {}) => {
  const dir = directory || worktree || process.cwd();
  const [{ fromOpenCode }, { loadPolicy }, { evaluateGitCommand }, { scanContent }] = await Promise.all([
    core("payload.mjs", dir),
    core("config.mjs", dir),
    core("git-action.mjs", dir),
    core("content-scan.mjs", dir),
  ]);
  const policy = loadPolicy(dir);
  const resolveHeadBranch = (d) =>
    execFileSync("git", ["-C", d || dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  const BLOCK = /^\[(git-guardrails|content-guard)/;

  return {
    "tool.execute.before": async (input, output) => {
      try {
        const event = fromOpenCode(input?.tool, output?.args || {}, { directory: dir, worktree, sessionID: input?.sessionID });
        if (event.kind === "git" && event.command) {
          const v = evaluateGitCommand(event.command, policy.git, { resolveHeadBranch, cwd: dir });
          if (v?.blocked) throw new Error(`[git-guardrails:${v.rule}] ${v.reason}`);
        } else if (event.kind === "edit" && event.filePath && event.addedText) {
          const findings = scanContent(event.addedText, policy.content, event.filePath);
          if (findings.length) {
            throw new Error(`[content-guard] ${event.filePath}: ` + findings.map((f) => `[${f.rule}] ${f.message}`).join("; "));
          }
        }
      } catch (err) {
        // A policy block must propagate (opencode aborts the tool); an internal
        // bug must not — fail-open so the engine never wedges the tool.
        if (err && typeof err.message === "string" && BLOCK.test(err.message)) throw err;
      }
    },
    event: async ({ event }) => {
      if (event?.type !== "session.idle" || !policy.proactivity?.guard?.enabled) return;
      try {
        const { REMINDER_LINE } = await core("proactivity.mjs", dir);
        console.error(`[proactivity guard] session idle — ${REMINDER_LINE}`);
      } catch {
        /* best-effort nudge */
      }
    },
  };
};
