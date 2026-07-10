// Runtime-agnostic git-workflow invariants. Every rule is parameterized by a
// `policy` object (from hooks.policy.json) — this file bakes in NONE of a
// project's SDLC: no branch prefix, no protected-branch name, no commit trailer
// is a constant here. That is the zero-leakage contract the genericity gate
// enforces. A Claude Code PreToolUse(Bash) hook and an opencode
// tool.execute.before plugin both call `evaluateGitCommand` and translate the
// verdict to their own block mechanism.
//
// A verdict is `{ blocked: true, reason, rule } | null` (null = allow).

import { matchesGlob } from "./scope.mjs";

const CONTAINS_GIT = /\bgit\b/;

function anyGlobMatches(name, globs) {
  return (globs || []).some((g) => matchesGlob(name, g));
}

// A new-branch invocation: `git checkout -b X`, `git switch -c X`, `git branch X`.
// Returns the proposed branch name or null.
export function extractNewBranchName(command) {
  const m =
    /\bgit\s+(?:-[Cc]\s+\S+\s+)*(?:checkout\s+-b|switch\s+-c|branch)\s+("[^"]+"|'[^']+'|[^\s"']+)/.exec(command);
  if (!m) return null;
  const name = m[1].replace(/^["']|["']$/g, "");
  // `git branch -d/-D/--list` etc. are not new-branch creation.
  if (name.startsWith("-")) return null;
  return name;
}

export function branchNameAllowed(name, policy) {
  if (!policy?.branchPattern) return true;
  if (anyGlobMatches(name, policy.branchExceptions)) return true;
  let re;
  try {
    re = new RegExp(policy.branchPattern);
  } catch {
    return true; // a malformed pattern must never wedge git — fail open.
  }
  return re.test(name);
}

// The push segment (if any) of a compound command, and whether it targets a
// protected branch by an explicit refspec.
function pushSegment(command) {
  return command.split(/[&|;\n]/).find((s) => /\bgit\b[\s\S]*\bpush\b/.test(s)) || null;
}

export function isForcePush(segment) {
  return /(?<![\w-])(?:--force\b|--force-with-lease\b|-f\b|-[A-Za-z]*f)/.test(segment.replace(/--force-with-lease=\S+/g, "--force-with-lease"));
}

function pushTargetsProtectedExplicitly(segment, protectedBranches) {
  const alt = protectedBranches.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!alt) return false;
  const re = new RegExp(`\\bpush\\b[^&|;\\n]*[\\s:/](?:${alt})(?=$|[\\s:])`);
  return re.test(segment);
}

function forbiddenTrailerHit(command, forbiddenTrailers) {
  for (const trailer of forbiddenTrailers || []) {
    if (!trailer) continue;
    if (new RegExp(trailer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(command)) return trailer;
  }
  return null;
}

function ticketRefMissing(command, policy) {
  if (!policy?.ticketPattern) return false;
  // Only enforce on a commit that carries an inline message.
  const msg = /\bgit\s+(?:-[Cc]\s+\S+\s+)*commit\b[^&|;\n]*\s-m\s+("[^"]*"|'[^']*'|\S+)/.exec(command);
  if (!msg) return false;
  let re;
  try {
    re = new RegExp(policy.ticketPattern);
  } catch {
    return false;
  }
  return !re.test(msg[1]);
}

function largeBinaryAdd(command, globs) {
  if (!globs || globs.length === 0) return null;
  const seg = command.split(/[&|;\n]/).find((s) => /\bgit\s+(?:-[Cc]\s+\S+\s+)*add\b/.test(s));
  if (!seg) return null;
  const after = seg.slice(seg.search(/\badd\b/) + 3);
  const paths = after.split(/\s+/).filter((t) => t && !t.startsWith("-"));
  const hit = paths.map((p) => p.replace(/^["']|["']$/g, "")).find((p) => anyGlobMatches(p, globs));
  return hit || null;
}

export function evaluateGitCommand(command, policy = {}, ctx = {}) {
  if (typeof command !== "string" || !CONTAINS_GIT.test(command)) return null;
  const protectedBranches = policy.protectedBranches || [];

  if (policy.blockNoVerify !== false) {
    if (/(?<![\w-])--no-verify\b/.test(command)) {
      return { rule: "no-verify", blocked: true, reason: "`--no-verify` skips the pre-commit/pre-push hooks. Fix what the hook flags, then run the command normally." };
    }
    if (/\bgit\s+(?:-[Cc]\s+\S+\s+)*commit\s+(?:-[A-Za-z]\s+)*-n(?=\s|$)/.test(command)) {
      return { rule: "no-verify", blocked: true, reason: "`-n` is git's short alias for --no-verify on commit; it skips the pre-commit hooks. Commit normally." };
    }
  }

  if (policy.blockNoGpgSign && (/(?<![\w-])--no-gpg-sign\b/.test(command) || /commit\.gpgsign\s*=\s*false/.test(command))) {
    return { rule: "no-gpg-sign", blocked: true, reason: "This bypasses commit signing. Let the commit sign as configured." };
  }

  const trailer = forbiddenTrailerHit(command, policy.forbiddenTrailers);
  if (trailer) {
    return { rule: "forbidden-trailer", blocked: true, reason: `This command's message contains a forbidden trailer ("${trailer}"). Remove it — this project's policy bans that trailer.` };
  }

  if (ticketRefMissing(command, policy)) {
    return { rule: "ticket-ref", blocked: true, reason: `The commit message is missing a required ticket reference (must match /${policy.ticketPattern}/). Add the ticket ID.` };
  }

  const bigBinary = largeBinaryAdd(command, policy.largeBinaryGlobs);
  if (bigBinary) {
    return { rule: "large-binary", blocked: true, reason: `Refusing to stage "${bigBinary}" — it matches the large-binary block list. Use the configured storage (LFS/asset host) instead of committing it.` };
  }

  const newBranch = extractNewBranchName(command);
  if (newBranch && !branchNameAllowed(newBranch, policy)) {
    return { rule: "branch-name", blocked: true, reason: `Branch "${newBranch}" does not match the required pattern /${policy.branchPattern}/. Rename it to satisfy the branch convention.` };
  }

  const seg = pushSegment(command);
  if (seg && protectedBranches.length) {
    const explicitProtected = pushTargetsProtectedExplicitly(seg, protectedBranches);
    if (explicitProtected && (policy.blockPushToProtected !== false)) {
      const forced = isForcePush(seg);
      return {
        rule: forced ? "force-push-protected" : "push-protected",
        blocked: true,
        reason: `${forced ? "Force-pushing" : "Pushing"} to a protected branch (${protectedBranches.join(" / ")}) is forbidden. Open a PR from a feature branch.`,
      };
    }
    // A bare push (no explicit protected refspec) issued while HEAD is on a
    // protected branch still lands there. Resolve HEAD via the injected
    // resolver (adapter-provided; keeps this module runtime-agnostic).
    if (!explicitProtected && policy.blockPushToProtected !== false && typeof ctx.resolveHeadBranch === "function") {
      const afterPush = seg.slice(seg.search(/\bpush\b/) + 4);
      const positional = afterPush.split(/\s+/).filter((t) => t && !t.startsWith("-"));
      if (positional.length <= 1) {
        const cMatch = /-[Cc]\s+("[^"]+"|'[^']+'|[^\s"']+)/.exec(seg);
        const dir = cMatch ? cMatch[1].replace(/^["']|["']$/g, "") : ctx.cwd;
        let head = null;
        try {
          head = ctx.resolveHeadBranch(dir);
        } catch {
          head = null;
        }
        if (head && protectedBranches.includes(head)) {
          return { rule: "push-protected", blocked: true, reason: `HEAD is on the protected branch '${head}'. Pushing from it is forbidden — switch to a feature branch and open a PR.` };
        }
      }
    }
  }

  return null;
}
