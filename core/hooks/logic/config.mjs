// Loads the hook policy at runtime. The policy is JSON (never YAML) so the hooks
// have ZERO runtime dependencies: setup-harness reads workflow.config.yaml + the
// interview and writes hooks.policy.json; the hooks only JSON.parse it. Layers,
// weakest-to-strongest: built-in DEFAULT_POLICY < global (~/.claude) < project
// (nearest hooks.policy.json walking up from the edited file).
//
// DEFAULT_POLICY encodes ONLY universally-safe defaults — block the git bypass
// flags, protect main/master, scan for unambiguous secrets. Everything a project
// might reasonably want either way (em-dash ban, branch grammar, ticket ref,
// forbidden trailers) is OFF until the policy turns it on. No SDLC policy is a
// constant here; that is the zero-leakage contract.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_POLICY = {
  git: {
    protectedBranches: ["main", "master"],
    blockNoVerify: true,
    blockNoGpgSign: true,
    blockPushToProtected: true,
    branchPattern: "",
    branchExceptions: [],
    ticketPattern: "",
    forbiddenTrailers: [],
    largeBinaryGlobs: [],
  },
  content: {
    emDash: { enabled: false, scope: null, allowNumericEnDash: true },
    bannedPhrases: { enabled: false, phrases: [], scope: null },
    secretScan: {
      enabled: true,
      extraPatterns: [],
      scope: { exclude: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/fixtures/**", "**/__fixtures__/**"] },
    },
    largeBinary: { enabled: false, maxBytes: 0, blockedGlobs: [], scope: null },
  },
  proactivity: {
    reminder: { enabled: true },
    guard: { enabled: false, judgeModel: "", skillDirs: [] },
  },
};

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge(base, override) {
  if (!isObject(override)) return override === undefined ? base : override;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    out[key] = isObject(base?.[key]) && isObject(override[key]) ? deepMerge(base[key], override[key]) : override[key];
  }
  return out;
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const POLICY_FILENAME = "hooks.policy.json";

function findProjectPolicy(startDir) {
  let dir = startDir || process.cwd();
  const home = os.homedir();
  for (let i = 0; i < 40; i++) {
    const candidate = path.join(dir, POLICY_FILENAME);
    // The global policy is loaded separately; don't double-count it as project.
    if (candidate !== path.join(home, ".claude", POLICY_FILENAME) && fs.existsSync(candidate)) {
      return readJsonIfExists(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadPolicy(startDir) {
  const global = readJsonIfExists(path.join(os.homedir(), ".claude", POLICY_FILENAME));
  const project = findProjectPolicy(startDir);
  let policy = DEFAULT_POLICY;
  if (global) policy = deepMerge(policy, global);
  if (project) policy = deepMerge(policy, project);
  return policy;
}
