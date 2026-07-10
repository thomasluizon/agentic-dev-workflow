#!/usr/bin/env node
// Regenerates the SKILL + AGENT adapters from a single manifest. Each adapter
// file is a THIN wrapper: the host tool's required header plus a pointer to the
// matching core/ body — no logic is ever duplicated across tools. Run this after
// changing the skill roster; the generated files are committed.
//
// This script only owns the generated `skills/` and `agents/` subtrees. The
// dual-target hook engine adapters (`claude-code/hooks/`, `claude-code/workflows/`,
// `opencode/plugin/`) are AUTHORED shells that import the shared logic core — they
// are NOT generated here and must survive regeneration, so the wipe below is
// scoped to skills/ + agents/, never the whole adapter base.
//
// Driver = Claude Code; opencode is a thin compat layer. Codex is a locked-out
// decision — do not re-add a codex path here.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// name, corePath (relative to core/), description, argHint (optional).
const skills = [
  ["prime", "pipeline/prime.md", "Load project context (all repos + optional issue) so downstream skills have warm context.", "[issue-number ...] [--quick]"],
  ["grill", "pipeline/grill.md", "Interview the user relentlessly about a plan or design until reaching shared understanding.", "[topic]"],
  ["plan", "pipeline/plan.md", "Create an implementation plan with cross-repo codebase analysis.", "[issue-number ...]"],
  ["implement", "pipeline/implement.md", "Execute a plan across the configured repos with validation loops.", "[plan-path | issue-number ...]"],
  ["validate", "pipeline/validate.md", "Run lint, type-check, build, and tests across the configured repos (auto-detects which).", ""],
  ["execute", "pipeline/execute.md", "Gated conductor: issue -> prime -> grill -> plan -> implement, with a hard gate at every stage.", "[issue-number ...]"],
  ["ship", "pipeline/ship.md", "Commit, push, and open a PR to the base branch; branches first if on a protected branch.", ""],
  ["clean", "pipeline/clean.md", "Clean up git worktrees and local branches except protected and current ones.", ""],
  ["pr-review", "review/pr-review.md", "Deep multi-dimension review of a diff against the project rubric; parity/i18n/contract are config-gated.", "[scope]"],
  ["audit-security", "review/audit-security.md", "Repo-wide security audit: authz, injection, secrets, CORS, rate limits, error leakage.", "[scope]"],
  ["audit-tests", "review/audit-tests.md", "Repo-wide test-QUALITY audit against a behavior+edge+failure rubric; not coverage percentage.", "[scope]"],
  ["audit-performance", "review/audit-performance.md", "Repo-wide performance-risk audit: N+1s, missing indexes, render thrash, bundle bloat.", "[scope]"],
  ["audit-code-quality", "review/audit-code-quality.md", "Repo-wide code-quality audit against the shared rubric: dead code, SOLID, DRY, naming, size.", "[scope]"],
  ["thermo-nuclear", "review/thermo-nuclear.md", "Maximum-rigor, behavior-preserving code-quality review with an adversarial verification harness.", "[scope]"],
  ["prod-readiness", "review/prod-readiness.md", "Orchestrate the four audits plus ops checks into one GO / CONDITIONAL / NO-GO verdict.", "[scope]"],
  ["feature", "intake/feature.md", "Idea -> PRD -> stories, gated: chains prd and stories with a hard confirmation gate before each.", "[idea]"],
  ["prd", "intake/prd.md", "Generate a Product Requirements Document, warm from context or --cold via interview.", "[output-filename] [--cold]"],
  ["stories", "intake/stories.md", "Break a PRD or plan into independently grabbable issues using tracer-bullet vertical slices.", "[source]"],
  ["deep-research", "research/deep-research.md", "Answer an open-ended best-way question with orchestrated, adversarially-verified multi-agent web research.", "[question]"],
  ["llm-council", "research/llm-council.md", "Vet a decision through N independent perspectives, peer-review them, then synthesize one recommendation.", "[topic]"],
  ["second-opinion", "review/second-opinion.md", "Independent cross-model second opinion (via opencode) on one load-bearing claim or Critical finding; degrades to UNAVAILABLE when opencode is absent.", "[claim [file:line]]"],
  ["investigate", "ops/investigate.md", "Root-cause a production incident end to end against the configured error tracker, deploy platform, prod data, and code — read-only until a human gate.", "[issue-id | url | description]"],
  ["handoff", "meta/handoff.md", "Compact the current session into a resumable handoff document a fresh agent can pick up from.", "[note]"],
  ["lesson", "meta/lesson.md", "Capture a correction as a gated, graduating lesson — staged for approval, then promoted to a hook/lint rule or a scoped note.", "[the lesson]"],
];

const agent = ["security-reviewer", "agents/security-reviewer.md", "Generic security-review agent: authz, webhook signatures, sessions, CORS, input size, rate limits, secret logging."];

function pointerBody(displayName, corePointer, description) {
  return `# ${displayName}

${description}

**This is a thin adapter.** The full, tool-agnostic instructions live in the pack core.
Read and follow the core skill body, then execute its steps against this project:

> **Core body:** \`${corePointer}\`

Resolve every \`{{config.*}}\` reference in the core body against this project's
\`workflow.config.yaml\` (at the project root). If a referenced optional config value is
absent, skip that step and record it in the skill's Deferred ledger. When the host tool
lacks parallel subagents or a named-agent registry, follow the core body's sequential
fallback.
`;
}

// ---- Claude Code: .claude/skills/<skill>/SKILL.md + .claude/agents/<agent>.md
function genClaudeCode() {
  const base = join(packRoot, "adapters/claude-code");
  rmSync(join(base, "skills"), { recursive: true, force: true });
  rmSync(join(base, "agents"), { recursive: true, force: true });
  for (const [name, corePath, description, argHint] of skills) {
    const fm = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      ...(argHint ? [`argument-hint: ${argHint}`] : []),
      "---",
      "",
    ].join("\n");
    const pointer = `../_core/${corePath}`;
    write(join(base, "skills", name, "SKILL.md"), fm + pointerBody(name, pointer, description));
  }
  const [aName, aCore, aDesc] = agent;
  const aFm = ["---", `name: ${aName}`, `description: ${aDesc}`, "---", ""].join("\n");
  write(join(base, "agents", `${aName}.md`), aFm + pointerBody(aName, `../skills/_core/${aCore}`, aDesc));
}

// ---- OpenCode: .opencode/skills/<skill>/SKILL.md + .opencode/agents/<agent>.md
function genOpenCode() {
  const base = join(packRoot, "adapters/opencode");
  rmSync(join(base, "skills"), { recursive: true, force: true });
  rmSync(join(base, "agents"), { recursive: true, force: true });
  for (const [name, corePath, description] of skills) {
    const fm = ["---", `description: ${description}`, "---", ""].join("\n");
    write(join(base, "skills", name, "SKILL.md"), fm + pointerBody(name, `../_core/${corePath}`, description));
  }
  const [aName, aCore, aDesc] = agent;
  const aFm = ["---", `description: ${aDesc}`, "mode: subagent", "---", ""].join("\n");
  write(join(base, "agents", `${aName}.md`), aFm + pointerBody(aName, `../skills/_core/${aCore}`, aDesc));
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

genClaudeCode();
genOpenCode();

const total = (skills.length + 1) * 2;
console.log(`Generated ${total} adapter files (${skills.length} skills + 1 agent) x 2 tools.`);
