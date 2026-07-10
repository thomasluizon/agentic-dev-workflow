#!/usr/bin/env node
// Fails if any project-specific string OR hardcoded policy constant leaks into
// the tool-agnostic core. core/ is the single source of truth every adapter
// points at; it must stay generic so the pack drops cleanly into any project.
// Everything project-specific belongs in workflow.config.yaml, never in core/.
//
// Two classes of leak are enforced:
//   1. `forbidden`   — project names / brands / author handles / absolute paths.
//   2. `policyLeaks` — SDLC policy baked in as a constant instead of read from
//      config (a Co-Authored-By trailer, the `gh` tracker CLI, a squash-only
//      merge, a literal branch prefix). These are the zero-leakage guardrail:
//      a job machine may BAN co-authoring or require `TB-####` branches — the
//      exact opposite of another project — so the pack must never assume one.
//      A policy line is allowed ONLY when it also carries a `{{config.*}}`
//      reference (i.e. the behavior is genuinely parameterized and the constant
//      is just an inline illustration). The commit-trailer string has no
//      legitimate generic use at all, so it is never exempted.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The enforced trees: the tool-agnostic core, plus the AUTHORED engine adapters
// (the dual-target hook shells, the opencode plugin, and the Workflow-audit
// accelerator). The generated skill/agent pointers under adapters/*/skills and
// adapters/*/agents are derived from core (already checked), so they are not
// re-scanned. Every one of these must stay free of project strings and baked
// SDLC policy — the shells read all of that from hooks.policy.json at runtime.
const enforcedDirs = [
  join(packRoot, "core"),
  join(packRoot, "adapters", "claude-code", "hooks"),
  join(packRoot, "adapters", "claude-code", "workflows"),
  join(packRoot, "adapters", "opencode", "plugin"),
].filter((d) => existsSync(d));

// Each pattern is a leak: a name, vendor, brand, or absolute path that would
// couple core/ to one project. Add project-neutral terms here, never remove the
// project-specific ones.
const forbidden = [
  { label: "project brand (orbit)", re: /\borbit\b/i },
  { label: "project domain (useorbit)", re: /useorbit/i },
  { label: "author handle (thomasluizon)", re: /thomasluizon/i },
  { label: "product name (astra)", re: /\bastra\b/i },
  { label: "absolute Windows path", re: /[A-Za-z]:\\Users\\/i },
  { label: "absolute Windows path (forward slash)", re: /[A-Za-z]:\/Users\//i },
  { label: "absolute Unix home path", re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//i },
];

// Hardcoded SDLC policy that belongs in workflow.config.yaml. `allowIfConfigRef`
// exempts a line that also references `{{config.*}}` — the constant is then an
// inline illustration of a config-driven behavior, not a baked-in assumption.
const CONFIG_REF = /\{\{\s*config\./;
const policyLeaks = [
  {
    label: "hardcoded commit trailer — lift to config.pr.commitTrailer",
    re: /Co-Authored-By/i,
    allowIfConfigRef: false,
  },
  {
    label: "hardcoded tracker CLI (gh) — read config.issueTracker instead",
    re: /\bgh\s+(?:issue|pr|api|label|release|repo)\b/,
    allowIfConfigRef: true,
  },
  {
    label: "hardcoded merge strategy — lift to config.pr.squash",
    re: /--squash\b|\bsquash-only\b|\bsquash[- ]merge only\b|\bonly squash-merge\b/i,
    allowIfConfigRef: true,
  },
  {
    label: "hardcoded branch prefix — read config.branchNaming instead",
    re: /\bgit\s+(?:checkout\s+-b|switch\s+-c|branch)\s+["']?(?:feature|fix|chore|refactor|hotfix|release)\//i,
    allowIfConfigRef: true,
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const leaks = [];
for (const file of enforcedDirs.flatMap((d) => walk(d))) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { label, re } of forbidden) {
      if (re.test(line)) {
        leaks.push({ file: relative(packRoot, file), line: i + 1, label, text: line.trim() });
      }
    }
    const hasConfigRef = CONFIG_REF.test(line);
    for (const { label, re, allowIfConfigRef } of policyLeaks) {
      if (re.test(line) && !(allowIfConfigRef && hasConfigRef)) {
        leaks.push({ file: relative(packRoot, file), line: i + 1, label, text: line.trim() });
      }
    }
  });
}

if (leaks.length > 0) {
  console.error(`Genericity check FAILED — ${leaks.length} project-specific string(s) in the enforced tree:\n`);
  for (const leak of leaks) {
    console.error(`  ${leak.file}:${leak.line}  [${leak.label}]`);
    console.error(`    ${leak.text}`);
  }
  console.error(`\nMove project values into workflow.config.yaml and SDLC policy into hooks.policy.json; core/ and the engine adapters must stay generic.`);
  process.exit(1);
}

console.log("Genericity check passed — core/ and the engine adapters are free of project-specific strings and hardcoded policy.");
