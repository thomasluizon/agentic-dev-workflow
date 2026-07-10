#!/usr/bin/env node
// Proof that the generic pipeline skill bodies are CONFIG-WIRED, not hardcoded
// (stage 7e). Two guarantees, checked against the real core/ bodies:
//
//   1. POSITIVE — each pipeline skill references the {{config.*}} values it must
//      read at runtime (the resolved tracker driver, per-repo commands, branch /
//      merge / worktree conventions, the review gates, the incident bindings). A
//      body that quietly stopped reading a config value would fall back to a
//      baked-in assumption; this catches that regression.
//   2. NEGATIVE — no skill body carries a hardcoded SDLC constant: a bare
//      (non-host-qualified) tracker/forge CLI, a Co-Authored-By trailer, an
//      unconditional squash-merge, or a literal branch prefix inside a git
//      command. Each must be lifted to a {{config.*}} ref. This is the
//      zero-leakage guardrail as a runnable gate, complementing check-genericity's
//      whole-tree scan with per-body, intent-aware assertions.
//
// Exits non-zero on any failure so CI gates on it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const core = join(dirname(fileURLToPath(import.meta.url)), "..", "core");
const read = (rel) => readFileSync(join(core, rel), "utf8");

let fails = 0;
const T = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};

// ---- detectors --------------------------------------------------------------

// A body reads a config value when the path appears as a `{{config.<path>}}`
// opener (a prefix like `config.worktree` matches `{{config.worktree.root}}`).
const hasRef = (body, path) => new RegExp(`\\{\\{\\s*${path.replace(/\./g, "\\.")}\\b`).test(body);

// A tracker/forge CLI used as an imperative (verb-qualified so a bare "gh" word
// in prose does not trip). Allowed ONLY when the same line is host-qualified
// (names the host it illustrates) or drives off config.issueTracker / config.pr —
// i.e. it is a per-host reference, not a single-tracker assumption.
const TRACKER_CLI = /\bgh\s+(?:issue|pr|api|label|release|repo)\b|\bglab\s+(?:issue|mr)\b|\baz\s+(?:boards|repos)\b|\bjira\s+issue\b/i;
const HOST_QUALIFIED = /\b(?:github|gitlab|azure|jira|linear|bitbucket|gitea)\b/i;
const TRACKER_CFG = /\{\{\s*config\.(?:issueTracker|pr)\b/;

// A squash-merge stated as THE strategy. Allowed only when the line reads
// config.pr(.squash) — i.e. it is conditional on the configured merge policy.
const SQUASH = /--squash\b|\bsquash[- ]?merge(?:\s+only)?\b|\bonly\s+squash[- ]?merge\b/i;
const SQUASH_CFG = /\{\{\s*config\.pr(?:\.squash)?\b/;

// A literal branch prefix inside a git command. Allowed only when the line reads
// config.branchNaming (the prefix is then an illustration of the configured grammar).
const BRANCH_PREFIX = /\bgit\s+(?:checkout\s+-b|switch\s+-c|branch)\s+["']?(?:feature|fix|chore|refactor|hotfix|release)\//i;
const BRANCH_CFG = /\{\{\s*config\.branchNaming\b/;

const TRAILER = /Co-Authored-By/i;

// First offending line for a per-line rule, or null when the body is clean.
function offend(body, tokenRe, exemptFn) {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (tokenRe.test(lines[i]) && !exemptFn(lines[i])) return `L${i + 1}: ${lines[i].trim().slice(0, 120)}`;
  }
  return null;
}
const bareTrackerCli = (body) => offend(body, TRACKER_CLI, (l) => HOST_QUALIFIED.test(l) || TRACKER_CFG.test(l));
const bareSquash = (body) => offend(body, SQUASH, (l) => SQUASH_CFG.test(l));
const bareBranchPrefix = (body) => offend(body, BRANCH_PREFIX, (l) => BRANCH_CFG.test(l));
const bareTrailer = (body) => offend(body, TRAILER, () => false);

// ---- self-test the detectors (no vacuous pass) ------------------------------
console.log("# detector self-test");
T("detector: a bare `gh issue view <n>` is flagged", bareTrackerCli("run `gh issue view <n>` now") !== null);
T("detector: a host-qualified gh line is allowed", bareTrackerCli("- **github** — `gh issue create` here") === null);
T("detector: a config.pr-scoped forge line is allowed", bareTrackerCli("open against {{config.pr.baseBranch}} via `gh pr create`") === null);
T("detector: an unconditional squash-merge is flagged", bareSquash("squash-merge only, always") !== null);
T("detector: a config.pr.squash-guarded squash line is allowed", bareSquash("if {{config.pr.squash}}, squash-merge") === null);
T("detector: a literal `git checkout -b feature/` is flagged", bareBranchPrefix("git checkout -b feature/thing") !== null);
T("detector: a Co-Authored-By trailer is flagged", bareTrailer("append Co-Authored-By: x") !== null);

// ---- positive: required config refs per pipeline body -----------------------
console.log("\n# pipeline bodies read the config they must");
const REQUIRED = {
  "pipeline/prime.md": ["config.repos", "config.conventionsDocs", "config.issueTracker.host", "config.issueTracker.driver", "config.worktree"],
  "pipeline/plan.md": ["config.repos", "config.issueTracker.host", "config.issueTracker.driver", "config.parity"],
  "pipeline/implement.md": ["config.repos", "config.branchNaming", "config.pr.commitTrailer", "config.issueTracker.driver", "config.worktree"],
  "pipeline/validate.md": ["config.repos"],
  "pipeline/ship.md": ["config.pr.baseBranch", "config.pr.commitTrailer", "config.pr.forbiddenTrailers", "config.branchNaming"],
  "pipeline/clean.md": ["config.repos", "config.worktree.root", "config.branchNaming.protectedBranches"],
  "pipeline/execute.md": ["config.issueTracker", "config.worktree.branchPattern"],
  "intake/stories.md": ["config.issueTracker.host", "config.issueTracker.driver", "config.issueTracker.repo"],
  "intake/feature.md": ["config.issueTracker.repo"],
  "review/pr-review.md": ["config.repos", "config.parity.enabled", "config.i18n.locales", "config.contract.enabled", "config.secondOpinion.enabled"],
  "ops/investigate.md": ["config.repos", "config.investigate.errorTracker", "config.investigate.deployPlatform", "config.investigate.prodDataQuery", "config.investigate.codeNav"],
};
for (const [rel, paths] of Object.entries(REQUIRED)) {
  const body = read(rel);
  for (const p of paths) T(`${rel} reads {{${p}}}`, hasRef(body, p), `missing {{${p}}}`);
}

// ---- negative: no hardcoded SDLC constant in ANY skill body -----------------
console.log("\n# no skill body hardcodes a tracker / trailer / merge / branch prefix");
const BODIES = [
  "pipeline/prime.md", "pipeline/grill.md", "pipeline/plan.md", "pipeline/implement.md", "pipeline/validate.md",
  "pipeline/execute.md", "pipeline/ship.md", "pipeline/clean.md",
  "review/pr-review.md", "review/audit-security.md", "review/audit-tests.md", "review/audit-performance.md",
  "review/audit-code-quality.md", "review/thermo-nuclear.md", "review/prod-readiness.md", "review/second-opinion.md",
  "intake/feature.md", "intake/prd.md", "intake/stories.md",
  "research/deep-research.md", "research/llm-council.md",
  "ops/investigate.md", "meta/handoff.md", "meta/lesson.md", "setup/setup-harness.md",
];
for (const rel of BODIES) {
  const body = read(rel);
  T(`${rel}: no bare tracker/forge CLI`, bareTrackerCli(body) === null, bareTrackerCli(body) || "");
  T(`${rel}: no Co-Authored-By trailer`, bareTrailer(body) === null, bareTrailer(body) || "");
  T(`${rel}: no unconditional squash-merge`, bareSquash(body) === null, bareSquash(body) || "");
  T(`${rel}: no literal branch prefix in a git command`, bareBranchPrefix(body) === null, bareBranchPrefix(body) || "");
}

console.log(`\n${fails === 0 ? "PIPELINE WIRING PROOF OK" : `PIPELINE WIRING PROOF FAILED (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
