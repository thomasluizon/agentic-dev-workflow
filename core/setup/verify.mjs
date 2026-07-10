// Self-verify — the second half of setup-harness, the final step. After the
// generators write, this proves the harness actually stands up:
//   1. workflow.config.yaml parses,
//   2. hooks.policy.json parses and has the expected shape,
//   3. every generated skill/rule file loads (exists + frontmatter),
//   4. a GUARDRAIL DRY-RUN — feed the real logic core the generated policy and a
//      simulated push to a protected branch, and assert it BLOCKS (plus a feature
//      push that must pass, so a rule that blocks everything is caught too).
//
// It returns a pass/fail per check plus a gaps/deferred report, and it NEVER
// throws — the never-block failure policy holds to the very end. A failed check is
// reported, not raised; the runbook surfaces it and the user decides.

import fs from "node:fs";
import path from "node:path";
import { evaluateGitCommand } from "../hooks/logic/git-action.mjs";
import { scanContent } from "../hooks/logic/content-scan.mjs";
import { fromYaml } from "./answers.mjs";

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function checkConfigParses(root) {
  const text = readFileSafe(path.join(root, "workflow.config.yaml"));
  if (text == null) return { name: "config parses", artifact: "workflow.config.yaml", pass: false, detail: "file not found" };
  try {
    const parsed = fromYaml(text);
    const ok = parsed && typeof parsed === "object" && Array.isArray(parsed.repos);
    return { name: "config parses", artifact: "workflow.config.yaml", pass: Boolean(ok), detail: ok ? `${parsed.repos.length} repo(s)` : "parsed but missing repos[]" };
  } catch (err) {
    return { name: "config parses", artifact: "workflow.config.yaml", pass: false, detail: String(err.message || err) };
  }
}

function loadPolicyFromDisk(root) {
  const text = readFileSafe(path.join(root, "hooks.policy.json"));
  if (text == null) return { policy: null, check: { name: "policy parses", artifact: "hooks.policy.json", pass: false, detail: "file not found" } };
  try {
    const policy = JSON.parse(text);
    const ok = policy && policy.git && policy.content && policy.proactivity;
    return { policy: ok ? policy : null, check: { name: "policy parses", artifact: "hooks.policy.json", pass: Boolean(ok), detail: ok ? "git/content/proactivity present" : "missing a top-level section" } };
  } catch (err) {
    return { policy: null, check: { name: "policy parses", artifact: "hooks.policy.json", pass: false, detail: String(err.message || err) } };
  }
}

// The core assertion: the generated policy actually blocks a protected-branch
// push and a hook bypass, while allowing ordinary feature work. Uses the SAME
// logic core the runtime hooks use, so a pass here means the real hook will block.
export function guardrailDryRun(policy) {
  const checks = [];
  // The runtime hooks pass the git sub-policy to evaluateGitCommand and the
  // content sub-policy to scanContent; the dry-run must do the same, so a pass
  // here means the real hook blocks.
  const git = policy?.git || {};
  const protectedBranch = (git.protectedBranches || [])[0];

  if (protectedBranch) {
    const verdict = evaluateGitCommand(`git push origin ${protectedBranch}`, git);
    checks.push({ name: "guardrail: push to a protected branch is blocked", artifact: "hooks.policy.json", pass: Boolean(verdict?.blocked), detail: verdict?.blocked ? verdict.rule : "NOT blocked — the guardrail would not fire" });

    const allow = evaluateGitCommand("git push origin feature/x-1-demo", git);
    checks.push({ name: "guardrail: an ordinary feature push is allowed", artifact: "hooks.policy.json", pass: allow === null, detail: allow === null ? "allowed" : `unexpectedly blocked (${allow.rule})` });
  } else {
    checks.push({ name: "guardrail: protected-branch push", artifact: "hooks.policy.json", pass: false, detail: "no protected branch configured — nothing to enforce" });
  }

  if (git.blockNoVerify !== false) {
    const verdict = evaluateGitCommand('git commit -m "x" --no-verify', git);
    checks.push({ name: "guardrail: --no-verify is blocked", artifact: "hooks.policy.json", pass: Boolean(verdict?.blocked), detail: verdict?.blocked ? verdict.rule : "NOT blocked" });
  }

  if (git.branchPattern) {
    const verdict = evaluateGitCommand("git checkout -b nope-does-not-match", git);
    checks.push({ name: "guardrail: an off-convention branch name is blocked", artifact: "hooks.policy.json", pass: Boolean(verdict?.blocked), detail: verdict?.blocked ? verdict.rule : "NOT blocked" });
  }

  if (policy?.content?.emDash?.enabled) {
    const findings = scanContent("a — dash", policy.content, "README.md");
    checks.push({ name: "guardrail: an em dash in scoped copy is caught", artifact: "hooks.policy.json", pass: findings.length > 0, detail: findings.length ? findings[0].rule : "NOT caught" });
  }

  return checks;
}

function hasFrontmatter(text) {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(String(text || ""));
}

function checkArtifactsLoad(root, plan) {
  const checks = [];
  for (const artifact of plan || []) {
    if (artifact.kind !== "skill" && artifact.kind !== "rule") continue;
    const text = readFileSafe(path.join(root, artifact.path));
    const pass = text != null && (artifact.kind === "rule" ? true : hasFrontmatter(text));
    checks.push({ name: `${artifact.kind} loads`, artifact: artifact.path, pass, detail: text == null ? "missing" : artifact.kind === "skill" && !pass ? "no frontmatter" : "ok" });
  }
  return checks;
}

// Run the whole self-verify against what was written to `root`. `context` carries
// the plan (which files to load-check), incoming gaps (lint fallbacks, dead doc
// links), unresolved conflicts, and the deferred rows (dropped/softened) so the
// final report is complete — nothing silently omitted.
export function run(root = process.cwd(), context = {}) {
  const checks = [];
  checks.push(checkConfigParses(root));
  const { policy, check } = loadPolicyFromDisk(root);
  checks.push(check);
  if (policy) checks.push(...guardrailDryRun(policy));
  checks.push(...checkArtifactsLoad(root, context.plan));

  const gaps = [
    ...(context.gaps || []),
    ...pendingConflictGaps(context.conflicts),
    ...deferredGaps(context.deferred),
  ];

  const allPassed = checks.every((c) => c.pass);
  return { checks, gaps, allPassed };
}

function pendingConflictGaps(conflicts) {
  return (conflicts || []).map((c) => ({ id: c.subject, rule: c.detail, detail: "unresolved conflict — settle it in the decomposition before relying on the harness" }));
}

function deferredGaps(deferred) {
  return (deferred || []).map((r) => ({ id: r.id, rule: r.rule, detail: r.dropped ? "dropped at the gate — not enforced" : "softened to an advisory rule — does not block" }));
}
